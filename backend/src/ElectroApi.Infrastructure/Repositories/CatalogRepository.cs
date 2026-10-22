using System.Linq.Expressions;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace ElectroApi.Infrastructure.Repositories;

public sealed class CatalogRepository(ApplicationDbContext db) : ICatalogRepository
{
    public static ProductDto Map(Product p) => new(p.Id, p.Slug, p.Name, p.Brand, p.CategoryId, p.Category.Slug, p.Category.Name, p.Description, p.Price, p.CompareAtPrice, p.Stock, p.Version, p.Featured, p.IsArchived, !p.IsArchived && p.Stock > 0, p.Images.OrderBy(i => i.Order).ThenBy(i => i.Id).Select(i => i.Url).ToArray(), p.Specifications.OrderBy(s => s.Order).ThenBy(s => s.Id).Select(s => new ProductSpecDto(s.Label, s.Value)).ToArray());
    private IQueryable<Product> Details => db.Products.AsNoTracking().Include(p => p.Category).Include(p => p.Images).Include(p => p.Specifications);
    public async Task<CatalogPage> List(CatalogQuery query, bool includeArchived, CancellationToken ct)
    {
        CommerceRules.Require(query.Page is >= 1 and <= 100000 && query.PageSize is >= 1 and <= 100, "invalid_page", "Page must be positive and pageSize must be between 1 and 100.");
        CommerceRules.Require(query.Q.Length <= 200 && (query.Categories?.Length ?? 0) <= 30 && (query.Brands?.Length ?? 0) <= 30, "invalid_filters", "Catalog filters exceed the allowed limits.");
        var tokens = query.Q.ToLowerInvariant().Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var search = db.Products.AsNoTracking().Where(p => includeArchived || !p.IsArchived);
        foreach (var token in tokens)
            search = search.Where(p => (p.Name + " " + p.Brand + " " + p.Category.Slug + " " + p.Category.Name + " " + p.Description).ToLower().Contains(token));
        var brandCounts = await search.Where(p => p.Brand != "").GroupBy(p => p.Brand).Select(g => new { Value = g.Key, Count = g.Count() }).OrderBy(g => g.Value).Take(1000).ToArrayAsync(ct);
        var categories = await search.GroupBy(p => new { p.Category.Slug, p.Category.Name, p.Category.SortOrder }).Select(g => new { g.Key.Slug, g.Key.Name, g.Key.SortOrder, Count = g.Count() }).OrderBy(g => g.SortOrder).ThenBy(g => g.Slug).Take(1000).ToArrayAsync(ct);
        var min = await search.Select(p => (decimal?)p.Price).MinAsync(ct) ?? 0m;
        var max = await search.Select(p => (decimal?)p.Price).MaxAsync(ct) ?? 0m;
        var filtered = search;
        if (query.Categories is { Length: > 0 }) filtered = filtered.Where(p => query.Categories.Contains(p.Category.Slug));
        if (query.Brands is { Length: > 0 }) filtered = filtered.Where(p => query.Brands.Contains(p.Brand));
        var lower = query.Min; var upper = query.Max;
        if (lower.HasValue && upper.HasValue && lower > upper) (lower, upper) = (upper, lower);
        if (lower is >= 0) filtered = filtered.Where(p => p.Price >= lower);
        if (upper is >= 0) filtered = filtered.Where(p => p.Price <= upper);
        if (query.InStock) filtered = filtered.Where(p => p.Stock > 0);
        var count = await filtered.CountAsync(ct);
        IOrderedQueryable<Product> ordered = query.Sort switch
        {
            "price-asc" => filtered.OrderBy(p => p.Price),
            "price-desc" => filtered.OrderByDescending(p => p.Price),
            "name-asc" => filtered.OrderBy(p => p.Name),
            _ when tokens.Length > 0 => filtered.OrderByDescending(Score(query.Q.ToLowerInvariant().Trim(), tokens)),
            _ => filtered.OrderByDescending(p => p.Featured)
        };
        var rows = await ordered.ThenBy(p => p.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).Include(p => p.Category).Include(p => p.Images).Include(p => p.Specifications).AsSplitQuery().ToArrayAsync(ct);
        return new(rows.Select(Map).ToArray(), count, query.Page, query.PageSize, new(brandCounts.Select(b => new BrandFacet(b.Value, b.Count)).ToArray(), categories.Select(c => new CategoryFacet(c.Slug, c.Name, c.Count)).ToArray(), min, max));
    }
    private static Expression<Func<Product, double>> Score(string q, string[] tokens)
    {
        var p = Expression.Parameter(typeof(Product), "p");
        Expression Contains(Expression field, string value, double weight) => Expression.Condition(Expression.Call(Expression.Call(field, nameof(string.ToLower), Type.EmptyTypes), nameof(string.Contains), Type.EmptyTypes, Expression.Constant(value)), Expression.Constant(weight), Expression.Constant(0d));
        var name = Expression.Property(p, nameof(Product.Name)); var brand = Expression.Property(p, nameof(Product.Brand));
        Expression score = Expression.Add(Contains(name, q, 6), Contains(brand, q, 3));
        score = Expression.Add(score, Expression.Condition(Expression.Property(p, nameof(Product.Featured)), Expression.Constant(.25), Expression.Constant(0d)));
        foreach (var token in tokens)
        {
            score = Expression.Add(score, Contains(name, token, 2)); score = Expression.Add(score, Contains(brand, token, 2));
            score = Expression.Add(score, Contains(Expression.Property(Expression.Property(p, nameof(Product.Category)), nameof(Core.Entities.Category.Name)), token, 1));
            score = Expression.Add(score, Contains(Expression.Property(p, nameof(Product.Description)), token, .5));
        }
        return Expression.Lambda<Func<Product, double>>(score, p);
    }
    public async Task<ProductDetail?> Detail(string? slug, Guid? id, CancellationToken ct)
    {
        var product = await Details.AsSplitQuery().SingleOrDefaultAsync(p => slug != null ? p.Slug == slug : p.Id == id, ct);
        if (product is null) return null;
        var related = await Details.Where(p => !p.IsArchived && p.CategoryId == product.CategoryId && p.Id != product.Id).OrderByDescending(p => p.Featured).ThenBy(p => p.Id).Take(6).AsSplitQuery().ToArrayAsync(ct);
        return new(Map(product), related.Select(Map).ToArray());
    }
    public async Task<HomeCollections> Home(CancellationToken ct)
    {
        var sale = Details.Where(p => !p.IsArchived);
        var featured = await sale.Where(p => p.Featured).OrderBy(p => p.Id).Take(8).AsSplitQuery().ToArrayAsync(ct);
        var deals = await sale.Where(p => p.CompareAtPrice != null && p.CompareAtPrice > p.Price).OrderByDescending(p => (p.CompareAtPrice - p.Price) / p.CompareAtPrice).ThenBy(p => p.Id).Take(8).AsSplitQuery().ToArrayAsync(ct);
        var latest = await sale.OrderByDescending(p => p.Id).Take(8).AsSplitQuery().ToArrayAsync(ct);
        return new(featured.Select(Map).ToArray(), deals.Select(Map).ToArray(), latest.Select(Map).ToArray());
    }
    public Task<CategoryDto[]> Categories(bool includeArchived, CancellationToken ct) => db.Categories.AsNoTracking().Where(c => includeArchived || !c.IsArchived).OrderBy(c => c.SortOrder).ThenBy(c => c.Id).Select(c => new CategoryDto(c.Id, c.Slug, c.Name, c.Description, c.VisualKey, c.SortOrder, c.IsArchived, c.Version, c.Products.Count(p => !p.IsArchived))).ToArrayAsync(ct);
    public Task<CategoryDto?> Category(string slug, CancellationToken ct) => db.Categories.AsNoTracking().Where(c => c.Slug == slug).Select(c => new CategoryDto(c.Id, c.Slug, c.Name, c.Description, c.VisualKey, c.SortOrder, c.IsArchived, c.Version, c.Products.Count(p => !p.IsArchived))).SingleOrDefaultAsync(ct);
    public async Task<CategoryDto> SaveCategory(Guid? id, CategoryRequest request, CancellationToken ct)
    {
        CommerceRules.Slug(request.Slug);
        CommerceRules.Require(CommerceRules.VisualKeys.Contains(request.VisualKey) && !string.IsNullOrWhiteSpace(request.Name), "invalid_category", "Category name and a supported local visual key are required.");
        var category = id is { } guid ? await db.Categories.SingleOrDefaultAsync(c => c.Id == guid, ct) ?? throw new CommerceException(404, "not_found", "Category not found.") : new Category { Slug = request.Slug, Name = request.Name.Trim() };
        if (id.HasValue) { CommerceRules.Require(category.Version == request.ExpectedVersion && category.Slug == request.Slug, "stale_version", "Category changed or the slug is immutable.", 409); category.Version++; }
        else { CommerceRules.Require(!await db.Categories.AnyAsync(c => c.Slug == request.Slug, ct), "duplicate_slug", "This category slug is already in use.", 409); db.Categories.Add(category); }
        category.Name = request.Name.Trim(); category.Description = request.Description.Trim(); category.VisualKey = request.VisualKey; category.SortOrder = request.SortOrder;
        await db.SaveChangesAsync(ct);
        return (await Category(category.Slug, ct))!;
    }
    public async Task<CategoryDto> ArchiveCategory(Guid id, VersionCommand request, CancellationToken ct)
    {
        var category = await db.Categories.SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw new CommerceException(404, "not_found", "Category not found.");
        CommerceRules.Require(category.Version == request.ExpectedVersion, "stale_version", "Category changed; reload before updating.", 409);
        category.IsArchived = true; category.Version++; await db.SaveChangesAsync(ct); return (await Category(category.Slug, ct))!;
    }
    public async Task DeleteCategory(Guid id, long expectedVersion, CancellationToken ct)
    {
        var category = await db.Categories.SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw new CommerceException(404, "not_found", "Category not found.");
        CommerceRules.Require(category.Version == expectedVersion, "stale_version", "Category changed; reload before updating.", 409);
        CommerceRules.Require(!await db.Products.AnyAsync(p => p.CategoryId == id, ct), "category_referenced", "Archive categories that are referenced by products.", 409);
        db.Categories.Remove(category); await db.SaveChangesAsync(ct);
    }
    public async Task<ProductDto> SaveProduct(Guid? id, ProductRequest request, CancellationToken ct)
    {
        CommerceRules.Product(request);
        var category = await db.Categories.SingleOrDefaultAsync(c => c.Id == request.CategoryId, ct) ?? throw new CommerceException(400, "invalid_category", "Select an existing category.");
        var product = id is { } guid ? await db.Products.Include(p => p.Images).Include(p => p.Specifications).SingleOrDefaultAsync(p => p.Id == guid, ct) ?? throw new CommerceException(404, "not_found", "Product not found.") : new Product { Slug = request.Slug, Name = request.Name, CategoryId = request.CategoryId };
        CommerceRules.Require(!category.IsArchived || id.HasValue && product.CategoryId == category.Id, "category_archived", "Archived categories cannot be newly assigned.", 409);
        if (id.HasValue) { CommerceRules.Require(product.Version == request.ExpectedVersion && product.Slug == request.Slug, "stale_version", "Product changed or the slug is immutable.", 409); product.Version++; }
        else { CommerceRules.Require(!await db.Products.AnyAsync(p => p.Slug == request.Slug, ct), "duplicate_slug", "This product slug is already in use.", 409); db.Products.Add(product); }
        product.Name = request.Name.Trim(); product.Brand = request.Brand.Trim(); product.CategoryId = category.Id; product.Category = category; product.Description = request.Description.Trim(); product.Price = request.Price; product.CompareAtPrice = request.CompareAtPrice; product.Featured = request.Featured;
        db.RemoveRange(product.Images); product.Images.Clear(); product.Images.AddRange(request.Images.Select((url, i) => new ProductImage { ProductId = product.Id, Url = url, Order = i }));
        db.RemoveRange(product.Specifications); product.Specifications.Clear(); product.Specifications.AddRange(request.Specs.Select((spec, i) => new ProductSpecification { ProductId = product.Id, Label = spec.Label.Trim(), Value = spec.Value.Trim(), Order = i }));
        db.AddRange(product.Images); db.AddRange(product.Specifications);
        await db.SaveChangesAsync(ct); return Map(product);
    }
    public async Task<ProductDto> ArchiveProduct(Guid id, VersionCommand request, CancellationToken ct)
    {
        var product = await db.Products.Include(p => p.Category).Include(p => p.Images).Include(p => p.Specifications).SingleOrDefaultAsync(p => p.Id == id, ct) ?? throw new CommerceException(404, "not_found", "Product not found.");
        CommerceRules.Require(product.Version == request.ExpectedVersion, "stale_version", "Product changed; reload before updating.", 409);
        product.IsArchived = true; product.Version++; await db.SaveChangesAsync(ct); return Map(product);
    }
}
