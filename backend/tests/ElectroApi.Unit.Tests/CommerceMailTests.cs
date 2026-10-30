using System.Text.Json;
using ElectroApi.Infrastructure.Mail;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;

namespace ElectroApi.Unit.Tests;

public sealed class CommerceMailTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("false")]
    public void Disabled_or_missing_switch_prevents_payload_creation_even_with_provider_credentials(string? enabled)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Mail:Enabled"] = enabled, ["Mail:Host"] = "smtp.example.com", ["Mail:Sender"] = "sender@example.com",
            ["Mail:Username"] = "synthetic-user", ["Mail:Password"] = "synthetic-secret"
        }).Build();
        var mail = new CommerceMail(new EphemeralDataProtectionProvider(), configuration);
        Assert.False(mail.Enabled);
        var error = Assert.Throws<InvalidOperationException>(() => mail.Create("recipient@example.com", "Sample subject", "Sample proof"));
        Assert.Equal("Email delivery is disabled.", error.Message);
        Assert.DoesNotContain("recipient@example.com", error.ToString());
        Assert.DoesNotContain("synthetic-secret", error.ToString());
    }

    [Fact]
    public void Explicit_opt_in_retains_protected_mail_and_can_be_disabled_again_without_restart()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Mail:Enabled"] = "true" }).Build();
        var protection = new EphemeralDataProtectionProvider();
        var mail = new CommerceMail(protection, configuration);
        var row = mail.Create("recipient@example.com", "Sample subject", "Sample proof");
        Assert.True(mail.Enabled);
        Assert.DoesNotContain("recipient@example.com", row.ProtectedPayload);
        var payload = JsonSerializer.Deserialize<MailPayload>(protection.CreateProtector("ElectroMart.EmailOutbox.v1").Unprotect(row.ProtectedPayload));
        Assert.Equal(new MailPayload("recipient@example.com", "Sample subject", "Sample proof"), payload);
        configuration["Mail:Enabled"] = "false";
        Assert.False(mail.Enabled);
        Assert.Throws<InvalidOperationException>(() => mail.Create("recipient@example.com", "Sample subject", "Sample proof"));
        configuration["Mail:Enabled"] = "true";
        Assert.NotEmpty(mail.Create("recipient@example.com", "Sample subject", "Sample proof").ProtectedPayload);
    }
}
