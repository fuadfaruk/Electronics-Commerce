using ElectroApi.Core.Entities;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text;

namespace ElectroApi.Core.DTOs.Products
{
    public class CreateProductRequest
    {
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
        public List<CreateProductImage> ProductImages { get; set; } = new List<CreateProductImage>();
        public List<CreateProductSpecification> ProductSpecifications { get; set; } = new List<CreateProductSpecification>();
        public bool Featured { get; set; } = false;
    }
}
