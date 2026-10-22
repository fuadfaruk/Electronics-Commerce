using ElectroApi.Core.Entities;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace ElectroApi.Infrastructure.Data;

public static class DevelopmentSeed
{
    public static void RequireLocalDatabase(ApplicationDbContext db)
    {
        var connection = new MySqlConnectionStringBuilder(db.Database.GetConnectionString());
        if (connection.Server is not ("localhost" or "127.0.0.1" or "mysql") || !(connection.Database == "electromart_mvp_dev" || connection.Database.StartsWith("electromart_test_", StringComparison.Ordinal)))
            throw new InvalidOperationException("Development commands require an explicitly named local electromart_mvp_dev or electromart_test_* database.");
    }
    public static async Task Seed(ApplicationDbContext db, CancellationToken ct = default)
    {
        RequireLocalDatabase(db);
        if (await db.Products.AnyAsync(ct) || await db.Categories.AnyAsync(ct)) throw new InvalidOperationException("Seed requires an empty development catalog; existing data was not changed.");
        string[] slugs = ["smartphones", "laptops", "audio", "wearables", "cameras", "gaming", "accessories", "tablets"];
        string[] names = ["Smartphones", "Laptops", "Audio", "Wearables", "Cameras", "Gaming", "Accessories", "Tablets"];
        var categories = slugs.Select((slug, i) => new Category { Id = Guid.Parse($"10000000-0000-4000-8000-{i + 1:000000000000}"), Slug = slug, Name = names[i], VisualKey = slug, SortOrder = i, Description = "Sample development catalog. Not production merchandise." }).ToArray();
        db.Categories.AddRange(categories);
        (string Slug, string Name, string Brand, string Category, decimal Price, int Stock)[] seeds =
        [
            ("samsung-galaxy-s24-ultra-12-256", "Galaxy S24 Ultra 12/256GB", "Samsung", "smartphones", 189999, 3),
            ("apple-iphone-15-128", "iPhone 15 128GB", "Apple", "smartphones", 152500, 4),
            ("xiaomi-redmi-note-13-pro-8-256", "Redmi Note 13 Pro 8/256GB", "Xiaomi", "smartphones", 33999, 24),
            ("realme-12-pro-plus-8-256", "realme 12 Pro+ 8/256GB", "Realme", "smartphones", 42999, 15),
            ("oneplus-nord-ce-4-8-128", "OnePlus Nord CE 4 8/128GB", "OnePlus", "smartphones", 38990, 9),
            ("apple-macbook-air-m3-13-8-256", "MacBook Air M3 13 inch 8/256GB", "Apple", "laptops", 179000, 0),
            ("asus-vivobook-15-i5-12450h-8-512", "VivoBook 15 i5-12450H 8/512GB", "Asus", "laptops", 76500, 11),
            ("lenovo-ideapad-slim-3-ryzen-5-7530u-8-512", "IdeaPad Slim 3 Ryzen 5", "Lenovo", "laptops", 68900, 7),
            ("hp-pavilion-15-i7-1355u-16-512", "Pavilion 15 i7 16/512GB", "HP", "laptops", 134900, 5),
            ("sony-wh-1000xm5", "WH-1000XM5 Wireless Headphones", "Sony", "audio", 42500, 8),
            ("samsung-galaxy-buds-fe", "Galaxy Buds FE", "Samsung", "audio", 9999, 30),
            ("apple-airpods-pro-2-usb-c", "AirPods Pro 2 USB-C", "Apple", "audio", 28900, 6),
            ("sample-usb-c-cable", "Sample USB-C Cable", "Sample", "accessories", 499, 50),
            ("sample-smartwatch", "Sample Smartwatch", "Sample", "wearables", 4999, 4),
            ("sample-camera", "Sample Camera", "Sample", "cameras", 25000, 2),
            ("sample-controller", "Sample Game Controller", "Sample", "gaming", 3000, 6),
            ("sample-tablet", "Sample Tablet", "Sample", "tablets", 22000, 3)
        ];
        db.Products.AddRange(seeds.Select((seed, i) => new Product
        {
            Id = Guid.Parse($"00000000-0000-4000-8000-{i + 1:000000000000}"), Slug = seed.Slug, Name = seed.Name, Brand = seed.Brand,
            Category = categories.Single(c => c.Slug == seed.Category), Price = seed.Price, Stock = seed.Stock,
            CompareAtPrice = i % 3 == 0 ? seed.Price + 1000 : null, Featured = i % 2 == 0,
            Description = "Sample development merchandise. Replace catalog, specifications and support policies before production.",
            Specifications = [new ProductSpecification { Label = "Catalog", Value = "Sample development data", Order = 0 }]
        }));
        await db.SaveChangesAsync(ct);
    }
}
