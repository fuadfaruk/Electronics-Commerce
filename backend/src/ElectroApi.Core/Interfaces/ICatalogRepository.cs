using ElectroApi.Core.DTOs;

namespace ElectroApi.Core.Interfaces;

public sealed record CatalogQuery(string Q = "", string[]? Categories = null, string[]? Brands = null, decimal? Min = null, decimal? Max = null, bool InStock = false, string Sort = "relevance", int Page = 1, int PageSize = 12);

public interface ICatalogRepository
{
    Task<CatalogPage> List(CatalogQuery query, bool includeArchived, CancellationToken cancellationToken);
    Task<ProductDetail?> Detail(string? slug, Guid? id, CancellationToken cancellationToken);
    Task<HomeCollections> Home(CancellationToken cancellationToken);
    Task<CategoryDto[]> Categories(bool includeArchived, CancellationToken cancellationToken);
    Task<CategoryDto?> Category(string slug, CancellationToken cancellationToken);
    Task<CategoryDto> SaveCategory(Guid? id, CategoryRequest request, CancellationToken cancellationToken);
    Task<CategoryDto> ArchiveCategory(Guid id, VersionCommand request, CancellationToken cancellationToken);
    Task DeleteCategory(Guid id, long expectedVersion, CancellationToken cancellationToken);
    Task<ProductDto> SaveProduct(Guid? id, ProductRequest request, CancellationToken cancellationToken);
    Task<ProductDto> ArchiveProduct(Guid id, VersionCommand request, CancellationToken cancellationToken);
}
