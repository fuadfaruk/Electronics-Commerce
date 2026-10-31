using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Identity;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Notifications;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ElectroApi.Integration.Tests;

public sealed class GuestOnlyHttpTests
{
    private const string UnusedConnection = "Server=127.0.0.1;Port=1;Database=electromart_test_unused;User ID=sample;Password=not-real;SslMode=Disabled;ConnectionTimeout=1;";
    private static readonly Guid ProductId = Guid.Parse("00000000-0000-4000-8000-000000000013");
    private static readonly string[] EmailPaths = ["Auth/register", "Auth/verify", "Auth/resend", "Auth/forgot", "Auth/reset", "Account/order-claims/request", "Account/order-claims/complete"];
    private static string Keys() => Path.Combine(Path.GetTempPath(), "kilo", "guest_only_keys_" + Guid.NewGuid().ToString("N"));
    private static AcceptOrderRequest Request(Guid quote) => new(quote, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka" }, "Private delivery note");
    private static HttpClient Browser(WebApplicationFactory<Program> factory) => factory.CreateClient(new() { BaseAddress = new Uri(CommerceApiFactory.Origin), AllowAutoRedirect = false });
    private static WebApplicationFactory<Program> WithoutDatabase(CommerceApiFactory factory, ReceiptCommerce? commerce = null) => factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
    {
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        if (commerce is not null) services.AddScoped<ICommerceRepository>(_ => commerce);
        // Ephemeral keys and no outbox workers isolate HTTP contracts from certificate, DB and SMTP infrastructure.
        foreach (var worker in services.Where(s => s.ServiceType == typeof(IHostedService) &&
            (s.ImplementationType == typeof(MailOutboxWorker) || s.ImplementationType == typeof(OwnerNotificationOutboxWorker) ||
             s.ImplementationType?.Namespace?.StartsWith("Microsoft.AspNetCore.DataProtection", StringComparison.Ordinal) == true)).ToArray()) services.Remove(worker);
    }));
    private static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
    private static async Task<JsonElement> Problem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(code, problem.GetProperty("code").GetString());
        return problem;
    }
    private static OrderReceiptDto Receipt(JsonElement data)
    {
        Assert.Equal(new[] { "createdAt", "id", "lines", "money", "number" }, data.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        return data.Deserialize<OrderReceiptDto>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }
    private static void SameReceipt(OrderReceiptDto expected, OrderReceiptDto actual)
    {
        Assert.Equal(expected.Id, actual.Id); Assert.Equal(expected.Number, actual.Number); Assert.Equal(expected.CreatedAt, actual.CreatedAt);
        Assert.Equal(expected.Money, actual.Money); Assert.Equal(expected.Lines, actual.Lines);
    }
    private static async Task<Guid> Quote(HttpClient browser)
    {
        using var response = await CommerceApiFactory.Send(browser, "Checkout/quote", new QuoteRequest([new(ProductId, 1)]));
        return (await Data(response)).GetProperty("quoteId").GetGuid();
    }
    private static async Task<ApplicationUser> Account(CommerceApiFactory factory, string email, bool admin = false, bool verified = true, bool active = true)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser { Id = Guid.NewGuid(), Email = email, UserName = email, EmailConfirmed = verified, IsActive = active, Name = "Sample Account" };
        Assert.True((await users.CreateAsync(user, "StrongPass1!")).Succeeded);
        if (admin)
        {
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
            if (!await roles.RoleExistsAsync("Admin")) Assert.True((await roles.CreateAsync(new IdentityRole<Guid>("Admin"))).Succeeded);
            Assert.True((await users.AddToRoleAsync(user, "Admin")).Succeeded);
        }
        return user;
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Default_and_missing_guest_flag_return_only_the_immutable_receipt_and_keep_security_gates(bool removeFlag)
    {
        await using var factory = new CommerceApiFactory(UnusedConnection, Keys(), overrides: removeFlag ? new Dictionary<string, string?> { ["Commerce:GuestOnly"] = null } : null);
        var commerce = new ReceiptCommerce(); await using var host = WithoutDatabase(factory, commerce); using var browser = Browser(host);
        var configuration = host.Services.GetRequiredService<IConfiguration>();
        Assert.True(configuration.GetValue("Commerce:GuestOnly", true)); Assert.False(configuration.GetValue("Mail:Enabled", false));
        Assert.True(configuration.GetValue("Commerce:CheckoutEnabled", false));
        using var missingCsrf = await CommerceApiFactory.Send(browser, "Checkout/quote", new QuoteRequest([new(ProductId, 1)]), csrf: false);
        await Problem(missingCsrf, HttpStatusCode.BadRequest, "csrf_invalid");
        using var wrongOrigin = await CommerceApiFactory.Send(browser, "Checkout/quote", new QuoteRequest([new(ProductId, 1)]), origin: "https://attacker.example");
        await Problem(wrongOrigin, HttpStatusCode.Forbidden, "origin_invalid");
        var request = Request(await Quote(browser)); const string key = "guest-contract-key-123456789";
        using var accepted = await CommerceApiFactory.Send(browser, "Order", request, key); var original = Receipt(await Data(accepted));
        commerce.Order.Fulfillment = OrderStatus.Delivered; commerce.Order.Payment = PaymentStatus.Collected; commerce.Order.Version++;
        commerce.Order.Events.Add(new() { Action = "Collected", Note = "Private staff note", Version = commerce.Order.Version });
        using var replay = await CommerceApiFactory.Send(browser, "Order", request, key); SameReceipt(original, Receipt(await Data(replay)));
        using var attempt = await browser.GetAsync("/api/v1/Order/attempt/" + key); SameReceipt(original, Receipt(await Data(attempt)));
        Assert.Equal("no-store", attempt.Headers.CacheControl?.ToString());
        using var tracking = await browser.GetAsync("/api/v1/Order/" + original.Id); await Problem(tracking, HttpStatusCode.NotFound, "feature_unavailable");
        using var logout = await CommerceApiFactory.Send(browser, "Auth/logout", new { }); await Data(logout);
        using var me = await browser.GetAsync("/api/v1/Auth/me"); await Problem(me, HttpStatusCode.Unauthorized, "authentication_required");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Guest_only_direct_customer_routes_are_unavailable_even_if_mail_is_enabled(bool mailEnabled)
    {
        await using var factory = new CommerceApiFactory(UnusedConnection, Keys(), overrides: new Dictionary<string, string?> { ["Mail:Enabled"] = mailEnabled.ToString() });
        await using var host = WithoutDatabase(factory); using var browser = Browser(host);
        foreach (var path in EmailPaths.Concat(["Guest/exchange"]))
        {
            using var response = await CommerceApiFactory.Send(browser, path, new { }, csrf: false);
            await Problem(response, HttpStatusCode.NotFound, "feature_unavailable");
        }
        foreach (var path in new[] { "Account/orders", "account/ORDERS/", "Account/orders/" + Guid.NewGuid(), "Order/" + Guid.NewGuid(), "order/" + Guid.NewGuid() + "/" })
        {
            using var response = await browser.GetAsync("/api/v1/" + path); await Problem(response, HttpStatusCode.NotFound, "feature_unavailable");
        }
        using var admin = await browser.GetAsync("/api/v1/Admin/orders"); await Problem(admin, HttpStatusCode.Unauthorized, "authentication_required");
    }

    [Fact]
    public async Task Reduced_receipt_recovery_does_not_restore_a_claimed_orders_revoked_guest_access()
    {
        await using var factory = new CommerceApiFactory(UnusedConnection, Keys());
        var commerce = new ReceiptCommerce(); await using var host = WithoutDatabase(factory, commerce); using var browser = Browser(host);
        const string key = "guest-claimed-receipt-123456789";
        using var accepted = await CommerceApiFactory.Send(browser, "Order", Request(await Quote(browser)), key); Receipt(await Data(accepted));
        commerce.Order.AccountId = Guid.NewGuid();
        using var attempt = await browser.GetAsync("/api/v1/Order/attempt/" + key);
        await Problem(attempt, HttpStatusCode.NotFound, "not_found");
    }

    [Fact]
    public async Task Mail_off_disables_email_proofs_in_full_mode_without_disabling_existing_checkout_or_staff_auth_routes()
    {
        await using var factory = new CommerceApiFactory(UnusedConnection, Keys(), overrides: new Dictionary<string, string?> { ["Commerce:GuestOnly"] = "false", ["Mail:Enabled"] = "false" });
        await using var host = WithoutDatabase(factory, new ReceiptCommerce()); using var browser = Browser(host);
        foreach (var path in EmailPaths)
        {
            using var response = await CommerceApiFactory.Send(browser, path, new { }, csrf: false);
            await Problem(response, HttpStatusCode.NotFound, "feature_unavailable");
        }
        using var account = await browser.GetAsync("/api/v1/Account/orders"); await Problem(account, HttpStatusCode.Unauthorized, "authentication_required");
        using var login = await CommerceApiFactory.Send(browser, "Auth/login", new { }); await Problem(login, HttpStatusCode.BadRequest, "invalid_request");
        using var accepted = await CommerceApiFactory.Send(browser, "Order", Request(await Quote(browser)), "full-mode-contract-123456789");
        var order = await Data(accepted); Assert.True(order.TryGetProperty("fulfillment", out _)); Assert.True(order.TryGetProperty("payment", out _)); Assert.True(order.TryGetProperty("events", out _));
    }

    [Fact]
    public async Task Production_checkout_does_not_depend_on_SMTP_or_Telegram_when_services_are_disabled()
    {
        var settings = new Dictionary<string, string?>
        {
            ["AllowedHosts"] = "localhost", ["Security:KeyCertificateThumbprint"] = "synthetic-test-thumbprint",
            ["Mail:Enabled"] = "false", ["Mail:Host"] = "", ["Mail:Sender"] = "", ["Mail:EnableSsl"] = "false",
            ["OwnerNotifications:Enabled"] = "false", ["Telegram:BotToken"] = "synthetic-invalid-token", ["Telegram:OwnerChatId"] = "@synthetic-owner"
        };
        await using var factory = new CommerceApiFactory(UnusedConnection.Replace("SslMode=Disabled", "SslMode=VerifyFull"), Keys(), environment: "Production", overrides: settings);
        await using var host = WithoutDatabase(factory, new ReceiptCommerce()); using var browser = Browser(host);
        var quote = await Quote(browser);
        using var accepted = await CommerceApiFactory.Send(browser, "Order", Request(quote), "production-guest-key-123456789"); Receipt(await Data(accepted));
        host.Services.GetRequiredService<IConfiguration>()["Commerce:CheckoutEnabled"] = "false";
        using var paused = await CommerceApiFactory.Send(browser, "Checkout/quote", new QuoteRequest([new(ProductId, 1)]));
        await Problem(paused, HttpStatusCode.ServiceUnavailable, "temporarily_unavailable");
    }

    [MySqlFact]
    public async Task Guest_receipt_replay_and_attempt_remain_immutable_after_real_staff_changes_and_cancellation()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, Keys()); await factory.InitializeDatabase();
        using var guest = factory.Browser(); var request = Request(await Quote(guest)); const string key = "guest-staff-recovery-123456789";
        using var accepted = await CommerceApiFactory.Send(guest, "Order", request, key); var original = Receipt(await Data(accepted));
        await Account(factory, "admin@example.com", admin: true); using var admin = factory.Browser();
        using var login = await CommerceApiFactory.Send(admin, "Auth/login", new LoginRequest("admin@example.com", "StrongPass1!")); await Data(login);
        using var confirmed = await CommerceApiFactory.Send(admin, $"Admin/orders/{original.Id}/fulfillment", new { status = "Confirmed", expectedVersion = 1, note = "Private staff confirmation" }, "guest-staff-confirm-123456789");
        Assert.Equal("Confirmed", (await Data(confirmed)).GetProperty("fulfillment").GetString());
        using var cancelled = await CommerceApiFactory.Send(admin, $"Admin/orders/{original.Id}/cancel", new VersionCommand(2, "Private staff cancellation"), "guest-staff-cancel-123456789");
        Assert.Equal("Cancelled", (await Data(cancelled)).GetProperty("fulfillment").GetString());
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            await db.Products.Where(p => p.Id == ProductId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Name, "Changed catalog name").SetProperty(p => p.Price, 999m));
            await db.Quotes.Where(q => q.Id == request.QuoteId).ExecuteUpdateAsync(s => s.SetProperty(q => q.ExpiresAt, DateTime.UtcNow.AddHours(-1)));
            Assert.Equal(0, await db.EmailOutbox.CountAsync()); Assert.Equal(0, await db.GuestCapabilities.CountAsync()); Assert.Equal(0, await db.OwnerOrderNotifications.CountAsync());
        }
        using var replay = await CommerceApiFactory.Send(guest, "Order", request, key); SameReceipt(original, Receipt(await Data(replay)));
        using var attempt = await guest.GetAsync("/api/v1/Order/attempt/" + key); SameReceipt(original, Receipt(await Data(attempt)));
        using var newOrder = await CommerceApiFactory.Send(guest, "Order", Request(await Quote(guest)), "guest-staff-new-123456789"); await Problem(newOrder, HttpStatusCode.Conflict, "guest_order_limit");
        using var unknown = factory.Browser(); using var unknownAttempt = await unknown.GetAsync("/api/v1/Order/attempt/" + key); Assert.Equal(HttpStatusCode.Unauthorized, unknownAttempt.StatusCode);
        using var csrf = await unknown.GetAsync("/api/v1/Security/csrf"); await Data(csrf);
        using var privateAttempt = await unknown.GetAsync("/api/v1/Order/attempt/" + key); Assert.Equal(HttpStatusCode.NotFound, privateAttempt.StatusCode);
        using var staffOrder = await admin.GetAsync("/api/v1/Admin/orders/" + original.Id); var full = await Data(staffOrder);
        Assert.Equal("Cancelled", full.GetProperty("fulfillment").GetString()); Assert.Equal(3, full.GetProperty("version").GetInt64());
        Assert.Contains(full.GetProperty("events").EnumerateArray(), e => e.GetProperty("note").GetString() == "Private staff cancellation");
    }

    [MySqlFact]
    public async Task Guest_only_login_accepts_only_active_verified_admins_and_admin_checkout_requires_explicit_sign_out()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, Keys()); await factory.InitializeDatabase();
        await Account(factory, "customer@example.com"); await Account(factory, "admin@example.com", admin: true);
        await Account(factory, "unverified-admin@example.com", admin: true, verified: false); await Account(factory, "inactive-admin@example.com", admin: true, active: false);
        using var browser = factory.Browser(); string? detail = null;
        foreach (var loginRequest in new[]
        {
            new LoginRequest("unknown@example.com", "StrongPass1!"), new LoginRequest("customer@example.com", "StrongPass1!"),
            new LoginRequest("unverified-admin@example.com", "StrongPass1!"), new LoginRequest("inactive-admin@example.com", "StrongPass1!"),
            new LoginRequest("admin@example.com", "WrongPassword1!")
        })
        {
            using var response = await CommerceApiFactory.Send(browser, "Auth/login", loginRequest);
            var problem = await Problem(response, HttpStatusCode.Unauthorized, "authentication_required");
            var current = problem.GetProperty("detail").GetString(); detail ??= current; Assert.Equal(detail, current);
            Assert.False(response.Headers.TryGetValues("Set-Cookie", out var cookies) && cookies.Any(c => c.StartsWith("ElectroMart.Auth=")));
        }
        using var login = await CommerceApiFactory.Send(browser, "Auth/login", new LoginRequest("admin@example.com", "StrongPass1!")); Assert.True((await Data(login)).GetProperty("isAdmin").GetBoolean());
        using var me = await browser.GetAsync("/api/v1/Auth/me"); Assert.True((await Data(me)).GetProperty("isAdmin").GetBoolean());
        using var orders = await browser.GetAsync("/api/v1/Admin/orders"); await Data(orders);
        using var disabledAccount = await browser.GetAsync("/api/v1/Account/orders"); await Problem(disabledAccount, HttpStatusCode.NotFound, "feature_unavailable");
        using var accountQuote = await CommerceApiFactory.Send(browser, "Checkout/quote", new QuoteRequest([new(ProductId, 1)])); await Problem(accountQuote, HttpStatusCode.Conflict, "guest_checkout_required");
        using var accountAccept = await CommerceApiFactory.Send(browser, "Order", Request(Guid.NewGuid()), "admin-guest-required-123456789"); await Problem(accountAccept, HttpStatusCode.Conflict, "guest_checkout_required");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); Assert.Equal(0, await db.Orders.CountAsync()); Assert.Equal(0, await db.CommandReceipts.CountAsync()); Assert.Equal(0, await db.EmailOutbox.CountAsync());
        }
        using var logout = await CommerceApiFactory.Send(browser, "Auth/logout", new { }); await Data(logout);
        var request = Request(await Quote(browser)); using var guestAccept = await CommerceApiFactory.Send(browser, "Order", request, "admin-signed-out-123456789"); Receipt(await Data(guestAccept));
    }

    [MySqlFact]
    public async Task Mode_switch_keeps_original_account_replay_before_rejecting_new_account_acceptance()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, Keys(), overrides: CommerceApiFactory.FullFeatures); await factory.InitializeDatabase();
        await Account(factory, "customer@example.com"); using var browser = factory.Browser();
        using var login = await CommerceApiFactory.Send(browser, "Auth/login", new LoginRequest("customer@example.com", "StrongPass1!")); await Data(login);
        var request = Request(await Quote(browser)); const string key = "account-original-replay-123456789";
        using var accepted = await CommerceApiFactory.Send(browser, "Order", request, key); var full = await Data(accepted);
        var configuration = factory.Services.GetRequiredService<IConfiguration>(); configuration["Commerce:GuestOnly"] = "true"; configuration["Mail:Enabled"] = "false";
        using var me = await browser.GetAsync("/api/v1/Auth/me"); await Data(me);
        using var blockedQuote = await CommerceApiFactory.Send(browser, "Checkout/quote", new QuoteRequest([new(ProductId, 1)])); await Problem(blockedQuote, HttpStatusCode.Conflict, "guest_checkout_required");
        using var blockedAccept = await CommerceApiFactory.Send(browser, "Order", request, "account-different-key-123456789"); await Problem(blockedAccept, HttpStatusCode.Conflict, "guest_checkout_required");
        using var replay = await CommerceApiFactory.Send(browser, "Order", request, key); var receipt = Receipt(await Data(replay)); Assert.Equal(full.GetProperty("id").GetGuid(), receipt.Id);
        using var attempt = await browser.GetAsync("/api/v1/Order/attempt/" + key); SameReceipt(receipt, Receipt(await Data(attempt)));
        using var tracking = await browser.GetAsync("/api/v1/Order/" + receipt.Id); await Problem(tracking, HttpStatusCode.NotFound, "feature_unavailable");
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        Assert.Equal(1, await db.Orders.CountAsync()); Assert.Equal(1, await db.CommandReceipts.CountAsync()); Assert.Equal(1, await db.EmailOutbox.CountAsync());
        Assert.Equal(0, await db.GuestCapabilities.CountAsync()); Assert.Equal(0, await db.CommandReceipts.CountAsync(r => r.Operation == "guest-order-limit"));
    }

    private sealed class ReceiptCommerce : ICommerceRepository
    {
        public Order Order { get; } = new()
        {
            Number = "EM-RECEIPT-CONTRACT", QuoteId = Guid.NewGuid(), CheckoutOwner = "", NormalizedEmail = "SAMPLE@EXAMPLE.COM", CreatedAt = new DateTime(2026, 10, 24, 12, 0, 0, DateTimeKind.Utc),
            Contact = new("Sample Customer", "sample@example.com", "01712345678"), DeliveryAddress = new("123 Sample Road", "Sample Area", "Dhaka", "Dhaka", null), Notes = "Private delivery note",
            Money = new("BDT", 499m, 80m, 579m, "bdt-cod-v1"), Lines = [new() { ProductId = ProductId, Name = "Sample USB-C Cable", Slug = "sample-usb-c-cable", Quantity = 1, UnitPrice = 499m, LineTotal = 499m }],
            Events = [new() { Action = "Accepted", Version = 1 }]
        };
        private string? _key;
        public Task<QuoteResponse> Quote(CommerceOwner owner, QuoteRequest request, CancellationToken ct) => Task.FromResult(new QuoteResponse(Order.QuoteId, DateTime.UtcNow.AddMinutes(15), "guest", [new(ProductId, "Sample USB-C Cable", "sample-usb-c-cable", 1, 499m, 499m, 3)], Order.Money, []));
        public Task<OrderDto> Accept(CommerceOwner owner, string idempotencyKey, AcceptOrderRequest request, CancellationToken ct) { Order.CheckoutOwner = owner.Key; _key = idempotencyKey; return Task.FromResult(CommerceRepository.Map(Order)); }
        public Task<Order?> Attempt(string ownerKey, string idempotencyKey, CancellationToken ct) => Task.FromResult(ownerKey == Order.CheckoutOwner && idempotencyKey == _key ? Order : null);
        public Task<Order?> Find(Guid id, CancellationToken ct) => Task.FromResult(id == Order.Id ? Order : null);
        public Task<PagedResult<OrderSummary>> Orders(Guid? accountId, string? status, int page, int pageSize, CancellationToken ct) => throw new NotSupportedException();
        public Task<StockResult> AdjustStock(Guid actorId, Guid productId, string idempotencyKey, StockCommand request, CancellationToken ct) => throw new NotSupportedException();
        public Task<OrderDto> ChangeOrder(Guid actorId, Guid id, string idempotencyKey, string action, long expectedVersion, string? note, CancellationToken ct) => throw new NotSupportedException();
    }
}
