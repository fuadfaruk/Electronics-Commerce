using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Identity;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ElectroApi.Integration.Tests;

public sealed class CommerceHttpTests
{
    private static string KeyPath() => Path.Combine(Path.GetTempPath(), "kilo", "electromart_keys_" + Guid.NewGuid().ToString("N"));
    private static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
    private static async Task<JsonElement> GuestOrder(CommerceApiFactory factory, HttpClient client, string key = "http-checkout-123456789")
    {
        var productId = Guid.Parse("00000000-0000-4000-8000-000000000013");
        using var quoteResponse = await CommerceApiFactory.Send(client, "Checkout/quote", new { items = new[] { new { productId, quantity = 1 } } });
        var quote = await Data(quoteResponse);
        using var orderResponse = await CommerceApiFactory.Send(client, "Order", new { quoteId = quote.GetProperty("quoteId").GetGuid(), contact = new { name = "Sample Customer", email = "owner@example.com", phone = "01712345678" }, deliveryAddress = new { street = "123 Sample Road", area = "Sample Area", city = "Dhaka", district = "Dhaka" } }, key);
        return await Data(orderResponse);
    }
    private static async Task<Guid> CreateAccount(CommerceApiFactory factory, string email, bool admin = false)
    {
        using var scope = factory.Services.CreateScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser { Id = Guid.NewGuid(), Email = email, UserName = email, EmailConfirmed = true, Name = "Sample Account" };
        Assert.True((await users.CreateAsync(user, "StrongPass1!")).Succeeded);
        if (admin)
        {
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
            Assert.True((await roles.CreateAsync(new IdentityRole<Guid>("Admin"))).Succeeded);
            Assert.True((await users.AddToRoleAsync(user, "Admin")).Succeeded);
        }
        return user.Id;
    }
    private static async Task Login(HttpClient client, string email) { using var response = await CommerceApiFactory.Send(client, "Auth/login", new { email, password = "StrongPass1!" }); await Data(response); }

