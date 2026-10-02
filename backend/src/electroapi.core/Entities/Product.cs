namespace electroapi.core.Entities
{
    public sealed class Product
    {
        public Guid ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public string ProductDescription { get; set; } = string.Empty;
        public int ProductPrice { get; set; }
        public int ProductQuantity { get; set; }
    }
}

