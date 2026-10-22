using ElectroApi.Api.Security;
using ElectroApi.Infrastructure.Identity;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/v1/Security")]
public sealed class SecurityController(IAntiforgery antiforgery, CommerceSecurity security, UserManager<ApplicationUser> users) : ControllerBase
{
    [HttpGet("csrf")]
    public async Task<IActionResult> Csrf()
    {
        var owner = await security.Owner(HttpContext, true);
        var user = owner.AccountId.HasValue ? await security.RequireAccount(HttpContext) : null;
        Response.Headers.CacheControl = "no-store";
        return Ok(new { token = antiforgery.GetAndStoreTokens(HttpContext).RequestToken, ownerKind = owner.Kind, account = user is null ? null : CommerceSecurity.Account(user, await users.IsInRoleAsync(user, "Admin")) });
    }
}
