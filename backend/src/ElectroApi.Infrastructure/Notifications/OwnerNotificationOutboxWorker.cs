using ElectroApi.Core.Entities;
using ElectroApi.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ElectroApi.Infrastructure.Notifications;

public sealed class OwnerNotificationOutboxWorker(IServiceScopeFactory scopes, OwnerNotificationSettings settings, IOwnerNotificationSender sender, TimeProvider time, ILogger<OwnerNotificationOutboxWorker> logger) : BackgroundService
{
    public static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(3);
    private DateTime _nextSendAt;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var processed = false;
            try { processed = await ProcessOnce(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception) { logger.LogWarning("Owner notification outbox unavailable; code outbox_unavailable."); }
            try { await Task.Delay(TimeSpan.FromSeconds(processed ? 1 : 5), time, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    // One part per pass keeps processing testable without live HTTP or pacing sleeps.
    public async Task<bool> ProcessOnce(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var notifications = scope.ServiceProvider.GetRequiredService<OwnerOrderNotifications>();
        var now = time.GetUtcNow().UtcDateTime;
        var retention = now.AddHours(-24);
        var canSend = settings.Enabled && now >= _nextSendAt;
        var id = await db.OwnerOrderNotifications.AsNoTracking()
            .Where(n => n.CompletedAt == null && n.FailedAt == null && (n.LeaseUntil == null || n.LeaseUntil <= now) &&
                (n.CreatedAt <= retention || n.Attempts >= 10 || canSend && n.NextAttemptAt <= now))
            .OrderBy(n => n.CreatedAt).ThenBy(n => n.Id).Select(n => (Guid?)n.Id).FirstOrDefaultAsync(ct);
        if (id is null) return false;
        var leaseId = Guid.NewGuid();
        now = time.GetUtcNow().UtcDateTime;
        retention = now.AddHours(-24);
        var claimed = await db.OwnerOrderNotifications.Where(n => n.Id == id && n.CompletedAt == null && n.FailedAt == null &&
            (n.LeaseUntil == null || n.LeaseUntil <= now) && (n.CreatedAt <= retention || n.Attempts >= 10 || canSend && n.NextAttemptAt <= now))
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.LeaseId, leaseId).SetProperty(n => n.LeaseUntil, now + LeaseDuration), ct);
        if (claimed == 0) return false;
        var row = await db.OwnerOrderNotifications.AsNoTracking().SingleAsync(n => n.Id == id, ct);
        if (row.CreatedAt <= retention || row.Attempts >= 10)
        {
            await Fail(db, row, leaseId, row.CreatedAt <= retention ? "payload_expired" : "attempts_exhausted", ct);
            return true;
        }
        OwnerNotificationPayload payload;
        try
        {
            payload = notifications.Read(row.ProtectedPayload);
            if (payload.OrderId != row.OrderId || payload.ChatId <= 0 || payload.Parts is null || payload.Parts.Length != row.PartCount ||
                row.CurrentPart < 0 || row.CurrentPart >= row.PartCount || string.IsNullOrEmpty(payload.OrderNumber) ||
                payload.Parts.Any(part => string.IsNullOrEmpty(part) || part.Length >= OwnerOrderNotifications.MessageLimit))
                throw new InvalidOperationException("Invalid protected owner notification.");
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            await Fail(db, row, leaseId, "invalid_payload", ct);
            return true;
        }
        now = time.GetUtcNow().UtcDateTime;
        // Renew and fence immediately before the bounded request; interrupted attempts stay counted.
        var begun = await Owned(db, row, leaseId, now).Where(n => n.Attempts < 10 && n.CreatedAt > now.AddHours(-24))
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.Attempts, n => n.Attempts + 1).SetProperty(n => n.LeaseUntil, now + LeaseDuration), ct);
        if (begun == 0)
        {
            if (row.CreatedAt <= now.AddHours(-24)) await Fail(db, row, leaseId, "payload_expired", ct);
            else LostLease(row);
            return true;
        }
        row.Attempts++;
        OwnerNotificationSendResult result;
        try { result = await sender.Send(payload.ChatId, payload.Parts[row.CurrentPart], ct); }
        catch (Exception) when (!ct.IsCancellationRequested) { result = new(null, OwnerNotificationFailure.NetworkError); }
        finally { _nextSendAt = time.GetUtcNow().UtcDateTime.AddSeconds(1); }
        now = time.GetUtcNow().UtcDateTime;
        if (result.Succeeded)
        {
            var nextPart = row.CurrentPart + 1;
            var complete = nextPart == row.PartCount;
            var expired = !complete && row.CreatedAt <= now.AddHours(-24);
            var advanced = await Owned(db, row, leaseId, now).ExecuteUpdateAsync(s => s
                .SetProperty(n => n.CurrentPart, nextPart).SetProperty(n => n.Attempts, 0).SetProperty(n => n.LastMessageId, result.MessageId)
                .SetProperty(n => n.NextAttemptAt, now.AddSeconds(1)).SetProperty(n => n.LeaseId, (Guid?)null).SetProperty(n => n.LeaseUntil, (DateTime?)null)
                .SetProperty(n => n.CompletedAt, complete ? now : (DateTime?)null).SetProperty(n => n.FailedAt, expired ? now : (DateTime?)null)
                .SetProperty(n => n.FailureCode, expired ? "payload_expired" : null).SetProperty(n => n.ProtectedPayload, complete || expired ? "" : row.ProtectedPayload), ct);
            if (advanced == 0) LostLease(row);
            else if (complete) logger.LogInformation("Owner notification completed: event {EventId}, order {OrderId}.", row.Id, row.OrderId);
            else if (expired) Failed(row, "payload_expired");
        }
        else if (result.Permanent || row.Attempts >= 10 || row.CreatedAt <= now.AddHours(-24))
            await Fail(db, row, leaseId, row.CreatedAt <= now.AddHours(-24) ? "payload_expired" : row.Attempts >= 10 ? "attempts_exhausted" : result.SafeCode, ct);
        else
        {
            var delay = RetryDelay(row.Attempts, result);
            if (result.Failure == OwnerNotificationFailure.RateLimited) _nextSendAt = now + delay;
            var retried = await Owned(db, row, leaseId, now).ExecuteUpdateAsync(s => s
                .SetProperty(n => n.NextAttemptAt, now + delay).SetProperty(n => n.FailureCode, result.SafeCode)
                .SetProperty(n => n.LeaseId, (Guid?)null).SetProperty(n => n.LeaseUntil, (DateTime?)null), ct);
            if (retried == 0) LostLease(row);
            else logger.LogWarning("Owner notification retry scheduled: event {EventId}, order {OrderId}, code {FailureCode}.", row.Id, row.OrderId, result.SafeCode);
        }
        return true;
    }

    public static TimeSpan RetryDelay(int attempt, OwnerNotificationSendResult result) =>
        result.Failure == OwnerNotificationFailure.RateLimited && result.RetryAfterSeconds is > 0
            ? TimeSpan.FromSeconds(result.RetryAfterSeconds.Value)
            : TimeSpan.FromSeconds(Math.Min(3600, 15 * Math.Pow(2, Math.Clamp(attempt - 1, 0, 10))));

    private static IQueryable<OwnerOrderNotification> Owned(ApplicationDbContext db, OwnerOrderNotification row, Guid leaseId, DateTime now) =>
        db.OwnerOrderNotifications.Where(n => n.Id == row.Id && n.CurrentPart == row.CurrentPart && n.LeaseId == leaseId && n.LeaseUntil > now && n.CompletedAt == null && n.FailedAt == null);

    private async Task Fail(ApplicationDbContext db, OwnerOrderNotification row, Guid leaseId, string code, CancellationToken ct)
    {
        var failed = await Owned(db, row, leaseId, time.GetUtcNow().UtcDateTime).ExecuteUpdateAsync(s => s
            .SetProperty(n => n.ProtectedPayload, "").SetProperty(n => n.FailedAt, time.GetUtcNow().UtcDateTime).SetProperty(n => n.FailureCode, code)
            .SetProperty(n => n.LeaseId, (Guid?)null).SetProperty(n => n.LeaseUntil, (DateTime?)null), ct);
        if (failed == 0) LostLease(row);
        else Failed(row, code);
    }

    private void Failed(OwnerOrderNotification row, string code) => logger.LogWarning("Owner notification failed: event {EventId}, order {OrderId}, code {FailureCode}.", row.Id, row.OrderId, code);
    private void LostLease(OwnerOrderNotification row) => logger.LogWarning("Owner notification progress not saved: event {EventId}, order {OrderId}, code lease_lost.", row.Id, row.OrderId);
}
