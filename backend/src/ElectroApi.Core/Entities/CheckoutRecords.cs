namespace ElectroApi.Core.Entities;

public sealed class Quote
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string OwnerKey { get; set; }
    public DateTime ExpiresAt { get; set; }
    public MoneySnapshot Money { get; set; } = new("BDT", 0, 0, 0, "bdt-cod-v1");
    public List<QuoteLine> Lines { get; set; } = [];
}

public sealed class QuoteLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid QuoteId { get; set; }
    public Guid ProductId { get; set; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}

public sealed class CommandReceipt
{
    public required string Id { get; set; }
    public required string OwnerKey { get; set; }
    public required string Operation { get; set; }
    public required string KeyHash { get; set; }
    public required string PayloadHash { get; set; }
    public Guid? OrderId { get; set; }
    public string? ResultJson { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class StockAdjustment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Guid ActorId { get; set; }
    public int Delta { get; set; }
    public required string Reason { get; set; }
    public long Version { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class GuestCapability
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public required string TokenHash { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public sealed class GuestGrant
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public required string TokenHash { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public sealed class OrderClaim
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Guid AccountId { get; set; }
    public required string TokenHash { get; set; }
    public DateTime ExpiresAt { get; set; }
    public int Attempts { get; set; }
    public DateTime? ConsumedAt { get; set; }
}

public sealed class EmailOutbox
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string ProtectedPayload { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public int Attempts { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? LeaseUntil { get; set; }
}

public sealed class OwnerOrderNotification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public required string ProtectedPayload { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public int PartCount { get; set; }
    public int CurrentPart { get; set; }
    public int Attempts { get; set; }
    public Guid? LeaseId { get; set; }
    public DateTime? LeaseUntil { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? FailedAt { get; set; }
    public long? LastMessageId { get; set; }
    public string? FailureCode { get; set; }
}
