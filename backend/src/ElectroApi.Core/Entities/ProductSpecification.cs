namespace ElectroApi.Core.Entities;

public class ProductSpecification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public required string Label { get; set; }
    public required string Value { get; set; }
    public int Order { get; set; }
}
