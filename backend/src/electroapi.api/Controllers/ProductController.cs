using electroapi.core.DTOs.Products;
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
                ProductId = Guid.NewGuid(),
                ProductSlug = newProduct.ProductSlug,
                ProductName = newProduct.ProductName,
                ProductCategorySlug = newProduct.ProductCategorySlug ?? string.Empty,
                ProductDescription = newProduct.ProductDescription ?? string.Empty,
                ProductPrice = newProduct.ProductPrice ?? 0,
                ProductStockQuantity = newProduct.ProductStockQuantity ?? 0,
                ProductImage = newProduct.ProductImage ?? new List<string>(),
                ProductSpecs = newProduct.ProductSpecs ?? new List<ProductSpec>()
            };
            var createdProduct = await _productRepository.CreateProductAsync(product);

            return Ok(product);
        }
    }
}
