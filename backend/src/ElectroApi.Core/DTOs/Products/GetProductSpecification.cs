using System;

namespace ElectroApi.Core.DTOs.Products;

public class GetProductSpecification
{
    public Guid ProductSpecificationId { get; set; } = Guid.NewGuid();
    public required string ProductSpecificationKey { get; set; }
    public required string ProductSpecificationValue { get; set; }
}
