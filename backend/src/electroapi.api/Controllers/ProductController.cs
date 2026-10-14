using electroapi.core.DTOs.Products;
using electroapi.core.Entities;
using electroapi.core.Interfaces.Repositories;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Linq;

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
                ProductCategorySlug = newProduct.ProductCategorySlug,
                ProductDescription = newProduct.ProductDescription,
                ProductPrice = newProduct.ProductPrice,
                ProductStockQuantity = newProduct.ProductStockQuantity,
                ProductImages = newProduct.ProductImage?.Select((url, idx) => new ProductImage { Id = Guid.NewGuid(), Url = url ?? string.Empty, Order = idx }).ToList() ?? new List<ProductImage>(),
                ProductSpecs = newProduct.ProductSpecs
            };

            Console.WriteLine($"Creating product: {product.ProductName} with ID: {product.ProductId}");

            var createdProduct = await _productRepository.CreateProductAsync(product);

            return Ok(product);
        }
    }
}
