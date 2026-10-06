using Microsoft.AspNetCore.Mvc;

namespace electroapi.api.Controllers
{
    [Route("api/v1/[controller]")]
    [ApiController]
    public class TestController : ControllerBase
    {
        private static readonly string[] Summaries =
        [
            "active", "passive", "survival", "fight-or-flight", "social", "creative", "analytical", "relaxation", "sleep", "panic", "focus", "default", "learning", "defensive", "playful"
        ];
        [HttpGet]
        public IActionResult Get()
        {
            return Ok($"At the time of {DateTime.Now} your random mode is {Summaries[Random.Shared.Next(Summaries.Length)]}.\nAPI is reachable. You can proceed to check the database connection!");
        }
    }
}
