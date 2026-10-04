using electroapi.core.Entities;
using electroapi.core.Enums;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.DTOs.Orders
{
    public class UpdateOrderRequest
    {
        public User User { get; set; } = new User();
        public List<Guid> ProductIds { get; set; } = new List<Guid>();
        public DateTime OrderTime { get; set; } = DateTime.UtcNow;
        public List<string> Address { get; set; } = new List<string>();
    }
}
