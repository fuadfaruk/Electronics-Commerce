using System.Net.Http.Json;
using System.Text.Json;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Mail;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace ElectroApi.Integration.Tests;

public sealed class MailOutboxTests
{
    [MySqlFact]
    public async Task Disabled_mail_never_claims_or_sends_with_credentials_but_retention_scrubs_old_and_exhausted_payloads()
    {
        await using var database = await IsolatedDatabase.Create();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Mail:Enabled"] = "true", ["Mail:Host"] = "127.0.0.1", ["Mail:Port"] = "1", ["Mail:Sender"] = "sender@example.com",
            ["Mail:Username"] = "synthetic-user", ["Mail:Password"] = "synthetic-password"
        }).Build();
        var services = new ServiceCollection(); services.AddSingleton<IConfiguration>(configuration);
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider()); services.AddScoped<CommerceMail>();
        services.AddDbContext<ApplicationDbContext>(options => options.UseMySQL(database.ConnectionString));
        await using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        Guid freshId; Guid expiredId; Guid exhaustedId; Guid leasedId; string freshPayload; string leasedPayload;
        using (var scope = provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); await db.Database.MigrateAsync();
            var mail = scope.ServiceProvider.GetRequiredService<CommerceMail>();
            var fresh = mail.Create("sample@example.com", "Historical mail", "Protected pending payload"); freshId = fresh.Id; freshPayload = fresh.ProtectedPayload;
            var expired = mail.Create("sample@example.com", "Historical mail", "Protected expired payload"); expired.CreatedAt = DateTime.UtcNow.AddDays(-2); expired.NextAttemptAt = DateTime.UtcNow.AddHours(1); expiredId = expired.Id;
            var exhausted = mail.Create("sample@example.com", "Historical mail", "Protected exhausted payload"); exhausted.Attempts = 10; exhaustedId = exhausted.Id;
            var leased = mail.Create("sample@example.com", "Historical mail", "Protected leased payload"); leased.CreatedAt = DateTime.UtcNow.AddDays(-2); leased.Attempts = 2; leased.LeaseUntil = DateTime.UtcNow.AddMinutes(10); leasedId = leased.Id; leasedPayload = leased.ProtectedPayload;
            db.EmailOutbox.AddRange(fresh, expired, exhausted, leased); await db.SaveChangesAsync();
        }
        configuration["Mail:Enabled"] = "false";
        using var worker = new MailOutboxWorker(provider.GetRequiredService<IServiceScopeFactory>(), configuration, NullLogger<MailOutboxWorker>.Instance);
        await worker.ProcessOnce(default); await worker.ProcessOnce(default);
        using var checkScope = provider.CreateScope(); var check = checkScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var rows = await check.EmailOutbox.AsNoTracking().ToDictionaryAsync(e => e.Id);
        Assert.Equal(freshPayload, rows[freshId].ProtectedPayload); Assert.Equal(0, rows[freshId].Attempts); Assert.Null(rows[freshId].LeaseUntil); Assert.Null(rows[freshId].SentAt);
        foreach (var id in new[] { expiredId, exhaustedId }) { Assert.Equal("", rows[id].ProtectedPayload); Assert.Equal(10, rows[id].Attempts); Assert.Null(rows[id].LeaseUntil); Assert.Null(rows[id].SentAt); }
        Assert.Equal(leasedPayload, rows[leasedId].ProtectedPayload); Assert.Equal(2, rows[leasedId].Attempts); Assert.NotNull(rows[leasedId].LeaseUntil); Assert.Null(rows[leasedId].SentAt);
        await check.EmailOutbox.Where(e => e.Id == leasedId).ExecuteUpdateAsync(s => s.SetProperty(e => e.LeaseUntil, DateTime.UtcNow.AddMinutes(-1)));
        await worker.ProcessOnce(default);
        var scrubbed = await check.EmailOutbox.AsNoTracking().SingleAsync(e => e.Id == leasedId);
        Assert.Equal("", scrubbed.ProtectedPayload); Assert.Equal(10, scrubbed.Attempts); Assert.Null(scrubbed.LeaseUntil); Assert.Null(scrubbed.SentAt);
        Assert.Equal(0, await check.EmailOutbox.Where(e => e.Id == freshId).Select(e => e.Attempts).SingleAsync());
    }

    [MySqlFact]
    public async Task Protected_outbox_delivers_through_real_local_SMTP_capture_and_scrubs_sent_payload()
    {
        if (Environment.GetEnvironmentVariable("ELECTROMART_TEST_SMTP") != "1") throw new InvalidOperationException("This SMTP gate requires local Mailpit on 1025/8025; set ELECTROMART_TEST_SMTP=1 when explicitly ready.");
        await using var database = await IsolatedDatabase.Create();
        await using var factory = new CommerceApiFactory(database.ConnectionString, Path.Combine(Path.GetTempPath(), "kilo", "mail_keys_" + Guid.NewGuid().ToString("N")), true, overrides: CommerceApiFactory.FullFeatures);
        await factory.InitializeDatabase();
        Guid id; var recipient = "sample-" + Guid.NewGuid().ToString("N") + "@example.com";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); var mail = scope.ServiceProvider.GetRequiredService<ICommerceMail>();
            var row = mail.Create(recipient, "ElectroMart local outbox test", "Sample mail delivery, no real credentials or personal data."); id = row.Id;
            db.EmailOutbox.Add(row); await db.SaveChangesAsync(); Assert.DoesNotContain(recipient, row.ProtectedPayload);
        }
        var sent = false;
        for (var i = 0; i < 40; i++)
        {
            using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var row = await db.EmailOutbox.AsNoTracking().SingleAsync(e => e.Id == id);
            if (row.SentAt.HasValue) { Assert.Equal("", row.ProtectedPayload); Assert.Equal(1, row.Attempts); sent = true; break; }
            await Task.Delay(500);
        }
        Assert.True(sent, "Protected SMTP outbox was not delivered within the test window.");
        using var http = new HttpClient(); var messages = await http.GetFromJsonAsync<JsonElement>("http://127.0.0.1:8025/api/v1/messages");
        Assert.Contains(messages.GetProperty("messages").EnumerateArray(), message => message.GetProperty("To").EnumerateArray().Any(to => to.GetProperty("Address").GetString() == recipient));
    }
    [MySqlFact]
    public async Task Failed_SMTP_does_not_roll_back_accepted_order_and_is_bounded_with_protected_retry()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var factory = new CommerceApiFactory(database.ConnectionString, Path.Combine(Path.GetTempPath(), "kilo", "mail_failure_keys_" + Guid.NewGuid().ToString("N")), true, overrides: new Dictionary<string, string?>(CommerceApiFactory.FullFeatures) { ["Mail:Port"] = "1" });
        await factory.InitializeDatabase(); Guid id;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); var commerce = scope.ServiceProvider.GetRequiredService<ICommerceRepository>();
            var owner = new CommerceOwner("g:sample-mail-failure", null, null);
            var quote = await commerce.Quote(owner, new([new(Guid.Parse("00000000-0000-4000-8000-000000000013"), 1)]), default);
            var order = await commerce.Accept(owner, "mail-failure-key-123456789", new(quote.QuoteId, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka" }, null), default);
            id = order.Id;
        }
        var retried = false;
        for (var attempt = 0; attempt < 40; attempt++)
        {
            using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var row = await db.EmailOutbox.AsNoTracking().SingleAsync();
            if (row.Attempts > 0 && row.LeaseUntil == null)
            {
                Assert.Null(row.SentAt); Assert.True(row.NextAttemptAt > row.CreatedAt); Assert.DoesNotContain("sample@example.com", row.ProtectedPayload);
                Assert.True(await db.Orders.AnyAsync(o => o.Id == id)); retried = true; break;
            }
            await Task.Delay(500);
        }
        Assert.True(retried, "SMTP failure did not produce the bounded protected retry state.");
    }
    [MySqlFact]
    public async Task Exhausted_and_expired_mail_payloads_are_scrubbed_and_never_retried()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var factory = new CommerceApiFactory(database.ConnectionString, Path.Combine(Path.GetTempPath(), "kilo", "mail_exhausted_keys_" + Guid.NewGuid().ToString("N")), true, overrides: new Dictionary<string, string?>(CommerceApiFactory.FullFeatures) { ["Mail:Port"] = "1" });
        await factory.InitializeDatabase(); Guid exhaustedId; Guid expiredId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); var mail = scope.ServiceProvider.GetRequiredService<ICommerceMail>();
            var exhausted = mail.Create("sample@example.com", "Sample exhausted mail", "Sample protected retry payload.");
            exhausted.Attempts = 9; exhausted.NextAttemptAt = DateTime.UtcNow.AddSeconds(-1); exhaustedId = exhausted.Id;
            var expired = mail.Create("sample@example.com", "Sample expired mail", "Sample protected expired payload.");
            expired.CreatedAt = DateTime.UtcNow.AddDays(-2); expired.NextAttemptAt = DateTime.UtcNow.AddHours(1); expiredId = expired.Id;
            db.EmailOutbox.AddRange(exhausted, expired); await db.SaveChangesAsync();
        }
        var scrubbed = false;
        for (var attempt = 0; attempt < 40; attempt++)
        {
            using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var rows = await db.EmailOutbox.AsNoTracking().Where(e => e.Id == exhaustedId || e.Id == expiredId).ToArrayAsync();
            if (rows.All(row => row.Attempts == 10 && row.ProtectedPayload == "" && row.LeaseUntil == null))
            {
                Assert.All(rows, row => Assert.Null(row.SentAt)); scrubbed = true;
                await db.EmailOutbox.Where(e => e.Id == exhaustedId || e.Id == expiredId).ExecuteUpdateAsync(s => s.SetProperty(e => e.NextAttemptAt, DateTime.UtcNow.AddSeconds(-1)));
                break;
            }
            await Task.Delay(500);
        }
        Assert.True(scrubbed, "Exhausted and expired payloads were not scrubbed within the worker test window.");
        await Task.Delay(TimeSpan.FromSeconds(6));
        using var finalScope = factory.Services.CreateScope(); var finalDb = finalScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var finalRows = await finalDb.EmailOutbox.AsNoTracking().Where(e => e.Id == exhaustedId || e.Id == expiredId).ToArrayAsync();
        Assert.Equal(2, finalRows.Length);
        Assert.All(finalRows, row => { Assert.Equal(10, row.Attempts); Assert.Equal("", row.ProtectedPayload); Assert.Null(row.SentAt); Assert.Null(row.LeaseUntil); });
    }
}
