using ElectroApi.Api.Security;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ElectroApi.Api.Controllers;

[ApiController, Authorize(Policy = "Admin"), Route("api/v1/Admin")]
public sealed class AdminController(ICatalogRepository catalog, ICommerceRepository commerce) : ControllerBase
{
    [HttpGet("categories")] public async Task<IActionResult> Categories(CancellationToken ct) => Ok(await catalog.Categories(true, ct));
    [HttpPost("categories")] public async Task<IActionResult> CreateCategory(CategoryRequest request, CancellationToken ct) => Ok(await catalog.SaveCategory(null, request, ct));
    [HttpPut("categories/{id:guid}")] public async Task<IActionResult> UpdateCategory(Guid id, CategoryRequest request, CancellationToken ct) => Ok(await catalog.SaveCategory(id, request, ct));
    [HttpPost("categories/{id:guid}/archive")] public async Task<IActionResult> ArchiveCategory(Guid id, VersionCommand request, CancellationToken ct) => Ok(await catalog.ArchiveCategory(id, request, ct));
    [HttpDelete("categories/{id:guid}")] public async Task<IActionResult> DeleteCategory(Guid id, [FromQuery] long expectedVersion, CancellationToken ct) { await catalog.DeleteCategory(id, expectedVersion, ct); return NoContent(); }
    [HttpGet("products")] public async Task<IActionResult> Products(CancellationToken ct) => Ok(await catalog.List(ProductController.Parse(Request.Query), true, ct));
    [HttpGet("products/{id:guid}")] public async Task<IActionResult> Product(Guid id, CancellationToken ct) => await catalog.Detail(null, id, ct) is { } detail ? Ok(detail.Product) : NotFound();
    [HttpPost("products")] public async Task<IActionResult> CreateProduct(ProductRequest request, CancellationToken ct) => Ok(await catalog.SaveProduct(null, request, ct));
    [HttpPut("products/{id:guid}")] public async Task<IActionResult> UpdateProduct(Guid id, ProductRequest request, CancellationToken ct) => Ok(await catalog.SaveProduct(id, request, ct));
    [HttpPost("products/{id:guid}/archive")] public async Task<IActionResult> ArchiveProduct(Guid id, VersionCommand request, CancellationToken ct) => Ok(await catalog.ArchiveProduct(id, request, ct));
    [HttpPost("products/{id:guid}/stock")] public async Task<IActionResult> Stock(Guid id, StockCommand request, CancellationToken ct) => Ok(await commerce.AdjustStock(CurrentAccount.Id(User), id, Request.Headers["Idempotency-Key"].ToString(), request, ct));
    [HttpGet("orders")] public async Task<IActionResult> Orders([FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 12, CancellationToken ct = default) => Ok(await commerce.Orders(null, status, page, pageSize, ct));
    [HttpGet("orders/{id:guid}")] public async Task<IActionResult> Order(Guid id, CancellationToken ct) => await commerce.Find(id, ct) is { } order ? Ok(CommerceRepository.Map(order, true)) : NotFound();
    [HttpPost("orders/{id:guid}/fulfillment")]
    public async Task<IActionResult> Fulfillment(Guid id, FulfillmentCommand request, CancellationToken ct)
    {
        CommerceRules.Require(request.Status is Core.Enums.OrderStatus.Confirmed or Core.Enums.OrderStatus.Shipped or Core.Enums.OrderStatus.Delivered, "invalid_transition", "Use the dedicated cancellation command.", 409);
        return Ok(await commerce.ChangeOrder(CurrentAccount.Id(User), id, Request.Headers["Idempotency-Key"].ToString(), request.Status.ToString(), request.ExpectedVersion, request.Note, ct));
    }
    [HttpPost("orders/{id:guid}/cancel")] public async Task<IActionResult> Cancel(Guid id, VersionCommand request, CancellationToken ct) => Ok(await commerce.ChangeOrder(CurrentAccount.Id(User), id, Request.Headers["Idempotency-Key"].ToString(), "Cancelled", request.ExpectedVersion, request.Note, ct));
    [HttpPost("orders/{id:guid}/collect")] public async Task<IActionResult> Collect(Guid id, VersionCommand request, CancellationToken ct) => Ok(await commerce.ChangeOrder(CurrentAccount.Id(User), id, Request.Headers["Idempotency-Key"].ToString(), "Collected", request.ExpectedVersion, request.Note, ct));
}
