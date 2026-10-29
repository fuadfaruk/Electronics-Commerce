using System.Collections.Concurrent;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Notifications;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MySql.Data.MySqlClient;

namespace ElectroApi.Integration.Tests;

public sealed class OwnerNotificationOutboxTests
{
    [MySqlFact]
    public async Task MySQL_enforces_one_event_per_order_foreign_key_and_bounded_progress()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue();
        using var scope = fixture.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        Task<int> Insert(Guid orderId, int partCount, int attempts) => db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO OwnerOrderNotifications (Id, OrderId, ProtectedPayload, CreatedAt, NextAttemptAt, PartCount, CurrentPart, Attempts) VALUES ({Guid.NewGuid().ToString()}, {orderId.ToString()}, {row.ProtectedPayload}, {row.CreatedAt}, {row.NextAttemptAt}, {partCount}, {0}, {attempts})");
        var duplicate = await Assert.ThrowsAsync<MySqlException>(() => Insert(row.OrderId, row.PartCount, 0)); Assert.Equal(1062, duplicate.Number);
        var missingOrder = await Assert.ThrowsAsync<MySqlException>(() => Insert(Guid.NewGuid(), row.PartCount, 0)); Assert.Equal(1452, missingOrder.Number);
        var invalidProgress = await Assert.ThrowsAsync<MySqlException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE OwnerOrderNotifications SET Attempts = {11} WHERE Id = {row.Id.ToString()}")); Assert.Equal(3819, invalidProgress.Number);
        var unchanged = await db.OwnerOrderNotifications.AsNoTracking().SingleAsync();
        Assert.Equal(row.Id, unchanged.Id); Assert.Equal(row.ProtectedPayload, unchanged.ProtectedPayload); Assert.Equal(0, unchanged.Attempts);
    }

    [MySqlFact]
    public async Task Active_lease_excludes_a_second_worker_and_acknowledgment_releases_it()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(multipart: true);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var response = new TaskCompletionSource<OwnerNotificationSendResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstSender = new RecordingSender(fixture.Clock, (_, ct) => { entered.TrySetResult(); return response.Task.WaitAsync(ct); });
        var secondSender = new RecordingSender(fixture.Clock);
        using var first = fixture.Worker(firstSender); using var second = fixture.Worker(secondSender);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var processing = first.ProcessOnce(timeout.Token);
        try
        {
            await entered.Task.WaitAsync(timeout.Token);
            var leased = await fixture.Read(row.Id);
            Assert.NotNull(leased.LeaseId); Assert.Equal(fixture.Clock.UtcNow + OwnerNotificationOutboxWorker.LeaseDuration, leased.LeaseUntil);
            Assert.Equal(TimeSpan.FromMinutes(3), OwnerNotificationOutboxWorker.LeaseDuration);
            Assert.Equal(1, leased.Attempts); Assert.Equal(0, leased.CurrentPart);
            Assert.False(await second.ProcessOnce(timeout.Token)); Assert.Empty(secondSender.Calls);
            Assert.Equal(JsonSerializer.Serialize(leased), JsonSerializer.Serialize(await fixture.Read(row.Id)));
            response.SetResult(new(1001)); Assert.True(await processing);
            var acknowledged = await fixture.Read(row.Id);
            Assert.Equal(1, acknowledged.CurrentPart); Assert.Equal(0, acknowledged.Attempts); Assert.Equal(1001L, acknowledged.LastMessageId);
            Assert.Null(acknowledged.LeaseId); Assert.Null(acknowledged.LeaseUntil); Assert.Null(acknowledged.CompletedAt);
            Assert.Equal(row.ProtectedPayload, acknowledged.ProtectedPayload);
            Assert.Equal(fixture.Clock.UtcNow.AddSeconds(1), acknowledged.NextAttemptAt);
        }
        finally { response.TrySetResult(new(1001)); await processing.WaitAsync(TimeSpan.FromSeconds(15)); }
        Assert.Single(firstSender.Calls);
    }

    [MySqlFact]
    public async Task Lease_is_renewed_before_sending_after_claim_processing_consumes_lease_time()
    {
        await using var database = await IsolatedDatabase.Create();
        var advance = new AdvanceAfterWrite();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString, advance);
        var row = await fixture.Enqueue(multipart: true); var originalNow = fixture.Clock.UtcNow;
        advance.OnNextWrite = () => fixture.Clock.Advance(TimeSpan.FromMinutes(2));
        var sender = new RecordingSender(fixture.Clock, async (_, _) =>
        {
            var leased = await fixture.Read(row.Id);
            Assert.Equal(originalNow.AddMinutes(2), fixture.Clock.UtcNow);
            Assert.Equal(fixture.Clock.UtcNow + OwnerNotificationOutboxWorker.LeaseDuration, leased.LeaseUntil);
            Assert.Equal(1, leased.Attempts); Assert.NotNull(leased.LeaseId);
            return new(1002);
        });
        using var worker = fixture.Worker(sender);
        Assert.True(await worker.ProcessOnce(default)); Assert.True(advance.Advanced); Assert.Single(sender.Calls);
        Assert.Equal(1, (await fixture.Read(row.Id)).CurrentPart);
    }

    [MySqlFact]
    public Task Fenced_old_worker_cannot_advance_after_an_expired_lease_is_reclaimed() => AssertFenced(new(1101));

    [MySqlFact]
    public Task Fenced_old_worker_cannot_fail_or_scrub_after_an_expired_lease_is_reclaimed() => AssertFenced(new(null, OwnerNotificationFailure.Forbidden));

    private static async Task AssertFenced(OwnerNotificationSendResult staleResult)
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(multipart: true); var payload = fixture.Payload(row);
        var oldEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var newEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var oldResponse = new TaskCompletionSource<OwnerNotificationSendResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var newResponse = new TaskCompletionSource<OwnerNotificationSendResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var oldSender = new RecordingSender(fixture.Clock, (_, ct) => { oldEntered.TrySetResult(); return oldResponse.Task.WaitAsync(ct); });
        var newSender = new RecordingSender(fixture.Clock, (_, ct) => { newEntered.TrySetResult(); return newResponse.Task.WaitAsync(ct); });
        using var oldWorker = fixture.Worker(oldSender); using var newWorker = fixture.Worker(newSender);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var oldProcessing = oldWorker.ProcessOnce(timeout.Token); Task<bool>? newProcessing = null;
        try
        {
            await oldEntered.Task.WaitAsync(timeout.Token); var oldLease = await fixture.Read(row.Id);
            fixture.Clock.Advance(OwnerNotificationOutboxWorker.LeaseDuration);
            newProcessing = newWorker.ProcessOnce(timeout.Token); await newEntered.Task.WaitAsync(timeout.Token);
            var newLease = await fixture.Read(row.Id);
            Assert.NotEqual(oldLease.LeaseId, newLease.LeaseId); Assert.NotNull(newLease.LeaseId);
            Assert.Equal(2, newLease.Attempts); Assert.Equal(0, newLease.CurrentPart);
            Assert.Equal(fixture.Clock.UtcNow + OwnerNotificationOutboxWorker.LeaseDuration, newLease.LeaseUntil);
            oldResponse.SetResult(staleResult); Assert.True(await oldProcessing);
            Assert.Equal(JsonSerializer.Serialize(newLease), JsonSerializer.Serialize(await fixture.Read(row.Id)));
            Assert.Contains(fixture.Logger.Messages, message => message.Contains("lease_lost", StringComparison.Ordinal));
            newResponse.SetResult(new(2201)); Assert.True(await newProcessing);
            var resumed = await fixture.Read(row.Id);
            Assert.Equal(1, resumed.CurrentPart); Assert.Equal(0, resumed.Attempts); Assert.Equal(2201L, resumed.LastMessageId);
            Assert.Null(resumed.CompletedAt); Assert.Null(resumed.FailedAt); Assert.Null(resumed.LeaseId); Assert.Null(resumed.LeaseUntil);
            Assert.Equal(row.ProtectedPayload, resumed.ProtectedPayload);
            Assert.Equal(payload.Parts[0], Assert.Single(oldSender.Calls).Text);
            Assert.Equal(payload.Parts[0], Assert.Single(newSender.Calls).Text);
        }
        finally
        {
            oldResponse.TrySetResult(staleResult); newResponse.TrySetResult(new(2201));
            await oldProcessing.WaitAsync(TimeSpan.FromSeconds(15));
            if (newProcessing is not null) await newProcessing.WaitAsync(TimeSpan.FromSeconds(15));
        }
    }

    [MySqlFact]
    public async Task Restart_after_ambiguous_interruption_repeats_only_the_unacknowledged_part()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(multipart: true); var payload = fixture.Payload(row);
        using var interrupted = new CancellationTokenSource(); var sends = 0;
        var firstSender = new RecordingSender(fixture.Clock, (_, ct) =>
        {
            if (++sends == 1) return Task.FromResult(new OwnerNotificationSendResult(3001));
            // The provider may have accepted this part, but no acknowledgment is persisted.
            interrupted.Cancel(); ct.ThrowIfCancellationRequested(); throw new InvalidOperationException("Unreachable.");
        });
        using var first = fixture.Worker(firstSender);
        Assert.True(await first.ProcessOnce(default)); fixture.Clock.Advance(TimeSpan.FromSeconds(1));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first.ProcessOnce(interrupted.Token));
        var interruptedRow = await fixture.Read(row.Id);
        Assert.Equal(1, interruptedRow.CurrentPart); Assert.Equal(1, interruptedRow.Attempts); Assert.Equal(3001L, interruptedRow.LastMessageId);
        Assert.NotNull(interruptedRow.LeaseId); Assert.NotNull(interruptedRow.LeaseUntil); Assert.Equal(row.ProtectedPayload, interruptedRow.ProtectedPayload);
        var restartedSender = new RecordingSender(fixture.Clock); using var restarted = fixture.Worker(restartedSender);
        fixture.Clock.Advance(OwnerNotificationOutboxWorker.LeaseDuration - TimeSpan.FromSeconds(1));
        Assert.False(await restarted.ProcessOnce(default)); Assert.Empty(restartedSender.Calls);
        fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.True(await restarted.ProcessOnce(default));
        Assert.Equal(payload.Parts[1], Assert.Single(restartedSender.Calls).Text);
        var resumed = await fixture.Read(row.Id); Assert.Equal(2, resumed.CurrentPart); Assert.Equal(0, resumed.Attempts);
        for (var part = 2; part < payload.Parts.Length; part++)
        {
            fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.True(await restarted.ProcessOnce(default));
        }
        var allTexts = firstSender.Calls.Concat(restartedSender.Calls).Select(call => call.Text).ToArray();
        Assert.Equal(1, allTexts.Count(text => text == payload.Parts[0])); Assert.Equal(2, allTexts.Count(text => text == payload.Parts[1]));
        Assert.Equal(payload.Parts.Skip(1), restartedSender.Calls.Select(call => call.Text));
        var completed = await fixture.Read(row.Id);
        Assert.Equal(payload.Parts.Length, completed.CurrentPart); Assert.Equal("", completed.ProtectedPayload); Assert.Null(completed.FailedAt);
        Assert.Null(completed.LeaseId); Assert.Null(completed.LeaseUntil); Assert.Equal(0, completed.Attempts);
        Assert.False(await restarted.ProcessOnce(default));
    }

    [MySqlFact]
    public async Task Partial_resume_retains_each_failed_attempt_and_resets_only_acknowledged_progress()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(multipart: true); var payload = fixture.Payload(row);
        var results = new Queue<OwnerNotificationSendResult>([new(null, OwnerNotificationFailure.NetworkError), new(4001), new(null, OwnerNotificationFailure.Timeout), new(null, OwnerNotificationFailure.InvalidResponse)]);
        var sender = new RecordingSender(fixture.Clock, (_, _) => Task.FromResult(results.Dequeue())); using var worker = fixture.Worker(sender);
        Assert.True(await worker.ProcessOnce(default)); var failed = await fixture.Read(row.Id);
        Assert.Equal(0, failed.CurrentPart); Assert.Equal(1, failed.Attempts); Assert.Null(failed.LastMessageId);
        Assert.Equal(fixture.Clock.UtcNow.AddSeconds(15), failed.NextAttemptAt); Assert.Equal(row.ProtectedPayload, failed.ProtectedPayload);
        Assert.False(await worker.ProcessOnce(default)); fixture.Clock.AdvanceTo(failed.NextAttemptAt);
        Assert.True(await worker.ProcessOnce(default)); var acknowledged = await fixture.Read(row.Id);
        Assert.Equal(1, acknowledged.CurrentPart); Assert.Equal(0, acknowledged.Attempts); Assert.Equal(4001L, acknowledged.LastMessageId);
        fixture.Clock.AdvanceTo(acknowledged.NextAttemptAt); Assert.True(await worker.ProcessOnce(default));
        failed = await fixture.Read(row.Id); Assert.Equal(1, failed.CurrentPart); Assert.Equal(1, failed.Attempts); Assert.Equal(4001L, failed.LastMessageId);
        fixture.Clock.AdvanceTo(failed.NextAttemptAt); Assert.True(await worker.ProcessOnce(default));
        failed = await fixture.Read(row.Id); Assert.Equal(1, failed.CurrentPart); Assert.Equal(2, failed.Attempts); Assert.Equal(4001L, failed.LastMessageId);
        Assert.Equal(fixture.Clock.UtcNow.AddSeconds(30), failed.NextAttemptAt);
        var restartResults = new Queue<OwnerNotificationSendResult>([new(null, OwnerNotificationFailure.ProviderUnavailable), new(4002)]);
        var restartedSender = new RecordingSender(fixture.Clock, (_, _) => Task.FromResult(restartResults.Count > 0 ? restartResults.Dequeue() : new(4003)));
        using var restarted = fixture.Worker(restartedSender); Assert.False(await restarted.ProcessOnce(default));
        fixture.Clock.AdvanceTo(failed.NextAttemptAt); Assert.True(await restarted.ProcessOnce(default));
        failed = await fixture.Read(row.Id); Assert.Equal(1, failed.CurrentPart); Assert.Equal(3, failed.Attempts);
        Assert.Equal(fixture.Clock.UtcNow.AddSeconds(60), failed.NextAttemptAt); Assert.Equal(row.ProtectedPayload, failed.ProtectedPayload);
        fixture.Clock.AdvanceTo(failed.NextAttemptAt); Assert.True(await restarted.ProcessOnce(default));
        acknowledged = await fixture.Read(row.Id); Assert.Equal(2, acknowledged.CurrentPart); Assert.Equal(0, acknowledged.Attempts); Assert.Equal(4002L, acknowledged.LastMessageId);
        Assert.Null(acknowledged.FailureCode);
        for (var part = 2; part < payload.Parts.Length; part++)
        {
            fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.True(await restarted.ProcessOnce(default));
        }
        Assert.Equal(new[] { payload.Parts[0], payload.Parts[0], payload.Parts[1], payload.Parts[1] }, sender.Calls.Select(call => call.Text));
        Assert.Equal(new[] { payload.Parts[1], payload.Parts[1] }.Concat(payload.Parts.Skip(2)), restartedSender.Calls.Select(call => call.Text));
        Assert.All(sender.Calls.Concat(restartedSender.Calls), call => Assert.Equal(OwnerNotificationTestSettings.ChatId, call.ChatId));
        var completed = await fixture.Read(row.Id); Assert.NotNull(completed.CompletedAt); Assert.Equal(payload.Parts.Length, completed.CurrentPart); Assert.Equal("", completed.ProtectedPayload);
    }

    [MySqlFact]
    public async Task Rate_limit_honors_retry_after_and_blocks_other_due_sends_during_backoff()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var first = await fixture.Enqueue(); await fixture.Update(first.Id, row => row.CreatedAt = fixture.Clock.UtcNow.AddMinutes(-2));
        var second = await fixture.Enqueue(); var sends = 0;
        var sender = new RecordingSender(fixture.Clock, (_, _) => Task.FromResult(++sends == 1 ? new(null, OwnerNotificationFailure.RateLimited, 120) : new OwnerNotificationSendResult(5000 + sends)));
        using var worker = fixture.Worker(sender);
        Assert.True(await worker.ProcessOnce(default)); var limited = await fixture.Read(first.Id);
        Assert.Equal(1, limited.Attempts); Assert.Equal(0, limited.CurrentPart); Assert.Equal("telegram_rate_limited", limited.FailureCode);
        Assert.Equal(fixture.Clock.UtcNow.AddSeconds(120), limited.NextAttemptAt); Assert.Equal(first.ProtectedPayload, limited.ProtectedPayload);
        Assert.Null(limited.LeaseId); Assert.Null(limited.LeaseUntil); Assert.Null(limited.FailedAt);
        Assert.False(await worker.ProcessOnce(default)); fixture.Clock.Advance(TimeSpan.FromSeconds(119)); Assert.False(await worker.ProcessOnce(default));
        Assert.Single(sender.Calls); Assert.Equal(0, (await fixture.Read(second.Id)).Attempts);
        fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.True(await worker.ProcessOnce(default));
        Assert.NotNull((await fixture.Read(first.Id)).CompletedAt); Assert.False(await worker.ProcessOnce(default));
        fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.True(await worker.ProcessOnce(default));
        Assert.NotNull((await fixture.Read(second.Id)).CompletedAt); Assert.Equal(3, sender.Calls.Length);
        Assert.Equal(TimeSpan.FromSeconds(120), sender.Calls[1].At - sender.Calls[0].At);
        Assert.True(sender.Calls[2].At - sender.Calls[1].At >= TimeSpan.FromSeconds(1));
    }

    [MySqlFact]
    public async Task Successful_parts_and_different_orders_are_paced_at_least_one_second_apart()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var first = await fixture.Enqueue(); var second = await fixture.Enqueue();
        var sender = new RecordingSender(fixture.Clock); using var worker = fixture.Worker(sender);
        Assert.True(await worker.ProcessOnce(default)); Assert.False(await worker.ProcessOnce(default));
        fixture.Clock.Advance(TimeSpan.FromMilliseconds(999)); Assert.False(await worker.ProcessOnce(default)); Assert.Single(sender.Calls);
        fixture.Clock.Advance(TimeSpan.FromMilliseconds(1)); Assert.True(await worker.ProcessOnce(default)); Assert.False(await worker.ProcessOnce(default));
        Assert.Equal(2, sender.Calls.Length); Assert.True(sender.Calls[1].At - sender.Calls[0].At >= TimeSpan.FromSeconds(1));
        foreach (var id in new[] { first.Id, second.Id })
        {
            var completed = await fixture.Read(id);
            Assert.NotNull(completed.CompletedAt); Assert.Equal(completed.PartCount, completed.CurrentPart); Assert.Equal(0, completed.Attempts);
            Assert.Equal("", completed.ProtectedPayload); Assert.Null(completed.FailureCode); Assert.Null(completed.FailedAt);
            Assert.NotNull(completed.LastMessageId); Assert.Null(completed.LeaseId); Assert.Null(completed.LeaseUntil);
        }
    }

    [MySqlFact]
    public async Task Tenth_attempt_scrubs_current_part_retains_safe_metadata_and_preserves_commerce_state()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(multipart: true); var payload = fixture.Payload(row);
        await fixture.Update(row.Id, value => { value.CurrentPart = 1; value.Attempts = 8; value.LastMessageId = 6001; });
        row = await fixture.Read(row.Id); var before = await fixture.CommerceState();
        var sender = new RecordingSender(fixture.Clock, (_, _) => Task.FromResult(new OwnerNotificationSendResult(null, OwnerNotificationFailure.NetworkError)));
        using var worker = fixture.Worker(sender); Assert.True(await worker.ProcessOnce(default));
        var ninth = await fixture.Read(row.Id); Assert.Equal(9, ninth.Attempts); Assert.Equal(1, ninth.CurrentPart); Assert.Null(ninth.FailedAt);
        Assert.Equal(fixture.Clock.UtcNow.AddHours(1), ninth.NextAttemptAt); Assert.Equal(row.ProtectedPayload, ninth.ProtectedPayload);
        Assert.Equal(before, await fixture.CommerceState()); Assert.False(await worker.ProcessOnce(default));
        fixture.Clock.Advance(TimeSpan.FromSeconds(3599)); Assert.False(await worker.ProcessOnce(default));
        fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.True(await worker.ProcessOnce(default));
        var exhausted = await fixture.Read(row.Id); AssertTerminal(exhausted, row, "attempts_exhausted", 10);
        Assert.Equal(2, sender.Calls.Length); Assert.All(sender.Calls, call => Assert.Equal(payload.Parts[1], call.Text)); Assert.Equal(before, await fixture.CommerceState());
        fixture.Clock.Advance(TimeSpan.FromDays(1)); Assert.False(await worker.ProcessOnce(default)); Assert.Equal(2, sender.Calls.Length);
        Assert.Equal(JsonSerializer.Serialize(exhausted), JsonSerializer.Serialize(await fixture.Read(row.Id)));
        fixture.AssertSafeLogs();
    }

    [MySqlFact]
    public async Task Interrupted_tenth_attempt_is_counted_and_restart_never_sends_an_eleventh_attempt()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(multipart: true);
        await fixture.Update(row.Id, value => { value.CurrentPart = 1; value.Attempts = 9; value.LastMessageId = 6101; }); row = await fixture.Read(row.Id);
        using var interrupted = new CancellationTokenSource();
        var sender = new RecordingSender(fixture.Clock, (_, ct) => { interrupted.Cancel(); ct.ThrowIfCancellationRequested(); throw new InvalidOperationException("Unreachable."); });
        using var worker = fixture.Worker(sender);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => worker.ProcessOnce(interrupted.Token));
        var leased = await fixture.Read(row.Id); Assert.Equal(10, leased.Attempts); Assert.NotNull(leased.LeaseId); Assert.Null(leased.FailedAt);
        var restartedSender = new RecordingSender(fixture.Clock); using var restarted = fixture.Worker(restartedSender);
        Assert.False(await restarted.ProcessOnce(default)); fixture.Clock.Advance(OwnerNotificationOutboxWorker.LeaseDuration);
        Assert.True(await restarted.ProcessOnce(default)); Assert.Empty(restartedSender.Calls);
        AssertTerminal(await fixture.Read(row.Id), row, "attempts_exhausted", 10); Assert.Single(sender.Calls);
    }

    [MySqlFact]
    public async Task Twenty_four_hour_boundary_expires_payload_even_when_next_retry_is_in_the_future()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(multipart: true);
        await fixture.Update(row.Id, value => { value.CreatedAt = fixture.Clock.UtcNow.AddHours(-24).AddSeconds(1); value.CurrentPart = 1; value.LastMessageId = 6201; });
        row = await fixture.Read(row.Id);
        var sender = new RecordingSender(fixture.Clock, (_, _) => Task.FromResult(new OwnerNotificationSendResult(null, OwnerNotificationFailure.ProviderUnavailable)));
        using var worker = fixture.Worker(sender); Assert.True(await worker.ProcessOnce(default));
        var retried = await fixture.Read(row.Id); Assert.Equal(1, retried.Attempts); Assert.Null(retried.FailedAt); Assert.Equal(row.ProtectedPayload, retried.ProtectedPayload);
        fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.True(retried.NextAttemptAt > fixture.Clock.UtcNow);
        Assert.True(await worker.ProcessOnce(default)); Assert.Single(sender.Calls);
        AssertTerminal(await fixture.Read(row.Id), row, "payload_expired", 1); Assert.False(await worker.ProcessOnce(default)); fixture.AssertSafeLogs();
    }

    [MySqlFact]
    public async Task Permanent_provider_failures_scrub_once_and_retain_only_safe_failure_metadata()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        foreach (var failure in new[] { OwnerNotificationFailure.BadRequest, OwnerNotificationFailure.Unauthorized, OwnerNotificationFailure.Forbidden, OwnerNotificationFailure.RecipientMismatch })
        {
            var row = await fixture.Enqueue(multipart: true);
            await fixture.Update(row.Id, value => { value.CurrentPart = 1; value.Attempts = 2; value.LastMessageId = 6301; }); row = await fixture.Read(row.Id);
            var result = new OwnerNotificationSendResult(null, failure);
            var sender = new RecordingSender(fixture.Clock, (_, _) => Task.FromResult(result)); using var worker = fixture.Worker(sender);
            Assert.True(await worker.ProcessOnce(default)); AssertTerminal(await fixture.Read(row.Id), row, result.SafeCode, 3);
            fixture.Clock.Advance(TimeSpan.FromSeconds(1)); Assert.False(await worker.ProcessOnce(default)); Assert.Single(sender.Calls);
        }
        fixture.AssertSafeLogs();
    }

    [MySqlFact]
    public async Task Malformed_ciphertext_or_mismatched_progress_is_terminal_without_a_send_or_attempt_reset()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        Action<OwnerOrderNotification>[] corruptions =
        [
            row => row.ProtectedPayload = "unprotected synthetic customer payload",
            row => row.ProtectedPayload = fixture.Protection.CreateProtector("ElectroMart.OwnerOrderNotifications.v1").Protect("not-json " + OwnerNotificationTestSettings.BotToken),
            row => row.PartCount++,
            row => row.CurrentPart = row.PartCount,
            row => row.ProtectedPayload = fixture.Protection.CreateProtector("ElectroMart.OwnerOrderNotifications.v1").Protect(JsonSerializer.Serialize(fixture.Payload(row) with { OrderId = Guid.NewGuid() }))
        ];
        var sender = new RecordingSender(fixture.Clock); using var worker = fixture.Worker(sender);
        foreach (var corrupt in corruptions)
        {
            var row = await fixture.Enqueue();
            await fixture.Update(row.Id, value => { value.Attempts = 4; corrupt(value); }); row = await fixture.Read(row.Id);
            Assert.True(await worker.ProcessOnce(default)); AssertTerminal(await fixture.Read(row.Id), row, "invalid_payload", 4);
        }
        Assert.Empty(sender.Calls); Assert.False(await worker.ProcessOnce(default)); fixture.AssertSafeLogs();
    }

    [MySqlFact]
    public async Task Disabled_worker_sends_nothing_retains_fresh_payload_and_expires_payload_after_active_lease()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var fresh = await fixture.Enqueue(); var expired = await fixture.Enqueue(multipart: true); var active = await fixture.Enqueue();
        await fixture.Update(expired.Id, row => { row.CreatedAt = fixture.Clock.UtcNow.AddHours(-24); row.NextAttemptAt = fixture.Clock.UtcNow.AddHours(1); row.CurrentPart = 1; row.Attempts = 3; row.LastMessageId = 6401; });
        await fixture.Update(active.Id, row => { row.CreatedAt = fixture.Clock.UtcNow.AddHours(-25); row.LeaseId = Guid.NewGuid(); row.LeaseUntil = fixture.Clock.UtcNow + OwnerNotificationOutboxWorker.LeaseDuration; });
        expired = await fixture.Read(expired.Id); active = await fixture.Read(active.Id); var before = await fixture.CommerceState();
        var sender = new RecordingSender(fixture.Clock); using var worker = fixture.Worker(sender, OwnerNotificationSettings.Read(OwnerNotificationTestSettings.Configuration(enabled: false)));
        Assert.True(await worker.ProcessOnce(default)); AssertTerminal(await fixture.Read(expired.Id), expired, "payload_expired", 3);
        Assert.False(await worker.ProcessOnce(default)); Assert.Equal(JsonSerializer.Serialize(active), JsonSerializer.Serialize(await fixture.Read(active.Id)));
        Assert.Equal(fresh.ProtectedPayload, (await fixture.Read(fresh.Id)).ProtectedPayload); Assert.Equal(0, (await fixture.Read(fresh.Id)).Attempts);
        fixture.Clock.Advance(OwnerNotificationOutboxWorker.LeaseDuration); Assert.True(await worker.ProcessOnce(default));
        AssertTerminal(await fixture.Read(active.Id), active, "payload_expired", 0); Assert.False(await worker.ProcessOnce(default));
        fixture.Clock.Advance(TimeSpan.FromDays(1)); Assert.True(await worker.ProcessOnce(default)); AssertTerminal(await fixture.Read(fresh.Id), fresh, "payload_expired", 0);
        Assert.Empty(sender.Calls); Assert.Equal(before, await fixture.CommerceState()); Assert.False(await worker.ProcessOnce(default)); fixture.AssertSafeLogs();
    }

    [MySqlFact]
    public async Task Provider_and_network_outages_leave_order_pending_unpaid_and_stock_email_receipt_and_proof_intact()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var fixture = await OutboxFixture.Create(database.ConnectionString);
        var row = await fixture.Enqueue(); var before = await fixture.CommerceState(); var calls = 0;
        var sender = new RecordingSender(fixture.Clock, (_, _) =>
        {
            if (++calls == 1) throw new HttpRequestException("Synthetic private customer sample@example.com " + OwnerNotificationTestSettings.BotToken);
            return Task.FromResult(new OwnerNotificationSendResult(null, OwnerNotificationFailure.ProviderUnavailable));
        });
        using var worker = fixture.Worker(sender);
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            Assert.True(await worker.ProcessOnce(default)); var retried = await fixture.Read(row.Id);
            Assert.Equal(attempt, retried.Attempts); Assert.Equal(0, retried.CurrentPart); Assert.Null(retried.FailedAt); Assert.Null(retried.CompletedAt);
            Assert.Equal(row.ProtectedPayload, retried.ProtectedPayload); Assert.Null(retried.LeaseId); Assert.Null(retried.LeaseUntil);
            Assert.Equal(before, await fixture.CommerceState()); fixture.Clock.AdvanceTo(retried.NextAttemptAt);
        }
        using var scope = fixture.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var order = await db.Orders.AsNoTracking().SingleAsync(); Assert.Equal(OrderStatus.Pending, order.Fulfillment); Assert.Equal(PaymentStatus.Unpaid, order.Payment);
        Assert.Equal(49, await db.Products.Where(product => product.Slug == "sample-usb-c-cable").Select(product => product.Stock).SingleAsync());
        Assert.Equal(1, await db.EmailOutbox.CountAsync()); Assert.Equal(1, await db.GuestCapabilities.CountAsync()); Assert.Equal(1, await db.CommandReceipts.CountAsync());
        fixture.AssertSafeLogs();
    }

    private static void AssertTerminal(OwnerOrderNotification terminal, OwnerOrderNotification original, string code, int attempts)
    {
        Assert.Equal(original.Id, terminal.Id); Assert.Equal(original.OrderId, terminal.OrderId); Assert.Equal(original.CreatedAt, terminal.CreatedAt);
        Assert.Equal(original.PartCount, terminal.PartCount); Assert.Equal(original.CurrentPart, terminal.CurrentPart); Assert.Equal(original.LastMessageId, terminal.LastMessageId);
        Assert.Equal(attempts, terminal.Attempts); Assert.Equal("", terminal.ProtectedPayload); Assert.NotNull(terminal.FailedAt); Assert.Null(terminal.CompletedAt);
        Assert.Equal(code, terminal.FailureCode); Assert.Matches("^[a-z_]{1,40}$", terminal.FailureCode!); Assert.Null(terminal.LeaseId); Assert.Null(terminal.LeaseUntil);
    }

    private sealed record SendCall(long ChatId, string Text, DateTimeOffset At);

    private sealed class RecordingSender(MutableTimeProvider clock, Func<SendCall, CancellationToken, Task<OwnerNotificationSendResult>>? send = null) : IOwnerNotificationSender
    {
        private readonly ConcurrentQueue<SendCall> _calls = new(); private long _messageId = 7000;
        public SendCall[] Calls => _calls.ToArray();
        public Task<OwnerNotificationSendResult> Send(long chatId, string text, CancellationToken ct)
        {
            var call = new SendCall(chatId, text, clock.GetUtcNow()); _calls.Enqueue(call);
            return send is null ? Task.FromResult(new OwnerNotificationSendResult(Interlocked.Increment(ref _messageId))) : send(call, ct);
        }
    }

    private sealed class MutableTimeProvider : TimeProvider
    {
        private long _ticks = new DateTimeOffset(2030, 1, 2, 3, 4, 5, TimeSpan.Zero).Ticks;
        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);
        public DateTime UtcNow => GetUtcNow().UtcDateTime;
        public void Advance(TimeSpan duration) => Interlocked.Add(ref _ticks, duration.Ticks);
        public void AdvanceTo(DateTime utc) => Advance(utc - UtcNow);
    }

    private sealed class SafeLogger : ILogger<OwnerNotificationOutboxWorker>
    {
        private readonly ConcurrentQueue<(string Message, Exception? Exception)> _entries = new();
        public string[] Messages => _entries.Select(entry => entry.Message).ToArray();
        public Exception?[] Exceptions => _entries.Select(entry => entry.Exception).ToArray();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => _entries.Enqueue((formatter(state, exception), exception));
    }

    private sealed class AdvanceAfterWrite : DbCommandInterceptor
    {
        public Action? OnNextWrite { get; set; }
        public bool Advanced { get; private set; }
        public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (OnNextWrite is { } advance && command.CommandText.Contains("OwnerOrderNotifications", StringComparison.Ordinal) && result == 1)
            {
                OnNextWrite = null; Advanced = true; advance();
            }
            return ValueTask.FromResult(result);
        }
    }

    private sealed class OutboxFixture(ServiceProvider services, IDataProtectionProvider protection) : IAsyncDisposable
    {
        public ServiceProvider Services { get; } = services;
        public IDataProtectionProvider Protection { get; } = protection;
        public MutableTimeProvider Clock { get; } = new();
        public SafeLogger Logger { get; } = new();
        public static async Task<OutboxFixture> Create(string connection, params IInterceptor[] interceptors)
        {
            var protection = new EphemeralDataProtectionProvider(); var configuration = OwnerNotificationTestSettings.Configuration();
            var services = new ServiceCollection();
            services.AddSingleton<IDataProtectionProvider>(protection); services.AddSingleton<IConfiguration>(configuration);
            services.AddSingleton(OwnerNotificationSettings.Read(configuration));
            services.AddDbContext<ApplicationDbContext>(options => options.UseMySQL(connection).AddInterceptors(interceptors));
            services.AddScoped<OwnerOrderNotifications>(); services.AddScoped<IOwnerOrderNotifications>(scope => scope.GetRequiredService<OwnerOrderNotifications>());
            services.AddScoped<ICommerceMail, CommerceMail>(); services.AddScoped<CommerceRepository>();
            var fixture = new OutboxFixture(services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true }), protection);
            using var scope = fixture.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            await db.Database.MigrateAsync(); await DevelopmentSeed.Seed(db); return fixture;
        }
        public OwnerNotificationOutboxWorker Worker(IOwnerNotificationSender sender, OwnerNotificationSettings? settings = null) => new(Services.GetRequiredService<IServiceScopeFactory>(), settings ?? Services.GetRequiredService<OwnerNotificationSettings>(), sender, Clock, Logger);
        public async Task<OwnerOrderNotification> Enqueue(bool multipart = false)
        {
            using var scope = Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); var commerce = scope.ServiceProvider.GetRequiredService<CommerceRepository>();
            Guid[] productIds;
            if (multipart)
            {
                var categoryId = await db.Categories.Select(category => category.Id).FirstAsync(); var prefix = "notification-" + Guid.NewGuid().ToString("N");
                var products = Enumerable.Range(1, 50).Select(index => new Product { Slug = prefix + "-" + index, Name = $"Synthetic item {index:00} " + new string('x', 180), CategoryId = categoryId, Price = 499m, Stock = 3 }).ToArray();
                db.Products.AddRange(products); await db.SaveChangesAsync(); productIds = products.Select(product => product.Id).ToArray();
            }
            else productIds = [await db.Products.Where(product => product.Slug == "sample-usb-c-cable").Select(product => product.Id).SingleAsync()];
            var owner = new CommerceOwner("g:" + CommerceRepository.Hash(Guid.NewGuid().ToString()), null, null);
            var quote = await commerce.Quote(owner, new(productIds.Select(id => new QuoteItem(id, 1)).ToArray()), default);
            var order = await commerce.Accept(owner, "notification-key-" + Guid.NewGuid().ToString("N"), new(quote.QuoteId, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka", Postcode = "1205" }, "Synthetic delivery notes"), default);
            db.ChangeTracker.Clear(); var row = await db.OwnerOrderNotifications.SingleAsync(value => value.OrderId == order.Id);
            row.CreatedAt = Clock.UtcNow.AddMinutes(-1); row.NextAttemptAt = Clock.UtcNow; await db.SaveChangesAsync();
            if (multipart) Assert.True(row.PartCount >= 3); else Assert.Equal(1, row.PartCount);
            return row;
        }
        public OwnerNotificationPayload Payload(OwnerOrderNotification row)
        {
            using var scope = Services.CreateScope(); return scope.ServiceProvider.GetRequiredService<OwnerOrderNotifications>().Read(row.ProtectedPayload);
        }
        public async Task<OwnerOrderNotification> Read(Guid id)
        {
            using var scope = Services.CreateScope(); return await scope.ServiceProvider.GetRequiredService<ApplicationDbContext>().OwnerOrderNotifications.AsNoTracking().SingleAsync(row => row.Id == id);
        }
        public async Task Update(Guid id, Action<OwnerOrderNotification> update)
        {
            using var scope = Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); var row = await db.OwnerOrderNotifications.SingleAsync(row => row.Id == id);
            update(row); await db.SaveChangesAsync();
        }
        public async Task<string> CommerceState()
        {
            using var scope = Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var orders = await db.Orders.AsNoTracking().Include(order => order.Lines).Include(order => order.Events).OrderBy(order => order.Id).ToArrayAsync();
            var products = await db.Products.AsNoTracking().OrderBy(product => product.Id).Select(product => new { product.Id, product.Stock, product.Version }).ToArrayAsync();
            var receipts = await db.CommandReceipts.AsNoTracking().OrderBy(receipt => receipt.Id).ToArrayAsync();
            var capabilities = await db.GuestCapabilities.AsNoTracking().OrderBy(capability => capability.Id).ToArrayAsync();
            var mail = await db.EmailOutbox.AsNoTracking().OrderBy(row => row.Id).ToArrayAsync();
            return JsonSerializer.Serialize(new { Orders = orders.Select(order => CommerceRepository.Map(order, true)), Products = products, Receipts = receipts, Capabilities = capabilities, Mail = mail });
        }
        public void AssertSafeLogs()
        {
            Assert.All(Logger.Exceptions, exception => Assert.Null(exception));
            Assert.All(Logger.Messages, message =>
            {
                Assert.DoesNotContain(OwnerNotificationTestSettings.BotToken, message); Assert.DoesNotContain("sample@example.com", message);
                Assert.DoesNotContain(OwnerNotificationTestSettings.ChatId.ToString(CultureInfo.InvariantCulture), message);
                Assert.DoesNotContain("Sample Customer", message); Assert.DoesNotContain("01712345678", message); Assert.DoesNotContain("api.telegram.org", message);
                Assert.DoesNotContain("123 Sample Road", message); Assert.DoesNotContain("Synthetic delivery notes", message);
            });
        }
        public ValueTask DisposeAsync() => Services.DisposeAsync();
    }
}

internal static class OwnerNotificationTestSettings
{
    public const long ChatId = 6_543_210_987_654_321_012;
    public const string BotToken = "1234567890:synthetic_owner_notification_token_123456789";
    public static IConfigurationRoot Configuration(bool enabled = true) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["OwnerNotifications:Enabled"] = enabled.ToString(), ["Telegram:BotToken"] = BotToken,
        ["Telegram:OwnerChatId"] = ChatId.ToString(CultureInfo.InvariantCulture), ["Storefront:Origin"] = CommerceApiFactory.Origin
    }).Build();
    public static OwnerOrderNotifications Builder(IDataProtectionProvider? protection = null)
    {
        var configuration = Configuration(); return new(protection ?? new EphemeralDataProtectionProvider(), OwnerNotificationSettings.Read(configuration), configuration);
    }
}
