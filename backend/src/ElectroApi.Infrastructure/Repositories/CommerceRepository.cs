using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace ElectroApi.Infrastructure.Repositories;

public sealed class CommerceRepository(ApplicationDbContext db, ICommerceMail mail) : ICommerceRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public static string NewToken() => Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
    public static OrderDto Map(Order order, bool admin = false) => new(order.Id, order.Number, order.CreatedAt, order.Fulfillment, order.Payment, order.Version, order.Contact, order.DeliveryAddress, order.Money, order.Notes, order.Lines.OrderBy(l => l.Position).ThenBy(l => l.Id).Select(l => new OrderLineDto(l.ProductId, l.Name, l.Slug, l.Quantity, l.UnitPrice, l.LineTotal)).ToArray(), order.Events.OrderBy(e => e.CreatedAt).ThenBy(e => e.Version).Select(e => new OrderEventDto(e.Action, e.CreatedAt, admin ? e.Note : null, admin ? e.ActorId : null, e.Version)).ToArray());
    private static string ReceiptId(string owner, string operation, string key) => Hash(owner + "|" + operation + "|" + Hash(key));
    private static void Key(string key) => CommerceRules.Require(key.Length is >= 16 and <= 100 && key.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'), "invalid_idempotency_key", "A stable bounded idempotency key is required.");
    private async Task<CommandReceipt> Receipt(string owner, string operation, string key, object payload, CancellationToken ct)
    {
        Key(key);
        var id = ReceiptId(owner, operation, key); var keyHash = Hash(key); var payloadHash = Hash(JsonSerializer.Serialize(payload, Json)); var now = DateTime.UtcNow;
        // The unique receipt insert and row lock serialize same-key requests inside the commerce transaction.
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT IGNORE INTO CommandReceipts (Id, OwnerKey, Operation, KeyHash, PayloadHash, CreatedAt) VALUES ({id}, {owner}, {operation}, {keyHash}, {payloadHash}, {now})", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM CommandReceipts WHERE Id = {id} FOR UPDATE", ct);
        var receipt = await db.CommandReceipts.SingleAsync(r => r.Id == id, ct);
        CommerceRules.Require(receipt.PayloadHash == payloadHash, "idempotency_conflict", "This key was already used for different details. Recover the original attempt before starting another.", 409);
        return receipt;
    }
    private Task LockProduct(Guid id, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Products WHERE Id = {id.ToString()} FOR UPDATE", ct);
    private Task LockOrder(Guid id, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Orders WHERE Id = {id.ToString()} FOR UPDATE", ct);
    public async Task<QuoteResponse> Quote(CommerceOwner owner, QuoteRequest request, CancellationToken ct)
    {
        CommerceRules.Require(request.Items is { Length: > 0 and <= 50 } && request.Items.All(i => i.ProductId != Guid.Empty && i.Quantity is >= 1 and <= 99), "invalid_quantity", "Choose between 1 and 99 units per product, with at most 50 lines.");
        var items = request.Items.GroupBy(i => i.ProductId).Select(g => new QuoteItem(g.Key, g.Sum(i => i.Quantity))).OrderBy(i => i.ProductId.ToString(), StringComparer.Ordinal).ToArray();
        CommerceRules.Require(items.All(i => i.Quantity <= 99), "invalid_quantity", "Duplicate lines exceed the allowed quantity.");
        var ids = items.Select(i => i.ProductId).ToArray();
        var products = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var problems = new List<QuoteProblem>(); var lines = new List<QuotedLine>();
        foreach (var item in items)
        {
            if (!products.TryGetValue(item.ProductId, out var product) || product.IsArchived) { problems.Add(new(item.ProductId, "product_unavailable", "This product is no longer available for sale.")); continue; }
            if (product.Stock < item.Quantity) problems.Add(new(item.ProductId, "stock_unavailable", $"Only {product.Stock} units are currently available."));
            lines.Add(new(product.Id, product.Name, product.Slug, item.Quantity, product.Price, product.Price * item.Quantity, product.Stock));
        }
        var quote = new Quote { OwnerKey = owner.Key, ExpiresAt = DateTime.UtcNow.AddMinutes(15), Money = CommerceRules.Totals(lines.Sum(l => l.LineTotal)), Lines = lines.Select(l => new QuoteLine { ProductId = l.ProductId, Quantity = l.Quantity, UnitPrice = l.UnitPrice }).ToList() };
        if (problems.Count == 0) { db.Quotes.Add(quote); await db.SaveChangesAsync(ct); }
        return new(quote.Id, quote.ExpiresAt, owner.AccountId.HasValue ? "account" : "guest", lines.ToArray(), quote.Money, problems.ToArray());
    }
    public Task<OrderDto> Accept(CommerceOwner owner, string key, AcceptOrderRequest request, CancellationToken ct) => Retry(() => AcceptOnce(owner, key, request, ct), ct);
    private async Task<OrderDto> AcceptOnce(CommerceOwner owner, string key, AcceptOrderRequest request, CancellationToken ct)
    {
        var (contact, address) = CommerceRules.Contact(request, owner.Email);
        var notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct);
        var receipt = await Receipt(owner.Key, "accept-order", key, new { request.QuoteId, contact, address, notes }, ct);
        if (receipt.OrderId is { } accepted)
        {
            await LockOrder(accepted, ct);
            var existing = (await Find(accepted, ct))!;
            CommerceRules.Require(existing.AccountId == owner.AccountId && (owner.AccountId.HasValue || existing.CheckoutOwner == owner.Key), "not_found", "Order unavailable.", 404);
            await transaction.CommitAsync(ct); return Map(existing);
        }
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Quotes WHERE Id = {request.QuoteId.ToString()} FOR UPDATE", ct);
        var quote = await db.Quotes.AsNoTracking().Include(q => q.Lines).SingleOrDefaultAsync(q => q.Id == request.QuoteId, ct) ?? throw new CommerceException(409, "quote_expired", "This quote is unavailable. Refresh the cart and request a new quote.");
        CommerceRules.Require(quote.OwnerKey == owner.Key, "quote_owner_changed", "Checkout ownership changed. Request a fresh quote under the current session.", 409);
        CommerceRules.Require(quote.ExpiresAt > DateTime.UtcNow, "quote_expired", "This quote expired. Review a fresh quote before ordering.", 409);
        CommerceRules.Require(!await db.Orders.AnyAsync(o => o.QuoteId == quote.Id, ct), "quote_already_accepted", "This quote already created an order. Recover the original attempt.", 409);
        var lines = quote.Lines.OrderBy(l => l.ProductId.ToString(), StringComparer.Ordinal).ToArray();
        foreach (var line in lines) await LockProduct(line.ProductId, ct);
        var ids = lines.Select(l => l.ProductId).ToArray(); var products = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        foreach (var line in lines)
        {
            CommerceRules.Require(products.TryGetValue(line.ProductId, out var product) && !product.IsArchived, "product_unavailable", "A product is no longer available. Review a fresh quote.", 409);
            CommerceRules.Require(product!.Price == line.UnitPrice, "quote_changed", "A price changed. Review a fresh quote before ordering.", 409);
            CommerceRules.Require(product.Stock >= line.Quantity, "stock_unavailable", "Available stock changed. Review a fresh quote before ordering.", 409);
        }
        var money = CommerceRules.Totals(lines.Sum(l => l.UnitPrice * l.Quantity));
        CommerceRules.Require(money == quote.Money && quote.Money.PolicyVersion == CommerceRules.MoneyPolicy, "quote_changed", "The totals policy changed. Review a fresh quote.", 409);
        foreach (var line in lines)
        {
            var product = products[line.ProductId];
            var affected = await db.Products.Where(p => p.Id == line.ProductId && p.Version == product.Version && !p.IsArchived && p.Stock >= line.Quantity).ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, p => p.Stock - line.Quantity).SetProperty(p => p.Version, p => p.Version + 1), ct);
            CommerceRules.Require(affected == 1, "stock_unavailable", "Stock changed during checkout. Review a fresh quote.", 409);
        }
        var id = Guid.NewGuid();
        var order = new Order { Id = id, Number = "EM-" + DateTime.UtcNow.ToString("yyyyMMdd") + "-" + id.ToString("N")[..12].ToUpperInvariant(), QuoteId = quote.Id, AccountId = owner.AccountId, CheckoutOwner = owner.Key, Contact = contact, NormalizedEmail = contact.Email.ToUpperInvariant(), DeliveryAddress = address, Money = money, Notes = notes, Lines = lines.Select((line, index) => new OrderLine { ProductId = line.ProductId, Name = products[line.ProductId].Name, Slug = products[line.ProductId].Slug, UnitPrice = line.UnitPrice, Quantity = line.Quantity, LineTotal = line.UnitPrice * line.Quantity, Position = index }).ToList(), Events = [new OrderEvent { Action = "Accepted", ActorId = owner.AccountId, Version = 1 }] };
        db.Orders.Add(order); receipt.OrderId = order.Id;
        var body = $"Your COD order {order.Number} was accepted. Total BDT {order.Money.Total:0}. Payment is Unpaid and will be collected at delivery.\n";
        if (!owner.AccountId.HasValue)
        {
            var capability = NewToken();
            db.GuestCapabilities.Add(new() { OrderId = id, TokenHash = Hash(capability), ExpiresAt = DateTime.UtcNow.AddDays(30) });
            body += "Track this order with the private link below. Do not share it. Open it and choose Unlock order:\n" + mail.Link("/orders/" + id, new Dictionary<string, string> { ["capability"] = capability });
        }
        else body += mail.Link("/account/orders/" + id, new Dictionary<string, string>());
        db.EmailOutbox.Add(mail.Create(contact.Email, "ElectroMart COD order accepted", body));
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        return Map(order);
    }
    public Task<Order?> Find(Guid id, CancellationToken ct) => db.Orders.AsNoTracking().Include(o => o.Lines).Include(o => o.Events).AsSplitQuery().SingleOrDefaultAsync(o => o.Id == id, ct);
    public async Task<Order?> Attempt(string owner, string key, CancellationToken ct)
    {
        Key(key); var id = ReceiptId(owner, "accept-order", key);
        var orderId = await db.CommandReceipts.AsNoTracking().Where(r => r.Id == id).Select(r => r.OrderId).SingleOrDefaultAsync(ct);
        return orderId is { } guid ? await Find(guid, ct) : null;
    }
    public async Task<PagedResult<OrderSummary>> Orders(Guid? accountId, string? status, int page, int pageSize, CancellationToken ct)
    {
        CommerceRules.Require(page is >= 1 and <= 100000 && pageSize is >= 1 and <= 100, "invalid_page", "Page must be positive and pageSize must be between 1 and 100.");
        var orders = db.Orders.AsNoTracking().Where(o => accountId == null || o.AccountId == accountId);
        if (!string.IsNullOrEmpty(status)) { CommerceRules.Require(Enum.TryParse<OrderStatus>(status, out var fulfillment) && Enum.IsDefined(fulfillment), "invalid_filters", "Choose a valid order status."); orders = orders.Where(o => o.Fulfillment == fulfillment); }
        var total = await orders.CountAsync(ct);
        var rows = await orders.OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id).Skip((page - 1) * pageSize).Take(pageSize).Select(o => new OrderSummary(o.Id, o.Number, o.CreatedAt, o.Fulfillment, o.Payment, o.Money.Total, o.Version)).ToArrayAsync(ct);
        return new(rows, total, page, pageSize);
    }
    public Task<StockResult> AdjustStock(Guid actor, Guid productId, string key, StockCommand request, CancellationToken ct) => Retry(() => AdjustStockOnce(actor, productId, key, request, ct), ct);
    private async Task<StockResult> AdjustStockOnce(Guid actor, Guid productId, string key, StockCommand request, CancellationToken ct)
    {
        CommerceRules.Require(request.Delta is not 0 and >= -1000000 and <= 1000000 && request.Reason.Trim().Length is >= 3 and <= 500, "invalid_stock", "A nonzero bounded stock delta and reason are required.");
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct);
        var receipt = await Receipt("a:" + actor.ToString("N"), "stock:" + productId.ToString("N"), key, new { request.Delta, request.ExpectedVersion, Reason = request.Reason.Trim() }, ct);
        if (receipt.ResultJson is not null) { var prior = JsonSerializer.Deserialize<StockResult>(receipt.ResultJson, Json)!; await transaction.CommitAsync(ct); return prior; }
        await LockProduct(productId, ct);
        var product = await db.Products.AsNoTracking().SingleOrDefaultAsync(p => p.Id == productId, ct) ?? throw new CommerceException(404, "not_found", "Product not found.");
        CommerceRules.Require(product.Version == request.ExpectedVersion, "stale_version", "Product changed. Reload before adjusting stock.", 409);
        CommerceRules.Require((long)product.Stock + request.Delta is >= 0 and <= 1000000, "invalid_stock", "This stock delta would exceed the permitted stock range.", 409);
        var affected = await db.Products.Where(p => p.Id == productId && p.Version == request.ExpectedVersion).ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, p => p.Stock + request.Delta).SetProperty(p => p.Version, p => p.Version + 1), ct);
        CommerceRules.Require(affected == 1, "stale_version", "Product changed. Reload before adjusting stock.", 409);
        var result = new StockResult(productId, product.Stock + request.Delta, product.Version + 1);
        db.StockAdjustments.Add(new() { ProductId = productId, ActorId = actor, Delta = request.Delta, Reason = request.Reason.Trim(), Version = result.Version }); receipt.ResultJson = JsonSerializer.Serialize(result, Json);
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return result;
    }
    public Task<OrderDto> ChangeOrder(Guid actor, Guid id, string key, string action, long expectedVersion, string? note, CancellationToken ct) => Retry(() => ChangeOrderOnce(actor, id, key, action, expectedVersion, note, ct), ct);
    private async Task<OrderDto> ChangeOrderOnce(Guid actor, Guid id, string key, string action, long expectedVersion, string? note, CancellationToken ct)
    {
        CommerceRules.Require(note?.Length is null or <= 500, "invalid_notes", "Notes must not exceed 500 characters.");
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct);
        var receipt = await Receipt("a:" + actor.ToString("N"), "order:" + id.ToString("N"), key, new { action, expectedVersion, note = note?.Trim() }, ct);
        if (receipt.OrderId is { } existing) { var prior = Map((await Find(existing, ct))!, true); await transaction.CommitAsync(ct); return prior; }
        await LockOrder(id, ct);
        var order = await db.Orders.Include(o => o.Lines).Include(o => o.Events).SingleOrDefaultAsync(o => o.Id == id, ct) ?? throw new CommerceException(404, "not_found", "Order not found.");
        CommerceRules.Require(order.Version == expectedVersion, "stale_version", "Order changed. Reload before submitting a command.", 409);
        if (action == "Collected")
        {
            CommerceRules.Require(order.Fulfillment == OrderStatus.Delivered && order.Payment == PaymentStatus.Unpaid, "collection_not_allowed", "Cash may be collected only once after delivery.", 409);
            order.Payment = PaymentStatus.Collected;
        }
        else
        {
            CommerceRules.Require(Enum.TryParse<OrderStatus>(action, out var next) && CommerceRules.CanTransition(order.Fulfillment, next), "invalid_transition", "This fulfillment transition is not allowed.", 409);
            if (next == OrderStatus.Cancelled)
            {
                foreach (var line in order.Lines.OrderBy(l => l.ProductId.ToString(), StringComparer.Ordinal)) await LockProduct(line.ProductId, ct);
                foreach (var line in order.Lines.OrderBy(l => l.ProductId.ToString(), StringComparer.Ordinal))
                {
                    var affected = await db.Products.Where(p => p.Id == line.ProductId && p.Stock <= 1000000 - line.Quantity).ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, p => p.Stock + line.Quantity).SetProperty(p => p.Version, p => p.Version + 1), ct);
                    CommerceRules.Require(affected == 1, "invalid_stock", "Stock restoration requires an operator review.", 409);
                }
            }
            order.Fulfillment = next;
        }
        order.Version++;
        var audit = new OrderEvent { OrderId = id, ActorId = actor, Action = action, Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(), Version = order.Version };
        db.Add(audit); order.Events.Add(audit); receipt.OrderId = id;
        db.EmailOutbox.Add(mail.Create(order.Contact.Email, "ElectroMart order update", $"Order {order.Number}: {action}. Total BDT {order.Money.Total:0}; payment {order.Payment}. Your accepted order totals have not changed."));
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return Map(order, true);
    }
    private async Task<T> Retry<T>(Func<Task<T>> operation, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            try { return await operation(); }
            catch (Exception exception) when ((exception as MySqlException ?? exception.InnerException as MySqlException)?.Number is 1213 or 1205)
            {
                // The failed transaction has disposed/rolled back; retry its entire original-key operation.
                db.ChangeTracker.Clear();
                if (attempt >= 2) throw new CommerceException(503, "temporarily_unavailable", "The operation is busy. Recover or retry with the original attempt key.");
                await Task.Delay(25 * (attempt + 1) + Random.Shared.Next(25), ct);
            }
        }
    }
}
