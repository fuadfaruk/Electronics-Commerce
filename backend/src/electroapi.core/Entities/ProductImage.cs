namespace electroapi.core.Entities
{
    public sealed class ProductImage
    {
        public Guid Id { get; set; }
        public Guid ProductId { get; set; }
        public string Url { get; set; } = string.Empty;
        public int Order { get; set; }

        public Product? Product { get; set; }
    }
}
