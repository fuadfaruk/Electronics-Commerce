using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Infrastructure.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;

namespace ElectroApi.Api.Security;

public sealed record CheckoutOwner(string Key, Guid? AccountId, string? Email)
{
    public string Kind => AccountId.HasValue ? "account" : "guest";
}

public sealed class CommerceSecurity(IDataProtectionProvider protection, UserManager<ApplicationUser> users, IWebHostEnvironment environment, IConfiguration configuration)
{
    public const string AuthCookie = "ElectroMart.Auth";
    public const string GuestCookie = "ElectroMart.Guest";
    private readonly IDataProtector _guest = protection.CreateProtector("ElectroMart.GuestCheckout.v1");
    public static string Token() => Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public CookieOptions Cookie(TimeSpan lifetime) => new() { HttpOnly = true, Secure = !environment.IsDevelopment() || configuration.GetValue("Security:DevelopmentHttps", false), SameSite = SameSiteMode.Lax, Path = "/", MaxAge = lifetime, IsEssential = true };
    public static AccountDto Account(ApplicationUser user, bool admin) => new(user.Id, user.Name, user.Email!, user.EmailConfirmed, admin);
    public async Task<ApplicationUser> RequireAccount(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated != true) throw new CommerceException(401, "authentication_required", "Sign in with a verified account to continue.");
        var user = await users.GetUserAsync(context.User);
        if (user is null || !user.IsActive || !user.EmailConfirmed || await users.IsLockedOutAsync(user)) throw new CommerceException(401, "session_expired", "Your account session expired. Sign in again.");
        return user;
    }
    public async Task<CheckoutOwner> Owner(HttpContext context, bool createGuest = false)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var user = await RequireAccount(context); return new("a:" + user.Id.ToString("N"), user.Id, user.Email);
        }
        // A rejected/expired account cookie is never silently treated as guest checkout.
        if (context.Request.Cookies.ContainsKey(AuthCookie)) throw new CommerceException(401, "session_expired", "Your account session expired. Sign in again.");
        var raw = context.Request.Cookies[GuestCookie];
        if (raw is not null)
        {
            try
            {
                var pieces = _guest.Unprotect(raw).Split(':');
                if (pieces.Length == 2 && pieces[0].Length == 43 && long.TryParse(pieces[1], out var expires) && expires > DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return new("g:" + Hash(pieces[0]), null, null);
            }
            catch (CryptographicException) { }
        }
        if (!createGuest) throw new CommerceException(401, "session_expired", "Your checkout session expired. Start a new quote.");
        var token = Token(); var expiration = DateTimeOffset.UtcNow.AddDays(30).ToUnixTimeSeconds();
        context.Response.Cookies.Append(GuestCookie, _guest.Protect(token + ":" + expiration), Cookie(TimeSpan.FromDays(30)));
        return new("g:" + Hash(token), null, null);
    }
}

public static class CurrentAccount
{
    public static Guid Id(ClaimsPrincipal principal) => Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
