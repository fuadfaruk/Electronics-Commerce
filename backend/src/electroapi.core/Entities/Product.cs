using System.ComponentModel.DataAnnotations.Schema;

namespace electroapi.core.Entities
{
    public sealed record ProductSpec(string SpecName, string SpecValue);

    public sealed class Product
    {   
        public required Guid ProductId { get; set; }
        public required string ProductSlug { get; set; }
        public required string ProductName { get; set; }
        public string? ProductCategorySlug { get; set; }
        public string? ProductDescription { get; set; }
        public int? ProductPrice { get; set; }
        public int? ProductStockQuantity { get; set; }
        public List<ProductImage>? ProductImages { get; set; }
        public List<ProductSpec>? ProductSpecs { get; set; }
    }
}

