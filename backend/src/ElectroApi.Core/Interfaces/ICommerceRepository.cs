using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;

namespace ElectroApi.Core.Interfaces;

public sealed record CommerceOwner(string Key, Guid? AccountId, string? Email);

public interface ICommerceRepository
{
    Task<QuoteResponse> Quote(CommerceOwner owner, QuoteRequest request, CancellationToken ct);
    Task<OrderDto> Accept(CommerceOwner owner, string idempotencyKey, AcceptOrderRequest request, CancellationToken ct);
    Task<Order?> Find(Guid id, CancellationToken ct);
    Task<Order?> Attempt(string ownerKey, string idempotencyKey, CancellationToken ct);
    Task<PagedResult<OrderSummary>> Orders(Guid? accountId, string? status, int page, int pageSize, CancellationToken ct);
    Task<StockResult> AdjustStock(Guid actorId, Guid productId, string idempotencyKey, StockCommand request, CancellationToken ct);
    Task<OrderDto> ChangeOrder(Guid actorId, Guid id, string idempotencyKey, string action, long expectedVersion, string? note, CancellationToken ct);
}
