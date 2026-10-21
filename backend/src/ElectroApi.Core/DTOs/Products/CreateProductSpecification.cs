using System;

namespace ElectroApi.Core.DTOs.Products;

public class CreateProductSpecification
{
    public required string ProductSpecificationKey { get; set; }
    public required string ProductSpecificationValue { get; set; }
}
