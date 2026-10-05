using electroapi.core.Entities;
using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.Interfaces.Repositories
{
    public interface IProductRepository
    {
        Task<IEnumerable<Product>> GetAllProductsAsync();
        Task<Product> CreateProductAsync(Product product);
    }
}
