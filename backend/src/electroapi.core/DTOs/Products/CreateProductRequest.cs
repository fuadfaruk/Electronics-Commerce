using electroapi.core.Entities;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.DTOs.Products
{
    public class CreateProductRequest
    {
        public required string ProductSlug { get; set; }
        public required string ProductName { get; set; }
        public string? ProductCategorySlug { get; set; }
        public string? ProductDescription { get; set; }
        public int? ProductPrice { get; set; }
        public int? ProductStockQuantity { get; set; }
        public List<string>? ProductImage { get; set; }
        public List<ProductSpec>? ProductSpecs { get; set; }
    }
}
