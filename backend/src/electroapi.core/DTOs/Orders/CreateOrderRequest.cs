using electroapi.core.Entities;
using electroapi.core.Enums;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.DTOs.Orders
{
    internal class CreateOrderRequest
    {
        public Guid OrderId { get; set; }
        public Guid UserId { get; set; }
        public User User { get; set; } = new User();
        public List<Guid> ProductIds { get; set; } = new List<Guid>();
        public DateTime OrderDate { get; set; } = DateTime.UtcNow;
        public List<string> Address { get; set; } = new List<string>();
        public OrderStatus OrderStatus { get; set; }
    }
}
