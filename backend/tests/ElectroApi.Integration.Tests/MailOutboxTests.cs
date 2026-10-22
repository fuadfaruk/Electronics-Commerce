using System.Net.Http.Json;
using System.Text.Json;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ElectroApi.Integration.Tests;

public sealed class MailOutboxTests
{
    [MySqlFact]
    public async Task Protected_outbox_delivers_through_real_local_SMTP_capture_and_scrubs_sent_payload()
    {
        if (Environment.GetEnvironmentVariable("ELECTROMART_TEST_SMTP") != "1") throw new InvalidOperationException("This SMTP gate requires local Mailpit on 1025/8025; set ELECTROMART_TEST_SMTP=1 when explicitly ready.");
        await using var database = await IsolatedDatabase.Create();
        await using var factory = new CommerceApiFactory(database.ConnectionString, Path.Combine(Path.GetTempPath(), "kilo", "mail_keys_" + Guid.NewGuid().ToString("N")), true);
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
}
