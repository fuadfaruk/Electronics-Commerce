namespace ElectroApi.Core.Entities;

public sealed class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = "";
    public string VisualKey { get; set; } = "accessories";
    public int SortOrder { get; set; }
    public bool IsArchived { get; set; }
    public long Version { get; set; } = 1;
    public List<Product> Products { get; set; } = [];
}
