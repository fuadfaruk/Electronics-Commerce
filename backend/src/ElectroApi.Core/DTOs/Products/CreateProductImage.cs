using System;

namespace ElectroApi.Core.DTOs.Products;

public class CreateProductImage
{
    public string Url { get; set; } = string.Empty;
    public int Order { get; set; }
}
