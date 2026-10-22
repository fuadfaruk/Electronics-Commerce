using ElectroApi.Api.Security;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/v1/Order")]
public sealed class OrderController(CommerceSecurity security, ICommerceRepository commerce, OrderAccess access) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Accept(AcceptOrderRequest request, CancellationToken ct)
    {
        var owner = await security.Owner(HttpContext);
        return Ok(await commerce.Accept(new(owner.Key, owner.AccountId, owner.Email), Request.Headers["Idempotency-Key"].ToString(), request, ct));
    }
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Detail(Guid id, CancellationToken ct)
    {
        return Ok(await access.Read(HttpContext, id));
    }
    [HttpGet("attempt/{key}")]
    public async Task<IActionResult> Attempt(string key, CancellationToken ct)
    {
        var owner = await security.Owner(HttpContext);
        var order = await commerce.Attempt(owner.Key, key, ct);
        return order is null ? NotFound() : Ok(await access.Read(HttpContext, order.Id));
    }
}
