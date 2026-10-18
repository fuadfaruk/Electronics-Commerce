namespace electroapi.core.Entities
{
    public sealed class ProductImage
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Url { get; set; } = string.Empty;
        public int Order { get; set; }
    }
}
