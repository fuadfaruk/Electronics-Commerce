using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.DTOs.Orders
{
    public class CreateOrderRequest
    {
        public Guid OrderId { get; set; }
        public Guid UserId { get; set; }
        public User User { get; set; } = new User();
        public List<Guid> ProductIds { get; set; } = new List<Guid>();
        public DateTime OrderDate { get; set; } = DateTime.UtcNow;
        public List<string> Address { get; set; } = new List<string>();
    }
}
