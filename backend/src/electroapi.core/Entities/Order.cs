using electroapi.core.Enums;

namespace electroapi.core.Entities
{
    public sealed class Order
    {
        public Guid OrderId { get; set; }
        public Guid UserId { get; set; }
        public User User { get; set; } = new User();
        public List<Guid> ProductIds { get; set; } = new List<Guid>();
        public List<Product> Products { get; set; } = new List<Product>();
        public DateTime OrderDate { get; set; } = DateTime.UtcNow;
        public List<string> Address { get; set; } = new List<string>();
        public OrderStatus OrderStatus { get; set; } = OrderStatus.Pending;
    }
}

