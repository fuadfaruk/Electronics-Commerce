using ElectroApi.Core.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/v1/Category")]
public sealed class CategoryController(ICatalogRepository catalog) : ControllerBase
{
    [HttpGet] public async Task<IActionResult> List(CancellationToken ct) => Ok(await catalog.Categories(false, ct));
    [HttpGet("by-slug/{slug}")] public async Task<IActionResult> Detail(string slug, CancellationToken ct) => await catalog.Category(slug, ct) is { } category ? Ok(category) : NotFound();
}
