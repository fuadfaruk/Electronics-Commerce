using System;

namespace ElectroApi.Core.DTOs.Products;

public class CreateProductImage
{
    public string ImageUrl { get; set; } = string.Empty;
    public int Order { get; set; }
}
