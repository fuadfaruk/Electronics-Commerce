using electroapi.core.Entities;
using electroapi.core.Enums;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.DTOs.Orders
{
    public class UpdateOrderStatus
    {
        public OrderStatus OrderStatus { get; set; }
    }
}
