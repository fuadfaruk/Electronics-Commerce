using System;
using System.ComponentModel.DataAnnotations.Schema;

namespace ElectroApi.Core.DTOs.Products;

public class ProductByIdResponse
{
    public Guid ProductId { get; set; } = Guid.NewGuid();
    public required string ProductSlug { get; set; }
    public required string ProductName { get; set; }
    public string? BrandName { get; set; }
    public string? ProductCategorySlug { get; set; }
    public string? ProductDescription { get; set; }
    [Column(TypeName = "decimal(18,2)")]
    public decimal? ProductPrice { get; set; }
    [Column(TypeName = "decimal(18,2)")]
    public decimal? ProductComparePrice { get; set; }
    public int? ProductStockQuantity { get; set; }
    public List<GetProductImage> ProductImages { get; set; } = new List<GetProductImage>();
    public List<GetProductSpecification> ProductSpecifications { get; set; } = new List<GetProductSpecification>();
    public bool Featured { get; set; } = false;
}
