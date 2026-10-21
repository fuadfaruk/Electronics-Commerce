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
        private readonly ILogger<ProductController> _logger;

        public ProductController(IProductRepository productRepository, ILogger<ProductController> logger)
        {
            _productRepository = productRepository;
            _logger = logger;
        }
        [HttpGet]
        public async Task<IActionResult> GetAllProducts()
        {
            var products = await _productRepository.GetAllProductsAsync();
            return Ok(products);
        }

        [HttpGet("{productId}")]
        public async Task<IActionResult> GetProductById(Guid productId)
        {
            var product = await _productRepository.GetProductByIdAsync(productId);
            if (product == null)
            {
                return NotFound();
            }
            return Ok(product);    
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

            var createdProduct = await _productRepository.CreateProductAsync(newProduct);
            _logger.LogInformation("Created product {ProductId}.", createdProduct.ProductId);

            return Ok(createdProduct);
        }
    }
}
