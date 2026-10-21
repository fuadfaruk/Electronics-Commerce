using System;

namespace ElectroApi.Core.DTOs.Products;

public class GetProductImage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Url { get; set; } = string.Empty;
    public int Order { get; set; }
}
