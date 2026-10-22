using System.Text;
using ElectroApi.Api.Security;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, EnableRateLimiting("auth"), Route("api/v1/Auth")]
public sealed class AuthController(UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, ApplicationDbContext db, ICommerceMail mail, CommerceSecurity security) : ControllerBase
{
    private static object Generic => new { message = "If this address is eligible, an email has been queued with the next steps." };
    private async Task Verification(ApplicationUser user)
    {
        var token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GenerateEmailConfirmationTokenAsync(user)));
        db.EmailOutbox.Add(mail.Create(user.Email!, "Verify your ElectroMart account", "Verify your account by opening this link and choosing Confirm verification:\n" + mail.Link("/account/verify", new Dictionary<string, string> { ["userId"] = user.Id.ToString(), ["token"] = token }) + "\nThis link expires in one hour."));
        await db.SaveChangesAsync();
    }
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterRequest request)
    {
        var email = request.Email.Trim();
        var user = new ApplicationUser { Id = Guid.NewGuid(), UserName = email, Email = email, Name = request.Name.Trim() };
        var password = await users.PasswordValidators[0].ValidateAsync(users, user, request.Password);
        CommerceRules.Require(password.Succeeded, "invalid_password", "Use at least 10 characters with upper and lowercase letters, a number and a symbol.");
        var existing = await users.FindByEmailAsync(email);
        if (existing is not null) return Ok(Generic);
        await using var transaction = await db.Database.BeginTransactionAsync();
        var result = await users.CreateAsync(user, request.Password);
        if (result.Succeeded) { await Verification(user); await transaction.CommitAsync(); }
        else if (!result.Errors.All(e => e.Code.StartsWith("Duplicate", StringComparison.Ordinal))) throw new CommerceException(400, "invalid_account", "Account details do not meet the requirements.");
        return Ok(Generic);
    }
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is null || !user.IsActive) throw new CommerceException(401, "authentication_required", "Sign-in failed. Check your credentials and verify your email.");
        var result = await signIn.PasswordSignInAsync(user, request.Password, true, true);
        if (!result.Succeeded) throw new CommerceException(401, "authentication_required", "Sign-in failed. Check your credentials and verify your email.");
        return Ok(CommerceSecurity.Account(user, await users.IsInRoleAsync(user, "Admin")));
    }
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        if (User.Identity?.IsAuthenticated == true)
        {
            var revoked = false;
            for (var attempt = 0; attempt < 3; attempt++)
            {
                db.ChangeTracker.Clear();
                var user = await users.GetUserAsync(User);
                if (user is null || (await users.UpdateSecurityStampAsync(user)).Succeeded) { revoked = true; break; }
            }
            if (!revoked) throw new CommerceException(503, "temporarily_unavailable", "Global sign-out could not be confirmed. Retry sign-out before leaving a shared device.");
        }
        await signIn.SignOutAsync();
        Response.Cookies.Delete(CommerceSecurity.AuthCookie, security.Cookie(TimeSpan.Zero));
        return Ok(new { message = "Signed out on all devices." });
    }
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await security.RequireAccount(HttpContext);
        return Ok(CommerceSecurity.Account(user, await users.IsInRoleAsync(user, "Admin")));
    }
    [HttpPost("verify")]
    public async Task<IActionResult> Verify(EmailProofRequest request)
    {
        var user = await users.FindByIdAsync(request.UserId.ToString());
        if (user is null || user.EmailConfirmed) throw new CommerceException(400, "proof_invalid", "This verification link is invalid or already used.");
        string token;
        try { token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(request.Token)); } catch (FormatException) { throw new CommerceException(400, "proof_invalid", "This verification link is invalid or expired."); }
        if (!(await users.ConfirmEmailAsync(user, token)).Succeeded) throw new CommerceException(409, "proof_expired", "This verification link is invalid or expired. Request a new link.");
        return Ok(new { message = "Email verified. You can now sign in." });
    }
    [HttpPost("resend")]
    public async Task<IActionResult> Resend(EmailRequest request)
    {
        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is { EmailConfirmed: false, IsActive: true }) await Verification(user);
        return Ok(Generic);
    }
    [HttpPost("forgot")]
    public async Task<IActionResult> Forgot(EmailRequest request)
    {
        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is { EmailConfirmed: true, IsActive: true })
        {
            var token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(user)));
            db.EmailOutbox.Add(mail.Create(user.Email!, "Reset your ElectroMart password", "Open the link and choose a new password:\n" + mail.Link("/account/reset", new Dictionary<string, string> { ["userId"] = user.Id.ToString(), ["token"] = token }) + "\nThis link expires in one hour."));
            await db.SaveChangesAsync();
        }
        return Ok(Generic);
    }
    [HttpPost("reset")]
    public async Task<IActionResult> Reset(ResetRequest request)
    {
        var user = await users.FindByIdAsync(request.UserId.ToString());
        string token;
        try { token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(request.Token)); } catch (FormatException) { throw new CommerceException(400, "proof_invalid", "This password reset link is invalid or expired."); }
        if (user is not { EmailConfirmed: true, IsActive: true } || !(await users.ResetPasswordAsync(user, token, request.Password)).Succeeded) throw new CommerceException(400, "proof_invalid", "The reset link is invalid, expired or the password does not meet requirements.");
        if (!(await users.SetLockoutEndDateAsync(user, null)).Succeeded) throw new CommerceException(503, "temporarily_unavailable", "Password reset succeeded but account unlock is pending. Sign in after the lockout period.");
        return Ok(new { message = "Password reset. Sign in with your new password." });
    }
}
