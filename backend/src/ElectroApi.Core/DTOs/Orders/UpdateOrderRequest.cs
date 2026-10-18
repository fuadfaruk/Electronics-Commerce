using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.DTOs.Orders
{
    public class UpdateOrderRequest
    {
        public List<Guid> ProductIds { get; set; } = new List<Guid>();
        public List<string> Address { get; set; } = new List<string>();
    }
}
