using System.Net;
using System.Net.Mail;
using System.Text.Json;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ElectroApi.Infrastructure.Mail;

public sealed record MailPayload(string To, string Subject, string Body);

public sealed class CommerceMail(IDataProtectionProvider protection, IConfiguration configuration) : ICommerceMail
{
    private readonly IDataProtector _protector = protection.CreateProtector("ElectroMart.EmailOutbox.v1");
    public bool Enabled => configuration.GetValue("Mail:Enabled", false);
    public EmailOutbox Create(string to, string subject, string body)
    {
        if (!Enabled) throw new InvalidOperationException("Email delivery is disabled.");
        return new() { ProtectedPayload = _protector.Protect(JsonSerializer.Serialize(new MailPayload(to, subject, body))) };
    }
    public string Link(string path, IReadOnlyDictionary<string, string> fragment)
    {
        var origin = configuration["Storefront:Origin"] ?? throw new InvalidOperationException("A canonical storefront origin is required.");
        return origin.TrimEnd('/') + path + "#" + string.Join('&', fragment.Select(pair => Uri.EscapeDataString(pair.Key) + "=" + Uri.EscapeDataString(pair.Value)));
    }
    internal MailPayload Read(string payload) => JsonSerializer.Deserialize<MailPayload>(_protector.Unprotect(payload))!;
}

public sealed class MailOutboxWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<MailOutboxWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessOnce(stoppingToken); }
            catch (Exception) when (!stoppingToken.IsCancellationRequested) { logger.LogWarning("Email outbox unavailable; retry deferred."); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }

    public async Task ProcessOnce(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var mail = scope.ServiceProvider.GetRequiredService<CommerceMail>();
        var now = DateTime.UtcNow;
        var retention = now.AddDays(-1);
        // Retention is database-only and remains active when SMTP is disabled or unconfigured.
        await db.EmailOutbox.Where(e => e.SentAt == null && e.ProtectedPayload != "" && (e.CreatedAt < retention || e.Attempts >= 10) && (e.LeaseUntil == null || e.LeaseUntil < now)).ExecuteUpdateAsync(s => s.SetProperty(e => e.ProtectedPayload, "").SetProperty(e => e.Attempts, 10).SetProperty(e => e.LeaseUntil, (DateTime?)null), ct);
        if (!mail.Enabled || string.IsNullOrWhiteSpace(configuration["Mail:Host"])) return;
        var ids = await db.EmailOutbox.AsNoTracking().Where(e => e.SentAt == null && e.Attempts < 10 && e.NextAttemptAt <= now && (e.LeaseUntil == null || e.LeaseUntil < now)).OrderBy(e => e.CreatedAt).Take(20).Select(e => e.Id).ToArrayAsync(ct);
        foreach (var id in ids)
        {
            if (!mail.Enabled) break;
            now = DateTime.UtcNow;
            var lease = now.AddMinutes(3);
            var claimed = await db.EmailOutbox.Where(e => e.Id == id && e.SentAt == null && e.Attempts < 10 && e.NextAttemptAt <= now && (e.LeaseUntil == null || e.LeaseUntil < now)).ExecuteUpdateAsync(s => s.SetProperty(e => e.LeaseUntil, lease).SetProperty(e => e.Attempts, e => e.Attempts + 1), ct);
            if (claimed == 0) continue;
            var row = await db.EmailOutbox.AsNoTracking().SingleAsync(e => e.Id == id, ct);
            try
            {
                if (!mail.Enabled)
                {
                    await db.EmailOutbox.Where(e => e.Id == id && e.LeaseUntil == lease).ExecuteUpdateAsync(s => s.SetProperty(e => e.LeaseUntil, (DateTime?)null), ct);
                    break;
                }
                var payload = mail.Read(row.ProtectedPayload);
                using var smtp = new SmtpClient(configuration["Mail:Host"], configuration.GetValue("Mail:Port", 587)) { EnableSsl = configuration.GetValue("Mail:EnableSsl", true), Timeout = 15000 };
                if (!string.IsNullOrWhiteSpace(configuration["Mail:Username"])) smtp.Credentials = new NetworkCredential(configuration["Mail:Username"], configuration["Mail:Password"]);
                using var message = new MailMessage(configuration["Mail:Sender"]!, payload.To, payload.Subject, payload.Body) { IsBodyHtml = false };
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(15));
                await smtp.SendMailAsync(message, timeout.Token);
                await db.EmailOutbox.Where(e => e.Id == id && e.LeaseUntil == lease).ExecuteUpdateAsync(s => s.SetProperty(e => e.SentAt, DateTime.UtcNow).SetProperty(e => e.ProtectedPayload, "").SetProperty(e => e.LeaseUntil, (DateTime?)null), ct);
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // Never log SMTP exceptions: messages may contain recipient addresses or proofs.
                logger.LogWarning("Email outbox delivery failed; a protected retry was scheduled.");
                await db.EmailOutbox.Where(e => e.Id == id && e.LeaseUntil == lease).ExecuteUpdateAsync(s => s.SetProperty(e => e.NextAttemptAt, DateTime.UtcNow.AddSeconds(Math.Min(3600, 15 * Math.Pow(2, row.Attempts)))).SetProperty(e => e.LeaseUntil, (DateTime?)null), ct);
                if (row.Attempts >= 10) await db.EmailOutbox.Where(e => e.Id == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.ProtectedPayload, ""), ct);
            }
        }
    }
}
