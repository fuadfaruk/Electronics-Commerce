using electroapi.core.Entities;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;

namespace electroapi.api.Controllers
{
    [Route("api/v1/[controller]")] // Add proper versioning to the route with package Microsoft.AspNetCore.Mvc.Versioning
    [ApiController]
    public class OrderController : ControllerBase
    {
        private readonly ApplicationDbContext _context;
        public OrderController(ApplicationDbContext context) {
            _context = context;
        }
        [HttpGet]
        public IActionResult Get()
        {
            var orders = _context.Orders.ToList();
            return Ok(orders);
        }

        [HttpPost]
        public IActionResult Post([FromBody] Order order) // Use DTO
        {
            _context.Orders.Add(order);
            _context.SaveChanges();
            return Ok(order);
        }
    }
}
