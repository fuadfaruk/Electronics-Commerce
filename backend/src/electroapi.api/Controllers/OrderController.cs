using electroapi.core.Entities;
using Microsoft.AspNetCore.Mvc;

// For more information on enabling Web API for empty projects, visit https://go.microsoft.com/fwlink/?LinkID=397860

namespace electroapi.api.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class OrderController : ControllerBase
    {
        [HttpGet]
        public IActionResult Get()
        {
            return Ok("This line was executed");
        }

        [HttpPost]
        public IActionResult Post([FromBody] Order order)
        {
            return Ok(order);
        }
    }
}
