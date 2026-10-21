using ElectroApi.Core.Entities;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.Interfaces.Repositories
{
    public interface IProductRepository
    {
        Task<Product> CreateProductAsync(Product product);
        Task<List<Product>> GetAllProductsAsync();
        Task<Product?> GetProductByIdAsync(Guid productId);
        Task<bool> DeleteProductAsync(Guid productId);
    }
}
