using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;

namespace ElectroApi.Integration.Tests;

public sealed class CatalogSchemaTests
{
    [MySqlFact]
    public async Task Oracle_migration_seed_and_catalog_queries_have_bounded_stable_facets()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options);
        await db.Database.MigrateAsync();
        await DevelopmentSeed.Seed(db);
        var repository = new CatalogRepository(db);
        var page = await repository.List(new(PageSize: 12), false, default);
        Assert.Equal(17, page.TotalCount); Assert.Equal(12, page.Items.Length); Assert.Equal(8, page.Facets.Categories.Length);
        var filtered = await repository.List(new("samsung galaxy", ["smartphones", "audio"], ["Samsung"], InStock: true), false, default);
        Assert.Equal(2, filtered.TotalCount); Assert.Equal(2, filtered.Facets.Brands.Single(b => b.Value == "Samsung").Count);
        var detail = await repository.Detail("sample-usb-c-cable", null, default);
        Assert.NotNull(detail); Assert.Equal(499m, detail.Product.Price);
        Assert.True((await repository.Home(default)).Featured.Length <= 8);
        await Assert.ThrowsAsync<CommerceException>(() => repository.List(new(PageSize: 101), false, default));
    }

    [MySqlFact]
    public async Task Category_archive_preserves_products_and_references_and_slugs_remain_reserved()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options);
        await db.Database.MigrateAsync();
        await DevelopmentSeed.Seed(db);
        var repository = new CatalogRepository(db);
        var category = (await repository.Categories(false, default)).Single(c => c.Slug == "accessories");
        await repository.ArchiveCategory(category.Id, new(category.Version, null), default);
        Assert.DoesNotContain(await repository.Categories(false, default), c => c.Id == category.Id);
        Assert.True((await repository.Category(category.Slug, default))!.IsArchived);
        Assert.True((await repository.Detail("sample-usb-c-cable", null, default))!.Product.SaleEligible);
        await Assert.ThrowsAsync<CommerceException>(() => repository.DeleteCategory(category.Id, 2, default));
        await Assert.ThrowsAsync<CommerceException>(() => repository.SaveCategory(null, new() { Slug = "accessories", Name = "Other", VisualKey = "accessories" }, default));
        var product = await repository.Detail("sample-usb-c-cable", null, default);
        await repository.ArchiveProduct(product!.Product.Id, new(product.Product.Version, null), default);
        Assert.False((await repository.Detail("sample-usb-c-cable", null, default))!.Product.SaleEligible);
    }

    [MySqlFact]
    public async Task Metadata_never_overwrites_stock_and_immutable_slug_and_fractional_price_fail()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options);
        await db.Database.MigrateAsync();
        await DevelopmentSeed.Seed(db);
        var product = await db.Products.Include(p => p.Category).SingleAsync(p => p.Slug == "sample-usb-c-cable");
        var repository = new CatalogRepository(db);
        var result = await repository.SaveProduct(product.Id, new() { Slug = product.Slug, Name = "Updated sample cable", CategoryId = product.CategoryId, Brand = "Sample", Price = 500m, ExpectedVersion = product.Version, Images = ["https://example.com/1.jpg", "https://example.com/2.jpg"], Specs = [new("Length", "1m")] }, default);
        Assert.Equal(50, result.Stock); Assert.Equal(2, result.Version); Assert.Equal(2, result.Images.Length);
        await repository.SaveProduct(product.Id, new() { Slug = product.Slug, Name = "Updated twice", CategoryId = product.CategoryId, Price = 550m, ExpectedVersion = product.Version, Images = ["https://example.com/new.jpg"], Specs = [new("Length", "2m")] }, default);
        db.ChangeTracker.Clear();
        product = await db.Products.SingleAsync(p => p.Id == result.Id);
        product.Slug = "renamed";
        await Assert.ThrowsAsync<CommerceException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        product = await db.Products.SingleAsync(p => p.Id == result.Id); product.Price = 100.01m;
        await Assert.ThrowsAsync<CommerceException>(() => db.SaveChangesAsync());
    }
}
