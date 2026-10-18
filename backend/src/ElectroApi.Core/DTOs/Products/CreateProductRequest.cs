using ElectroApi.Core.Entities;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.DTOs.Products
{
    public class CreateProductRequest
    {
        public required string ProductSlug { get; set; }
        public required string ProductName { get; set; }
        public string? ProductCategorySlug { get; set; }
        public string? ProductDescription { get; set; }
        public int? ProductPrice { get; set; }
        public int? ProductStockQuantity { get; set; }
        public List<Guid> ProductImageIds { get; set; } = new List<Guid>();
        public List<ProductImage> ProductImages { get; set; } = new List<ProductImage>();
        public List<Guid> ProductSpecificationIds { get; set; } = new List<Guid>();
        public List<ProductSpecification> ProductSpecifications { get; set; } = new List<ProductSpecification>();
    }
}
