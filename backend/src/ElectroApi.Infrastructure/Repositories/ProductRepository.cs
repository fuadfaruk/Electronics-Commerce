using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces.Repositories;
using ElectroApi.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Infrastructure.Repositories
{
    public class ProductRepository : IProductRepository
    {
        private readonly ApplicationDbContext _context;
        public ProductRepository(ApplicationDbContext context)
        {
            _context = context;
        }

        public async Task<Product> CreateProductAsync(Product product)
        {
            await _context.Products.AddAsync(product);
            _context.SaveChanges();

            return product;
        }

        public async Task<List<Product>> GetAllProductsAsync()
        {
            return await _context.Products
                .AsNoTracking()
                .Include(p => p.ProductImages
                    .Where(image => image.Order == 1)
                    .Take(1))
                .ToListAsync();
        }

        public async Task<Product?> GetProductByIdAsync(Guid productId)
        {
            return await _context.Products
                .AsNoTracking()
                .Include(p => p.ProductImages)
                .FirstOrDefaultAsync(p => p.ProductId == productId);
        }

        public async Task<bool> DeleteProductAsync(Guid productId)
        {
            var product = await _context.Products.FirstOrDefaultAsync(p => p.ProductId == productId);
            if (product == null)
            {
                return false;
            }
            _context.Products.Remove(product);
            await _context.SaveChangesAsync();

            return true;
        }

        public async Task<Product?> UpdateProductAsync(Product product)
        {
            var existingProduct = await _context.Products.FirstOrDefaultAsync(p => p.ProductId == product.ProductId);
            if (existingProduct == null)
            {
                return null;
            }

            existingProduct.ProductSlug = product.ProductSlug;
            existingProduct.ProductName = product.ProductName;
            existingProduct.ProductCategorySlug = product.ProductCategorySlug;
            existingProduct.ProductDescription = product.ProductDescription;
            existingProduct.ProductPrice = product.ProductPrice;
            existingProduct.ProductStockQuantity = product.ProductStockQuantity;

            await _context.SaveChangesAsync();

            return existingProduct;
        }
    }
}
