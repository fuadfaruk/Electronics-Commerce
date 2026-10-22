namespace ElectroApi.Core.Entities;

public sealed class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public string Brand { get; set; } = "";
    public Guid CategoryId { get; set; }
    public Category Category { get; set; } = null!;
    public string Description { get; set; } = "";
    public decimal Price { get; set; }
    public decimal? CompareAtPrice { get; set; }
    public int Stock { get; set; }
    public long Version { get; set; } = 1;
    public bool Featured { get; set; }
    public bool IsArchived { get; set; }
    public List<ProductImage> Images { get; set; } = [];
    public List<ProductSpecification> Specifications { get; set; } = [];
}
