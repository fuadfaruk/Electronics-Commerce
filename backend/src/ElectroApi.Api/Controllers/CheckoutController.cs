using ElectroApi.Api.Security;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/v1/Checkout")]
public sealed class CheckoutController(CommerceSecurity security, ICommerceRepository commerce) : ControllerBase
{
    [HttpPost("quote")]
    public async Task<IActionResult> Quote(QuoteRequest request, CancellationToken ct)
    {
        var owner = await security.Owner(HttpContext);
        return Ok(await commerce.Quote(new(owner.Key, owner.AccountId, owner.Email), request, ct));
    }
}
