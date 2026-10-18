using System;

namespace electroapi.core.Entities;

public class ProductSpecification
{
    public Guid ProductSpecificationId { get; set; } = Guid.NewGuid();
    public required string ProductSpecificationKey { get; set; }
    public required string ProductSpecificationValue { get; set; }
}
