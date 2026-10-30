using ElectroApi.Api.Security;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/v1/Order")]
public sealed class OrderController(CommerceSecurity security, ICommerceRepository commerce, OrderAccess access, IConfiguration configuration) : ControllerBase
{
    private object CustomerResponse(OrderDto order) => configuration.GetValue("Commerce:GuestOnly", true) ? new OrderReceiptDto(order.Id, order.Number, order.CreatedAt, order.Money, order.Lines) : order;
    [HttpPost]
    public async Task<IActionResult> Accept(AcceptOrderRequest request, CancellationToken ct)
    {
        var owner = await security.Owner(HttpContext);
        return Ok(CustomerResponse(await commerce.Accept(new(owner.Key, owner.AccountId, owner.Email), Request.Headers["Idempotency-Key"].ToString(), request, ct)));
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
        if (order is null) return NotFound();
        if (configuration.GetValue("Commerce:GuestOnly", true))
        {
            CommerceRules.Require(order.AccountId == owner.AccountId && (owner.AccountId.HasValue || order.CheckoutOwner == owner.Key), "not_found", "Order unavailable.", 404);
            return Ok(CustomerResponse(CommerceRepository.Map(order)));
        }
        return Ok(await access.Read(HttpContext, order.Id));
    }
}
