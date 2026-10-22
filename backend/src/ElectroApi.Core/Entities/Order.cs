using ElectroApi.Core.Enums;

namespace ElectroApi.Core.Entities;

public sealed record ContactSnapshot(string Name, string Email, string Phone);
public sealed record AddressSnapshot(string Street, string Area, string City, string District, string? Postcode);
public sealed record MoneySnapshot(string Currency, decimal Subtotal, decimal Delivery, decimal Total, string PolicyVersion);

public sealed class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Number { get; set; }
    public Guid QuoteId { get; set; }
    public Guid? AccountId { get; set; }
    public required string CheckoutOwner { get; set; }
    public required string NormalizedEmail { get; set; }
    public ContactSnapshot Contact { get; set; } = new("", "", "");
    public AddressSnapshot DeliveryAddress { get; set; } = new("", "", "", "", null);
    public MoneySnapshot Money { get; set; } = new("BDT", 0, 0, 0, "bdt-cod-v1");
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public OrderStatus Fulfillment { get; set; } = OrderStatus.Pending;
    public PaymentStatus Payment { get; set; } = PaymentStatus.Unpaid;
    public long Version { get; set; } = 1;
    public List<OrderLine> Lines { get; set; } = [];
    public List<OrderEvent> Events { get; set; } = [];
}

public sealed class OrderLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Guid ProductId { get; set; }
    public required string Name { get; set; }
    public required string Slug { get; set; }
    public decimal UnitPrice { get; set; }
    public int Quantity { get; set; }
    public decimal LineTotal { get; set; }
    public int Position { get; set; }
}

public sealed class OrderEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Guid? ActorId { get; set; }
    public required string Action { get; set; }
    public string? Note { get; set; }
    public long Version { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
