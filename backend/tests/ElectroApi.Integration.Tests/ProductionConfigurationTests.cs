using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ElectroApi.Core.DTOs;
using ElectroApi.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ElectroApi.Integration.Tests;

public sealed class ProductionConfigurationTests
{
    private static string Keys => Path.Combine(Path.GetTempPath(), "kilo", "config_test_keys");
    private static InvalidOperationException Reject(IReadOnlyDictionary<string, string?> settings, string message, string environment = "Production")
    {
        using var factory = new CommerceApiFactory("Server=127.0.0.1;Database=electromart_mvp_dev;User ID=sample;Password=not-real;SslMode=Disabled;", Keys, false, environment, settings);
        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains(message, exception.Message);
        return exception;
    }
    [Fact] public void Missing_connection_is_not_a_runtime_default() => Reject(new Dictionary<string, string?> { ["ConnectionStrings:DefaultConnection"] = "" }, "nonempty ConnectionStrings");
    [Fact] public void Production_storefront_requires_canonical_https() => Reject(new Dictionary<string, string?> { ["Storefront:Origin"] = "http://shop.example.com" }, "canonical storefront HTTPS");
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("*")]
    [InlineData("api.example.com;*")]
    [InlineData("*;api.example.com")]
    [InlineData("api.example.com; *.example.com")]
    [InlineData("api.example.com;")]
    [InlineData("https://api.example.com")]
    [InlineData("api.example.com:443")]
    public void Production_hosts_must_all_be_explicit_valid_hosts(string? hosts) => Reject(new Dictionary<string, string?> { ["AllowedHosts"] = hosts }, "explicit API hosts");
    [Theory]
    [InlineData("api.example.com; www.example.com")]
    [InlineData("127.0.0.1;[::1]")]
    public void Explicit_host_lists_reach_the_next_production_gate(string hosts) => Reject(new Dictionary<string, string?> { ["AllowedHosts"] = hosts, ["Security:KeyCertificateThumbprint"] = "" }, "certificate-encrypted");
    [Fact] public void Production_key_ring_requires_certificate_encryption() => Reject(new Dictionary<string, string?> { ["AllowedHosts"] = "api.example.com", ["Security:KeyCertificateThumbprint"] = "" }, "certificate-encrypted");
    [Theory]
    [InlineData("2147483648")]
    [InlineData("6543210987654321012")]
    [InlineData("9223372036854775807")]
    public void Enabled_notifications_validate_synthetic_Int64_chat_without_network_before_the_next_production_gate(string chat)
    {
        var exception = Reject(new Dictionary<string, string?>
        {
            ["OwnerNotifications:Enabled"] = "true", ["Telegram:BotToken"] = OwnerNotificationTestSettings.BotToken,
            ["Telegram:OwnerChatId"] = chat, ["AllowedHosts"] = "api.example.com", ["Security:KeyCertificateThumbprint"] = ""
        }, "certificate-encrypted");
        Assert.DoesNotContain(OwnerNotificationTestSettings.BotToken, exception.ToString()); Assert.DoesNotContain(chat, exception.Message);
    }
    [Theory]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData("")]
    public void Notification_switch_must_be_explicit_boolean_without_printing_credentials(string enabled)
    {
        var exception = Reject(new Dictionary<string, string?>
        {
            ["OwnerNotifications:Enabled"] = enabled, ["Telegram:BotToken"] = OwnerNotificationTestSettings.BotToken,
            ["Telegram:OwnerChatId"] = "6543210987654321012"
        }, "must be true or false", "Development");
        Assert.DoesNotContain(OwnerNotificationTestSettings.BotToken, exception.ToString()); Assert.DoesNotContain("6543210987654321012", exception.ToString());
    }
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("synthetic-invalid-token")]
    [InlineData("1234:short")]
    public void Enabled_notifications_reject_invalid_token_at_startup_without_exposing_it(string? token)
    {
        var exception = Reject(new Dictionary<string, string?> { ["OwnerNotifications:Enabled"] = "true", ["Telegram:BotToken"] = token, ["Telegram:OwnerChatId"] = "6543210987654321012" }, "valid protected Telegram__BotToken", "Development");
        if (!string.IsNullOrEmpty(token)) Assert.DoesNotContain(token, exception.ToString());
        Assert.DoesNotContain("6543210987654321012", exception.ToString());
    }
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-1001234567890")]
    [InlineData("@synthetic-owner")]
    [InlineData("1.5")]
    [InlineData("+1234567890")]
    [InlineData(" 1234567890")]
    [InlineData("1234567890 ")]
    [InlineData("9223372036854775808")]
    public void Enabled_notifications_reject_nonprivate_or_invalid_chat_at_startup_with_safe_errors(string? chat)
    {
        var exception = Reject(new Dictionary<string, string?> { ["OwnerNotifications:Enabled"] = "true", ["Telegram:BotToken"] = OwnerNotificationTestSettings.BotToken, ["Telegram:OwnerChatId"] = chat }, "positive numeric private-chat ID", "Development");
        Assert.DoesNotContain(OwnerNotificationTestSettings.BotToken, exception.ToString());
        if (!string.IsNullOrEmpty(chat)) Assert.DoesNotContain(chat, exception.Message);
    }
    [Fact]
    public void Disabled_notifications_ignore_unusable_provider_credentials_and_reach_independent_production_gates()
    {
        var exception = Reject(new Dictionary<string, string?>
        {
            ["OwnerNotifications:Enabled"] = "false", ["Telegram:BotToken"] = "synthetic-invalid-token", ["Telegram:OwnerChatId"] = "@synthetic-owner",
            ["AllowedHosts"] = "api.example.com", ["Security:KeyCertificateThumbprint"] = ""
        }, "certificate-encrypted");
        Assert.DoesNotContain("synthetic-invalid-token", exception.ToString()); Assert.DoesNotContain("@synthetic-owner", exception.ToString());
    }
    [Fact]
    public void Keys_cannot_equal_deployment_root_or_be_its_descendants()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "ElectroApi.Api"));
        Reject(new Dictionary<string, string?> { ["Security:KeyPath"] = root }, "outside deploy artifacts", "Development");
        Reject(new Dictionary<string, string?> { ["Security:KeyPath"] = Path.Combine(root, "keys") }, "outside deploy artifacts", "Development");
    }
    [MySqlFact]
    public async Task Maintenance_pauses_all_routed_checkout_variants_without_mutation_and_preserves_private_recovery()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var factory = new CommerceApiFactory(database.ConnectionString, Path.Combine(Path.GetTempPath(), "kilo", "maintenance_keys_" + Guid.NewGuid().ToString("N")));
        await factory.InitializeDatabase(); using var browser = factory.Browser();
        var productId = Guid.Parse("00000000-0000-4000-8000-000000000013"); var quoteRequest = new QuoteRequest([new(productId, 1)]);
        using var quote = await CommerceApiFactory.Send(browser, "Checkout/quote", quoteRequest); Assert.Equal(HttpStatusCode.OK, quote.StatusCode);
        var request = new AcceptOrderRequest((await quote.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("quoteId").GetGuid(), new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka" }, null);
        const string originalKey = "maintenance-accepted-123456789";
        using var accepted = await CommerceApiFactory.Send(browser, "Order", request, originalKey); Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var orderId = (await accepted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var pendingQuote = await CommerceApiFactory.Send(browser, "Checkout/quote", quoteRequest); Assert.Equal(HttpStatusCode.OK, pendingQuote.StatusCode);
        var pendingRequest = request with { QuoteId = (await pendingQuote.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("quoteId").GetGuid() };
        var configuration = factory.Services.GetRequiredService<IConfiguration>(); configuration["Commerce:CheckoutEnabled"] = "false";
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var before = await db.Products.Where(p => p.Id == productId).Select(p => new { p.Stock, p.Version }).SingleAsync();
        foreach (var path in new[] { "Checkout/quote", "Checkout/quote/", "checkout/QUOTE", "checkout/QUOTE/" })
        {
            using var pausedQuote = await CommerceApiFactory.Send(browser, path, quoteRequest);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, pausedQuote.StatusCode);
            Assert.Equal("temporarily_unavailable", (await pausedQuote.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        }
        var attempt = 0;
        foreach (var path in new[] { "Order", "Order/", "order", "order/" })
        {
            using var pausedOrder = await CommerceApiFactory.Send(browser, path, pendingRequest, "maintenance-paused-key-" + attempt++);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, pausedOrder.StatusCode);
        }
        using var pausedReplay = await CommerceApiFactory.Send(browser, "Order/", request, originalKey); Assert.Equal(HttpStatusCode.ServiceUnavailable, pausedReplay.StatusCode);
        using var catalog = await browser.GetAsync("/api/v1/Category"); Assert.Equal(HttpStatusCode.OK, catalog.StatusCode);
        using var tracking = await browser.GetAsync("/api/v1/Order/" + orderId); Assert.Equal(HttpStatusCode.OK, tracking.StatusCode);
        using var recovery = await browser.GetAsync("/api/v1/Order/attempt/" + originalKey); Assert.Equal(HttpStatusCode.OK, recovery.StatusCode);
        Assert.Equal(orderId, (await recovery.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());
        using var stranger = factory.Browser(); using var privateRead = await stranger.GetAsync("/api/v1/Order/" + orderId); Assert.Equal(HttpStatusCode.NotFound, privateRead.StatusCode);
        Assert.Equal(before, await db.Products.Where(p => p.Id == productId).Select(p => new { p.Stock, p.Version }).SingleAsync());
        Assert.Equal(1, await db.Orders.CountAsync()); Assert.Equal(1, await db.CommandReceipts.CountAsync()); Assert.Equal(1, await db.EmailOutbox.CountAsync()); Assert.Equal(1, await db.GuestCapabilities.CountAsync());
        configuration["Commerce:CheckoutEnabled"] = "true";
        using var reopened = await CommerceApiFactory.Send(browser, "Order/", pendingRequest, "maintenance-reopened-key-123456789"); Assert.Equal(HttpStatusCode.OK, reopened.StatusCode);
        Assert.Equal(2, await db.Orders.CountAsync());
    }
    [Fact]
    public async Task Failed_csrf_bootstrap_returns_readable_response_to_the_caller()
    {
        using var browser = new HttpClient(new RejectedCsrfHandler()) { BaseAddress = new Uri(CommerceApiFactory.Origin) };
        using var response = await CommerceApiFactory.Send(browser, "Order", new { });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("csrf-bootstrap-denied", await response.Content.ReadAsStringAsync());
    }
    private sealed class RejectedCsrfHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("csrf-bootstrap-denied") });
    }
}
