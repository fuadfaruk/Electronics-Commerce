using System.ComponentModel.DataAnnotations;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;

namespace ElectroApi.Core.DTOs;

public sealed record CategoryDto(Guid Id, string Slug, string Name, string Description, string VisualKey, int SortOrder, bool IsArchived, long Version, int ProductCount);
public sealed record ProductSpecDto(string Label, string Value);
public sealed record ProductDto(Guid Id, string Slug, string Name, string Brand, Guid CategoryId, string CategorySlug, string CategoryName, string Description, decimal Price, decimal? CompareAtPrice, int Stock, long Version, bool Featured, bool IsArchived, bool SaleEligible, string[] Images, ProductSpecDto[] Specs);
public sealed record BrandFacet(string Value, int Count);
public sealed record CategoryFacet(string Slug, string Name, int Count);
public sealed record CatalogFacets(BrandFacet[] Brands, CategoryFacet[] Categories, decimal MinPrice, decimal MaxPrice);
public sealed record CatalogPage(ProductDto[] Items, int TotalCount, int Page, int PageSize, CatalogFacets Facets);
public sealed record ProductDetail(ProductDto Product, ProductDto[] Related);
public sealed record HomeCollections(ProductDto[] Featured, ProductDto[] Deals, ProductDto[] NewArrivals);
public sealed record PagedResult<T>(T[] Items, int TotalCount, int Page, int PageSize);

public sealed class CategoryRequest
{
    [Required, StringLength(160)] public string Slug { get; init; } = "";
    [Required, StringLength(100)] public string Name { get; init; } = "";
    [StringLength(500)] public string Description { get; init; } = "";
    [Required, StringLength(30)] public string VisualKey { get; init; } = "accessories";
    [Range(0, 10000)] public int SortOrder { get; init; }
    public long ExpectedVersion { get; init; }
}

public sealed class ProductRequest
{
    [Required, StringLength(160)] public string Slug { get; init; } = "";
    [Required, StringLength(200)] public string Name { get; init; } = "";
    [StringLength(100)] public string Brand { get; init; } = "";
    public Guid CategoryId { get; init; }
    [StringLength(5000)] public string Description { get; init; } = "";
    public decimal Price { get; init; }
    public decimal? CompareAtPrice { get; init; }
    public bool Featured { get; init; }
    [MaxLength(10)] public string[] Images { get; init; } = [];
    [MaxLength(30)] public ProductSpecDto[] Specs { get; init; } = [];
    public long ExpectedVersion { get; init; }
}

public sealed record VersionCommand([Range(1, long.MaxValue)] long ExpectedVersion, [StringLength(500)] string? Note);
public sealed record StockCommand(int Delta, [Range(1, long.MaxValue)] long ExpectedVersion, [Required, StringLength(500, MinimumLength = 3)] string Reason);
public sealed record StockResult(Guid ProductId, int Stock, long Version);
public sealed record FulfillmentCommand(OrderStatus Status, [Range(1, long.MaxValue)] long ExpectedVersion, [StringLength(500)] string? Note);
public sealed record QuoteItem(Guid ProductId, [Range(1, 99)] int Quantity);
public sealed record QuoteRequest([Required, MinLength(1), MaxLength(50)] QuoteItem[] Items);
public sealed record QuoteProblem(Guid ProductId, string Code, string Message);
public sealed record QuotedLine(Guid ProductId, string Name, string Slug, int Quantity, decimal UnitPrice, decimal LineTotal, int AvailableStock);
public sealed record QuoteResponse(Guid QuoteId, DateTime ExpiresAt, string OwnerKind, QuotedLine[] Lines, MoneySnapshot Money, QuoteProblem[] Problems);

public sealed class ContactRequest
{
    [Required, StringLength(100, MinimumLength = 2)] public string Name { get; init; } = "";
    [Required, EmailAddress, StringLength(254)] public string Email { get; init; } = "";
    [Required, StringLength(20)] public string Phone { get; init; } = "";
}
public sealed class AddressRequest
{
    [Required, StringLength(300, MinimumLength = 5)] public string Street { get; init; } = "";
    [Required, StringLength(100, MinimumLength = 2)] public string Area { get; init; } = "";
    [Required, StringLength(100, MinimumLength = 2)] public string City { get; init; } = "";
    [Required, StringLength(100)] public string District { get; init; } = "";
    [StringLength(4)] public string? Postcode { get; init; }
}
public sealed record AcceptOrderRequest(Guid QuoteId, [Required] ContactRequest Contact, [Required] AddressRequest DeliveryAddress, [StringLength(500)] string? Notes);
public sealed record OrderLineDto(Guid ProductId, string Name, string Slug, int Quantity, decimal UnitPrice, decimal LineTotal);
public sealed record OrderEventDto(string Action, DateTime CreatedAt, string? Note, Guid? ActorId, long Version);
public sealed record OrderSummary(Guid Id, string Number, DateTime CreatedAt, OrderStatus Fulfillment, PaymentStatus Payment, decimal Total, long Version);
public sealed record OrderDto(Guid Id, string Number, DateTime CreatedAt, OrderStatus Fulfillment, PaymentStatus Payment, long Version, ContactSnapshot Contact, AddressSnapshot DeliveryAddress, MoneySnapshot Money, string? Notes, OrderLineDto[] Lines, OrderEventDto[] Events);
public sealed record OrderReceiptDto(Guid Id, string Number, DateTime CreatedAt, MoneySnapshot Money, OrderLineDto[] Lines);
public sealed record GuestExchange(Guid OrderId, [Required, StringLength(100)] string Capability);
public sealed record ClaimRequest(Guid OrderId);
public sealed record ClaimComplete(Guid ClaimId, [Required, StringLength(100)] string Proof);
public sealed record AccountDto(Guid Id, string Name, string Email, bool EmailVerified, bool IsAdmin);
public sealed record RegisterRequest([Required, StringLength(100, MinimumLength = 2)] string Name, [Required, EmailAddress, StringLength(254)] string Email, [Required, StringLength(128, MinimumLength = 10)] string Password);
public sealed record LoginRequest([Required, EmailAddress, StringLength(254)] string Email, [Required, StringLength(128)] string Password);
public sealed record EmailRequest([Required, EmailAddress, StringLength(254)] string Email);
public sealed record EmailProofRequest(Guid UserId, [Required, StringLength(4000)] string Token);
public sealed record ResetRequest(Guid UserId, [Required, StringLength(4000)] string Token, [Required, StringLength(128, MinimumLength = 10)] string Password);
