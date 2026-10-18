using ElectroApi.Core.DTOs.Products;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces.Repositories;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Linq;

namespace ElectroApi.api.Controllers
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
        public async Task<IActionResult> CreateProduct([FromBody] Product newProduct)
        {
            newProduct.ProductId = Guid.NewGuid(); // Assign a new GUID to the ProductId
            //Product product = new Product
            //{
            //    ProductId = Guid.NewGuid(),
            //    ProductSlug = newProduct.ProductSlug,
            //    ProductName = newProduct.ProductName,
            //    ProductCategorySlug = newProduct.ProductCategorySlug,
            //    ProductDescription = newProduct.ProductDescription,
            //    ProductPrice = newProduct.ProductPrice,
            //    ProductStockQuantity = newProduct.ProductStockQuantity
            //};

            Console.WriteLine($"Creating product: {newProduct.ProductName} with ID: {newProduct.ProductId}");

            var createdProduct = await _productRepository.CreateProductAsync(newProduct);

            return Ok(createdProduct);
        }
    }
}
