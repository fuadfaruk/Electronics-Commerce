using electroapi.core.Entities;
using electroapi.core.Interfaces.Repositories;
using ElectroApi.Infrastructure.Data;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.infrastructure.Repositories
{
    public class OrderRepository : IOrderRepository
    {
        private readonly ApplicationDbContext _context;

        public OrderRepository(ApplicationDbContext context)
        {
            _context = context;
        }
        public Order CreateOrder(Order order)
        {
            return _context.Orders.Add(order).Entity;
        }

        public bool DeleteOrder(int id)
        {
            var order = _context.Orders.Find(id);
            if(order == null)
            {
                return false;
            }
            _context.Orders.Remove(order);
            _context.SaveChanges();

            return true;
        }

        public Order? GetOrderById(int id)
        {
            return _context.Orders.Find(id);
        }

        public List<Order> GetOrders()
        {
            return _context.Orders.ToList();
        }

        public Order? UpdateOrder(Order order, int orderId)
        {
            var existingOrder = _context.Orders.Find(orderId);
            if(existingOrder == null)
            {
                return null;
            }

            existingOrder.UserId = order.UserId;
            existingOrder.OrderDate = order.OrderDate;
            existingOrder.Address = order.Address;
            existingOrder.OrderStatus = order.OrderStatus;
            existingOrder.ProductIds = order.ProductIds;

            _context.Orders.Update(existingOrder);
            _context.SaveChanges();

            return existingOrder;
        }
    }
}
