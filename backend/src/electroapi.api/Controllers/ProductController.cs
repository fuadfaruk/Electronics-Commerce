using electroapi.core.DTOs;
using electroapi.core.Entities;
using electroapi.core.Interfaces.Repositories;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace electroapi.api.Controllers
{
    [Route("api/v1/[controller]")]
    [ApiController]
    public class ProductController : ControllerBase
    {
        private readonly IProductRepository _productRepository;
        public ProductController(IProductRepository productRepository)
        {
            _productRepository = productRepository;
        }
        [HttpGet]
        public async Task<IActionResult> GetAllProducts()
        {
            var products = await _productRepository.GetAllProductsAsync();
            return Ok(products);
        }

        [HttpPost]
        public async Task<IActionResult> CreateProduct([FromBody] CreateProductRequest newProduct)
        {
            Product product = new Product
            {
                ProductName = newProduct.ProductName,
                ProductDescription = newProduct.ProductDescription,
                ProductPrice = newProduct.ProductPrice,
                ProductQuantity = newProduct.ProductQuantity
            };
            var createdProduct = await _productRepository.CreateProductAsync(product);

            return Ok(product);
        }
    }
}
