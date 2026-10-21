using System;
using System.ComponentModel.DataAnnotations.Schema;

namespace ElectroApi.Core.DTOs.Products;

public class AllProductsResponse
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
    public GetProductImage ProductImage { get; set; } = new GetProductImage();
    public bool Featured { get; set; } = false;
}
