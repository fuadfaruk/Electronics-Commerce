using electroapi.core.Entities;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.Interfaces.Repositories
{
    public interface IOrderRepository
    {
        Task<Order> CreateOrderAsync(Order order);
        Task<bool> DeleteOrderAsync(int id);
        Task<Order?> GetOrderByIdAsync(int id);
        Task<List<Order>> GetOrdersAsync();
        Task<Order?> UpdateOrderAsync(Order order, int orderId);
    }
}
