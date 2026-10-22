using ElectroApi.Core.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/v1/Product")]
public sealed class ProductController(ICatalogRepository catalog) : ControllerBase
{
    internal static CatalogQuery Parse(IQueryCollection query)
    {
        string[] List(string name) => query[name].SelectMany(v => (v ?? "").Split(',')).Select(v => v.Trim()).Where(v => v.Length > 0).Distinct().ToArray();
        decimal? Price(string name) => decimal.TryParse(query[name].FirstOrDefault(), System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var value) && value >= 0 ? value : null;
        int Number(string name, int fallback) => query.ContainsKey(name) ? int.TryParse(query[name].FirstOrDefault(), out var value) ? value : 0 : fallback;
        return new(query["q"].FirstOrDefault()?.Trim() ?? "", List("category"), List("brand"), Price("min"), Price("max"), query["stock"] == "in", query["sort"].FirstOrDefault() ?? "relevance", Number("page", 1), Number("pageSize", 12));
    }
    [HttpGet] public async Task<IActionResult> List(CancellationToken ct) => Ok(await catalog.List(Parse(Request.Query), false, ct));
    [HttpGet("by-slug/{slug}")] public async Task<IActionResult> BySlug(string slug, CancellationToken ct) => await catalog.Detail(slug, null, ct) is { } detail ? Ok(detail) : NotFound();
    [HttpGet("{id:guid}")] public async Task<IActionResult> ById(Guid id, CancellationToken ct) => await catalog.Detail(null, id, ct) is { } detail ? Ok(detail) : NotFound();
    [HttpGet("home")] public async Task<IActionResult> Home(CancellationToken ct) => Ok(await catalog.Home(ct));
}
