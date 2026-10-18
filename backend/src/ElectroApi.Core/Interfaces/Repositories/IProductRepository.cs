using ElectroApi.Core.Entities;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.Interfaces.Repositories
{
    public interface IProductRepository
    {
        Task<IEnumerable<Product>> GetAllProductsAsync();
        Task<Product> CreateProductAsync(Product product);
    }
}
