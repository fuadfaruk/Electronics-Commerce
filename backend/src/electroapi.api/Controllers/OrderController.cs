using electroapi.core.DTOs.Orders;
using electroapi.core.Entities;
using electroapi.core.Enums;
using electroapi.core.Interfaces.Repositories;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;

namespace electroapi.api.Controllers
{
    [Route("api/v1/[controller]")] // Add proper versioning to the route with package Microsoft.AspNetCore.Mvc.Versioning
    [ApiController]
    public class OrderController : ControllerBase
    {

        private readonly IOrderRepository _orderRepository;
        public OrderController(IOrderRepository orderRepository) {
            _orderRepository = orderRepository;
        }
        [HttpGet]
        public async Task<IActionResult> GetAllOrders()
        {
            var orders = await _orderRepository.GetOrdersAsync();
            var orderDtos = orders.Select(o => new OrderResponse
            {
                OrderId = o.OrderId,
                UserId = o.UserId,
                ProductIds = o.ProductIds,
                OrderDate = o.OrderDate,
                OrderStatus = o.OrderStatus,
            }).ToList();
            return Ok(orders);
        }

        [HttpPost]
        public async Task<IActionResult> Post([FromBody] CreateOrderRequest order)
        {
            var newOrder = new Order
            {
                OrderId = order.OrderId,
                UserId = order.UserId,
                ProductIds = order.ProductIds,
                OrderDate = order.OrderDate,
                Address = order.Address,
                OrderStatus = OrderStatus.Pending
            };
            var createdOrder = await _orderRepository.CreateOrderAsync(newOrder);
            return Ok(createdOrder);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateOrder([FromBody] UpdateOrderRequest updateOrder, int id)
        {
            var order = await _orderRepository.GetOrderByIdAsync(id);
            if (order == null)
            {
                return NotFound();
            }

            if(order.OrderStatus != OrderStatus.Pending)
            {
                return BadRequest("Cannot update the order at this stage!");
            }

            order.User = updateOrder.User;
            order.ProductIds = updateOrder.ProductIds;
            order.OrderDate = updateOrder.OrderTime;

            await _orderRepository.UpdateOrderAsync(order);

            return NoContent();
        }

        [HttpPatch("{id}")]
        public async Task<IActionResult> UpdateOrderStatus([FromBody] UpdateOrderStatus updateOrder, int id)
        {
            var order = await _orderRepository.GetOrderByIdAsync(id);
            if (order == null)
            {
                return NotFound();
            }

            order.OrderStatus = updateOrder.OrderStatus;

            await _orderRepository.UpdateOrderAsync(order);

            return NoContent();
        }
    }
}
