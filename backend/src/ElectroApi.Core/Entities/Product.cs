using System.ComponentModel.DataAnnotations.Schema;

namespace ElectroApi.Core.Entities
{
    public sealed class Product
    {   
        public Guid ProductId { get; set; } = Guid.NewGuid();
        public required string ProductSlug { get; set; }
        public required string ProductName { get; set; }
        public string? BrandName { get; set; }
        public string? ProductCategorySlug { get; set; }
        public string? ProductDescription { get; set; }
        public decimal? ProductPrice { get; set; }
        public int? ProductComparePrice { get; set; }
        public int? ProductStockQuantity { get; set; }
        public List<ProductImage> ProductImages { get; set; } = new List<ProductImage>();
        public List<ProductSpecification> ProductSpecifications { get; set; } = new List<ProductSpecification>();
        public bool Featured { get; set; } = false;
    }
}

