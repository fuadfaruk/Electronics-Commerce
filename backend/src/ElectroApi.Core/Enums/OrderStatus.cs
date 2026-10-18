using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.Enums
{
    public enum OrderStatus
    {
        Pending = 0,
        Paid = 1,
        Shipped = 2,
        Delivered = 3,
        Cancelled = 4
    }
}
