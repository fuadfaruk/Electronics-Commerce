using electroapi.core.Entities;
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
            return Ok(orders);
        }

        [HttpPost]
        public async Task<IActionResult> Post([FromBody] Order order) // Use DTO
        {
            var createdOrder = await _orderRepository.CreateOrderAsync(order);
            return Ok(createdOrder);
        }

        [HttpPost("{id}")]
        public async Task<IActionResult> UpdateOrder([FromBody] Order order, int id) // Use DTO
        {
            var updatedOrder = await _orderRepository.UpdateOrderAsync(order, id);
            if (updatedOrder == null)
            {
                return NotFound();
            }
            return Ok(updatedOrder);
        }
    }
}
