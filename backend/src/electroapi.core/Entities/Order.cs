using electroapi.core.Enums;

namespace electroapi.core.Entities
{
    public sealed class Order
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public User User { get; set; } = new User();
        public Guid ProductIds { get; set; }
        public List<Product> Products { get; set; } = new List<Product>();
        public DateTime OrderDate { get; set; } = DateTime.UtcNow;
        public List<string> Address { get; set; } = new List<string>();
        public OrderStatus OrderStatus { get; set; }
    }
}