    [MySqlFact]
    public async Task Guest_capability_exchange_scopes_access_and_verified_claim_revokes_all_guest_paths()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, KeyPath()); await factory.InitializeDatabase();
        using var guest = factory.Browser(); var order = await GuestOrder(factory, guest); var id = order.GetProperty("id").GetGuid();
        using var own = await guest.GetAsync("/api/v1/Order/" + id); await Data(own);
        using var attempt = await guest.GetAsync("/api/v1/Order/attempt/http-checkout-123456789"); Assert.Equal(id, (await Data(attempt)).GetProperty("id").GetGuid());
        using var stranger = factory.Browser(); using var leakedId = await stranger.GetAsync("/api/v1/Order/" + id); Assert.Equal(HttpStatusCode.NotFound, leakedId.StatusCode);
        using var publicList = await stranger.GetAsync("/api/v1/Order"); Assert.Equal(HttpStatusCode.Unauthorized, publicList.StatusCode);
        var capability = CommerceRepository.NewToken();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            db.GuestCapabilities.Add(new() { OrderId = id, TokenHash = CommerceRepository.Hash(capability), ExpiresAt = DateTime.UtcNow.AddHours(1) }); await db.SaveChangesAsync();
        }
        using var emailDevice = factory.Browser();
        using var linkGet = await emailDevice.GetAsync("/api/v1/Guest/exchange?orderId=" + id); Assert.Equal(HttpStatusCode.Unauthorized, linkGet.StatusCode);
        using var exchange = await CommerceApiFactory.Send(emailDevice, "Guest/exchange", new { orderId = id, capability }); await Data(exchange);
        using var grant = await emailDevice.GetAsync("/api/v1/Order/" + id); await Data(grant);
        using var otherOrder = await emailDevice.GetAsync("/api/v1/Order/" + Guid.NewGuid()); Assert.Equal(HttpStatusCode.NotFound, otherOrder.StatusCode);
        await CreateAccount(factory, "owner@example.com"); await CreateAccount(factory, "unrelated@example.com");
        using var account = factory.Browser(); await Login(account, "owner@example.com");
        using var noAutoClaim = await account.GetAsync("/api/v1/Account/orders"); Assert.Empty((await Data(noAutoClaim)).GetProperty("items").EnumerateArray());
        using var claimRequest = await CommerceApiFactory.Send(account, "Account/order-claims/request", new { orderId = id }); await Data(claimRequest);
        Guid claimId; var proof = CommerceRepository.NewToken();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); var claim = await db.OrderClaims.SingleAsync(c => c.OrderId == id); claimId = claim.Id; claim.TokenHash = CommerceRepository.Hash(proof); await db.SaveChangesAsync();
        }
        using var unrelated = factory.Browser(); await Login(unrelated, "unrelated@example.com");
        using var wrongAccount = await CommerceApiFactory.Send(unrelated, "Account/order-claims/complete", new { claimId, proof }); Assert.Equal(HttpStatusCode.BadRequest, wrongAccount.StatusCode);
        using var completed = await CommerceApiFactory.Send(account, "Account/order-claims/complete", new { claimId, proof }); var claimed = await Data(completed);
        Assert.Equal(order.GetProperty("contact").GetRawText(), claimed.GetProperty("contact").GetRawText());
        using var consumed = await CommerceApiFactory.Send(account, "Account/order-claims/complete", new { claimId, proof }); Assert.Equal(HttpStatusCode.Conflict, consumed.StatusCode);
        using var oldGuest = await guest.GetAsync("/api/v1/Order/" + id); Assert.Equal(HttpStatusCode.NotFound, oldGuest.StatusCode);
        using var oldGrant = await emailDevice.GetAsync("/api/v1/Order/" + id); Assert.Equal(HttpStatusCode.NotFound, oldGrant.StatusCode);
        using var revokedLink = await CommerceApiFactory.Send(emailDevice, "Guest/exchange", new { orderId = id, capability }); Assert.Equal(HttpStatusCode.BadRequest, revokedLink.StatusCode);
        using var linked = await account.GetAsync("/api/v1/Account/orders"); Assert.Single((await Data(linked)).GetProperty("items").EnumerateArray());
        using var unauthorized = await unrelated.GetAsync("/api/v1/Account/orders/" + id); Assert.Equal(HttpStatusCode.NotFound, unauthorized.StatusCode);
    }

    [MySqlFact]
    public async Task Admin_policy_is_enforced_for_direct_calls_and_stale_roles_and_unknown_user_input_is_safe()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, KeyPath()); await factory.InitializeDatabase();
        await CreateAccount(factory, "customer@example.com"); var adminId = await CreateAccount(factory, "admin@example.com", true);
        using var anonymous = factory.Browser(); using var anonymousAdmin = await anonymous.GetAsync("/api/v1/Admin/orders"); Assert.Equal(HttpStatusCode.Unauthorized, anonymousAdmin.StatusCode);
        using var customer = factory.Browser(); await Login(customer, "customer@example.com");
        using var forbidden = await customer.GetAsync("/api/v1/Admin/products"); Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        using var directMutation = await CommerceApiFactory.Send(customer, "Admin/products", new { slug = "sample-new", name = "Sample New", categoryId = Guid.NewGuid(), price = 100 }); Assert.Equal(HttpStatusCode.Forbidden, directMutation.StatusCode);
        using var admin = factory.Browser(); await Login(admin, "admin@example.com");
        using var staff = await admin.GetAsync("/api/v1/Admin/categories"); await Data(staff);
        using var malformed = await CommerceApiFactory.Send(admin, "Admin/products", new { slug = "invalid", price = -1 }); Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        var safe = await malformed.Content.ReadAsStringAsync(); Assert.DoesNotContain("Password", safe); Assert.DoesNotContain("Connection", safe); Assert.DoesNotContain("stack", safe.ToLowerInvariant());
        using (var scope = factory.Services.CreateScope()) { var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>(); var user = (await users.FindByIdAsync(adminId.ToString()))!; Assert.True((await users.RemoveFromRoleAsync(user, "Admin")).Succeeded); }
        using var demoted = await admin.GetAsync("/api/v1/Admin/orders"); Assert.Equal(HttpStatusCode.Forbidden, demoted.StatusCode);
    }

    [MySqlFact]
    public async Task Account_checkout_uses_verified_email_and_lost_auth_never_falls_back_to_guest()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, KeyPath()); await factory.InitializeDatabase();
        await CreateAccount(factory, "account@example.com"); using var browser = factory.Browser(); await Login(browser, "account@example.com");
        var productId = Guid.Parse("00000000-0000-4000-8000-000000000013");
        using var quoteResponse = await CommerceApiFactory.Send(browser, "Checkout/quote", new { items = new[] { new { productId, quantity = 1 } } }); var quote = await Data(quoteResponse);
        Assert.Equal("account", quote.GetProperty("ownerKind").GetString());
        using var orderResponse = await CommerceApiFactory.Send(browser, "Order", new { quoteId = quote.GetProperty("quoteId").GetGuid(), contact = new { name = "Sample Customer", email = "different@example.com", phone = "01712345678" }, deliveryAddress = new { street = "123 Sample Road", area = "Sample Area", city = "Dhaka", district = "Dhaka" } }, "account-key-123456789");
        var order = await Data(orderResponse); Assert.Equal("account@example.com", order.GetProperty("contact").GetProperty("email").GetString());
        using var logout = await CommerceApiFactory.Send(browser, "Auth/logout", new { }); await Data(logout);
        using var replayAsGuest = await CommerceApiFactory.Send(browser, "Order", new { quoteId = quote.GetProperty("quoteId").GetGuid(), contact = new { name = "Sample Customer", email = "account@example.com", phone = "01712345678" }, deliveryAddress = new { street = "123 Sample Road", area = "Sample Area", city = "Dhaka", district = "Dhaka" } }, "account-key-123456789"); Assert.Equal(HttpStatusCode.Conflict, replayAsGuest.StatusCode);
        using var privateOrder = await browser.GetAsync("/api/v1/Order/" + order.GetProperty("id").GetGuid()); Assert.Equal(HttpStatusCode.NotFound, privateOrder.StatusCode);
    }
    [MySqlFact]
    public async Task Claim_commit_before_waiting_guest_read_rechecks_current_ownership()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, KeyPath()); await factory.InitializeDatabase();
        using var guest = factory.Browser(); var order = await GuestOrder(factory, guest); var id = order.GetProperty("id").GetGuid();
        var accountId = await CreateAccount(factory, "owner@example.com");
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Orders WHERE Id = {id.ToString()} FOR UPDATE");
        var pendingRead = guest.GetAsync("/api/v1/Order/" + id);
        await db.Orders.Where(o => o.Id == id).ExecuteUpdateAsync(s => s.SetProperty(o => o.AccountId, accountId).SetProperty(o => o.Version, o => o.Version + 1));
        await transaction.CommitAsync();
        using var response = await pendingRead; Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var attempt = await guest.GetAsync("/api/v1/Order/attempt/http-checkout-123456789"); Assert.Equal(HttpStatusCode.NotFound, attempt.StatusCode);
    }
}
