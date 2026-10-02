using electroapi.core.Entities;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.Interfaces.Repositories
{
    // Async everything
    public interface IOrderRepository
    {
        List<Order> GetOrders();
        Order? GetOrderById(int id);
        Order CreateOrder(Order order);
        Order? UpdateOrder(Order order, int orderId);
        bool DeleteOrder(int id);
    }
}
