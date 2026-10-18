using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.DTOs.Orders
{
    public class UpdateOrderStatus
    {
        public OrderStatus OrderStatus { get; set; }
    }
}
