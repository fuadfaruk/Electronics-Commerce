using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;

namespace ElectroApi.Core.DTOs.Orders
{
    public class OrderResponse
    {
        public Guid OrderId { get; set; }
        public Guid UserId { get; set; }
        public List<Guid> ProductIds { get; set; } = new List<Guid>();
        public DateTime OrderDate { get; set; } = DateTime.UtcNow;
        public List<string> Address { get; set; } = new List<string>();
        public OrderStatus OrderStatus { get; set; }
    }
}
