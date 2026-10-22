using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ElectroApi.Integration.Tests;

public sealed class IdentityHttpTests
{
    private static string KeyPath() => Path.Combine(Path.GetTempPath(), "kilo", "electromart_keys_" + Guid.NewGuid().ToString("N"));
    [MySqlFact]
    public async Task Cookie_origin_csrf_verification_and_generic_recovery_are_enforced()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var factory = new CommerceApiFactory(database.ConnectionString, KeyPath());
        await factory.InitializeDatabase(); using var client = factory.Browser();
        var account = new { name = "Sample Customer", email = "sample@example.com", password = "StrongPass1!" };
        using var missingCsrf = await CommerceApiFactory.Send(client, "Auth/register", account, csrf: false);
        Assert.Equal(HttpStatusCode.BadRequest, missingCsrf.StatusCode);
        using var wrongOrigin = await CommerceApiFactory.Send(client, "Auth/register", account, origin: "https://attacker.example");
        Assert.Equal(HttpStatusCode.Forbidden, wrongOrigin.StatusCode);
        using var registered = await CommerceApiFactory.Send(client, "Auth/register", account);
        Assert.Equal(HttpStatusCode.OK, registered.StatusCode);
        using var duplicate = await CommerceApiFactory.Send(client, "Auth/register", account);
        Assert.Equal(await registered.Content.ReadAsStringAsync(), await duplicate.Content.ReadAsStringAsync());
        using var weakExisting = await CommerceApiFactory.Send(client, "Auth/register", new { name = "Sample", email = account.email, password = "abcdefghij" });
        using var weakNew = await CommerceApiFactory.Send(client, "Auth/register", new { name = "Sample", email = "new@example.com", password = "abcdefghij" });
        Assert.Equal(HttpStatusCode.BadRequest, weakExisting.StatusCode); Assert.Equal(weakExisting.StatusCode, weakNew.StatusCode);
        Assert.Equal((await weakExisting.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString(), (await weakNew.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        using var unverified = await CommerceApiFactory.Send(client, "Auth/login", new { account.email, account.password });
        Assert.Equal(HttpStatusCode.Unauthorized, unverified.StatusCode);
        using var scope = factory.Services.CreateScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = (await users.FindByEmailAsync(account.email))!;
        var token = await users.GenerateEmailConfirmationTokenAsync(user);
        var encoded = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(token));
        using var verify = await CommerceApiFactory.Send(client, "Auth/verify", new { userId = user.Id, token = encoded }); Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        using var replay = await CommerceApiFactory.Send(client, "Auth/verify", new { userId = user.Id, token = encoded }); Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
        using var login = await CommerceApiFactory.Send(client, "Auth/login", new { account.email, account.password }); Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var cookie = login.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("ElectroMart.Auth="));
        Assert.Contains("httponly", cookie.ToLowerInvariant()); Assert.Contains("secure", cookie.ToLowerInvariant()); Assert.Contains("samesite=lax", cookie.ToLowerInvariant()); Assert.DoesNotContain("domain=", cookie.ToLowerInvariant());
        using var me = await client.GetAsync("/api/v1/Auth/me"); Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        for (var i = 0; i < 20; i++) { using var routineRead = await client.GetAsync("/api/v1/Auth/me"); Assert.Equal(HttpStatusCode.OK, routineRead.StatusCode); }
        using var known = await CommerceApiFactory.Send(client, "Auth/forgot", new { account.email });
        using var unknown = await CommerceApiFactory.Send(client, "Auth/forgot", new { email = "unknown@example.com" });
        Assert.Equal(await known.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        Assert.True(await db.EmailOutbox.CountAsync() >= 2);
        Assert.All(await db.EmailOutbox.ToArrayAsync(), e => { Assert.DoesNotContain(account.email, e.ProtectedPayload); Assert.DoesNotContain(encoded, e.ProtectedPayload); });
    }
    [MySqlFact]
    public async Task Logout_reset_and_security_stamp_revoke_all_devices_and_expired_auth_is_not_guest()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var factory = new CommerceApiFactory(database.ConnectionString, KeyPath()); await factory.InitializeDatabase();
        using var scope = factory.Services.CreateScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser { Id = Guid.NewGuid(), UserName = "verified@example.com", Email = "verified@example.com", EmailConfirmed = true, Name = "Sample" };
        Assert.True((await users.CreateAsync(user, "StrongPass1!")).Succeeded);
        using var first = factory.Browser(); using var second = factory.Browser();
        using var login1 = await CommerceApiFactory.Send(first, "Auth/login", new { email = user.Email, password = "StrongPass1!" }); Assert.Equal(HttpStatusCode.OK, login1.StatusCode);
        using var login2 = await CommerceApiFactory.Send(second, "Auth/login", new { email = user.Email, password = "StrongPass1!" }); Assert.Equal(HttpStatusCode.OK, login2.StatusCode);
        using var logout = await CommerceApiFactory.Send(first, "Auth/logout", new { }); Assert.Equal(HttpStatusCode.OK, logout.StatusCode);
        using var revoked = await second.GetAsync("/api/v1/Auth/me"); Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
        using var notGuest = await second.GetAsync("/api/v1/Security/csrf"); Assert.Equal(HttpStatusCode.OK, notGuest.StatusCode);
        var stale = await notGuest.Content.ReadFromJsonAsync<JsonElement>(); Assert.True(stale.GetProperty("sessionExpired").GetBoolean()); Assert.Equal("account", stale.GetProperty("ownerKind").GetString());
        using var invalid = factory.Browser(false); invalid.DefaultRequestHeaders.Add("Cookie", "ElectroMart.Auth=invalid");
        using var invalidSession = await invalid.GetAsync("/api/v1/Security/csrf"); Assert.Equal(HttpStatusCode.OK, invalidSession.StatusCode);
        Assert.True((await invalidSession.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sessionExpired").GetBoolean());
        await users.UpdateSecurityStampAsync(user);
        using var login3 = await CommerceApiFactory.Send(first, "Auth/login", new { email = user.Email, password = "StrongPass1!" }); Assert.Equal(HttpStatusCode.OK, login3.StatusCode);
        scope.ServiceProvider.GetRequiredService<ApplicationDbContext>().ChangeTracker.Clear();
        user = (await users.FindByEmailAsync("verified@example.com"))!;
        var resetToken = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(user)));
        using var reset = await CommerceApiFactory.Send(first, "Auth/reset", new { userId = user.Id, token = resetToken, password = "NewStrongPass2!" }); Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        using var expired = await first.GetAsync("/api/v1/Auth/me"); Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
    }
    [MySqlFact]
    public async Task Persistent_keys_survive_factory_restart_and_lockout_has_generic_login_response()
    {
        await using var database = await IsolatedDatabase.Create(); var path = KeyPath();
        string cookie;
        await using (var factory = new CommerceApiFactory(database.ConnectionString, path))
        {
            await factory.InitializeDatabase(); using var scope = factory.Services.CreateScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser { Id = Guid.NewGuid(), UserName = "operator@example.com", Email = "operator@example.com", EmailConfirmed = true };
            Assert.True((await users.CreateAsync(user, "StrongPass1!")).Succeeded);
            using var client = factory.Browser(); using var login = await CommerceApiFactory.Send(client, "Auth/login", new { email = user.Email, password = "StrongPass1!" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode); cookie = login.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("ElectroMart.Auth=")).Split(';')[0];
        }
        await using var restarted = new CommerceApiFactory(database.ConnectionString, path);
        using var resumed = restarted.Browser(false); resumed.DefaultRequestHeaders.Add("Cookie", cookie);
        using var me = await resumed.GetAsync("/api/v1/Auth/me"); Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        using var failures = restarted.Browser();
        for (var i = 0; i < 5; i++) { using var response = await CommerceApiFactory.Send(failures, "Auth/login", new { email = "operator@example.com", password = "WrongPassword1!" }); Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode); }
        using var locked = await CommerceApiFactory.Send(failures, "Auth/login", new { email = "operator@example.com", password = "StrongPass1!" }); Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
    }
}
