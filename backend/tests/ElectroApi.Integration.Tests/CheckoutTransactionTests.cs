using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace ElectroApi.Integration.Tests;

public sealed class CheckoutTransactionTests
{
    private static ApplicationDbContext Context(string connection) => new(new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(connection).Options);
    private static ICommerceMail Mail() => new CommerceMail(DataProtectionProvider.Create("ElectroMart.Tests"), OwnerNotificationTestSettings.Configuration());
    private static CommerceOwner Owner(string id = "one") => new("g:" + CommerceRepository.Hash(id), null, null);
    private static AcceptOrderRequest Request(Guid quote) => new(quote, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka", Postcode = "1205" }, "Sample delivery note");
    private static async Task<Guid> Setup(string connection, int stock = 3)
    {
        await using var db = Context(connection); await db.Database.MigrateAsync(); await DevelopmentSeed.Seed(db);
        var product = await db.Products.SingleAsync(p => p.Slug == "sample-usb-c-cable"); product.Stock = stock; await db.SaveChangesAsync(); return product.Id;
    }

    [MySqlFact]
    public async Task Quote_merge_authoritative_totals_same_key_replay_expiry_and_immutable_snapshots()
    {
        await using var database = await IsolatedDatabase.Create(); var productId = await Setup(database.ConnectionString);
        var notifications = OwnerNotificationTestSettings.Builder();
        await using var db = Context(database.ConnectionString); var service = new CommerceRepository(db, Mail(), notifications, OwnerNotificationTestSettings.Configuration());
        var quote = await service.Quote(Owner(), new([new(productId, 1), new(productId, 1)]), default);
        Assert.Empty(quote.Problems); Assert.Single(quote.Lines); Assert.Equal(2, quote.Lines[0].Quantity); Assert.Equal(998m, quote.Money.Subtotal); Assert.Equal(80m, quote.Money.Delivery);
        var request = Request(quote.QuoteId); var order = await service.Accept(Owner(), "same-key-123456789", request, default);
        db.ChangeTracker.Clear();
        await db.Quotes.Where(q => q.Id == quote.QuoteId).ExecuteUpdateAsync(s => s.SetProperty(q => q.ExpiresAt, DateTime.UtcNow.AddMinutes(-1)));
        var replay = await service.Accept(Owner(), "same-key-123456789", request, default); Assert.Equal(order.Id, replay.Id);
        Assert.Equal(1, await db.Orders.CountAsync()); Assert.Equal(1, await db.Products.Where(p => p.Id == productId).Select(p => p.Stock).SingleAsync());
        Assert.Equal(1, await db.EmailOutbox.CountAsync()); Assert.Equal(1, await db.GuestCapabilities.CountAsync()); Assert.Equal(1, await db.CommandReceipts.CountAsync());
        var notification = await db.OwnerOrderNotifications.AsNoTracking().SingleAsync();
        Assert.Equal(order.Id, notification.OrderId); Assert.Equal(0, notification.CurrentPart); Assert.Equal(0, notification.Attempts);
        Assert.Null(notification.LeaseId); Assert.Null(notification.LeaseUntil); Assert.Null(notification.CompletedAt); Assert.Null(notification.FailedAt);
        var payload = notifications.Read(notification.ProtectedPayload);
        Assert.Equal(OwnerNotificationTestSettings.ChatId, payload.ChatId); Assert.Equal(order.Number, payload.OrderNumber); Assert.Equal(order.Id, payload.OrderId);
        Assert.Equal(payload.Parts.Length, notification.PartCount);
        db.ChangeTracker.Clear(); var product = await db.Products.SingleAsync(p => p.Id == productId); product.Name = "Changed catalog name"; product.Price = 599m; product.Version++; await db.SaveChangesAsync();
        var stored = (await service.Find(order.Id, default))!;
        Assert.Equal("Sample USB-C Cable", stored.Lines[0].Name); Assert.Equal(499m, stored.Lines[0].UnitPrice); Assert.Equal(1078m, stored.Money.Total); Assert.Equal(DateTimeKind.Utc, stored.CreatedAt.Kind);
        Assert.Equal(Core.Enums.OrderStatus.Pending, stored.Fulfillment); Assert.Equal(Core.Enums.PaymentStatus.Unpaid, stored.Payment);
        var unchanged = await db.OwnerOrderNotifications.AsNoTracking().SingleAsync();
        Assert.Equal(notification.Id, unchanged.Id); Assert.Equal(notification.ProtectedPayload, unchanged.ProtectedPayload);
        var text = string.Join("\n", notifications.Read(unchanged.ProtectedPayload).Parts);
        Assert.Contains("Sample USB-C Cable", text); Assert.Contains("Quantity: 2", text); Assert.Contains("Unit price: BDT 499.00", text);
        Assert.Contains("Line total: BDT 998.00", text); Assert.Contains("Grand total: BDT 1078.00", text); Assert.DoesNotContain("Changed catalog name", text);
        await Assert.ThrowsAsync<CommerceException>(() => service.Accept(Owner(), "same-key-123456789", request with { Notes = "different" }, default));
        Assert.Equal(1, await db.OwnerOrderNotifications.CountAsync());
    }

    [MySqlFact]
    public async Task Simultaneous_same_key_creates_exactly_one_order_receipt_and_deduction()
    {
        await using var database = await IsolatedDatabase.Create(); var productId = await Setup(database.ConnectionString);
        Guid quoteId;
        await using (var db = Context(database.ConnectionString)) quoteId = (await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).Quote(Owner(), new([new(productId, 1)]), default)).QuoteId;
        async Task<OrderDto> Accept()
        {
            await using var db = Context(database.ConnectionString); return await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).Accept(Owner(), "concurrent-key-123456", Request(quoteId), default);
        }
        var responses = await Task.WhenAll(Accept(), Accept()); Assert.Equal(responses[0].Id, responses[1].Id);
        await using var check = Context(database.ConnectionString); Assert.Equal(1, await check.Orders.CountAsync()); Assert.Equal(1, await check.CommandReceipts.CountAsync()); Assert.Equal(2, await check.Products.Where(p => p.Id == productId).Select(p => p.Stock).SingleAsync());
        Assert.Equal(1, await check.EmailOutbox.CountAsync()); Assert.Equal(1, await check.GuestCapabilities.CountAsync());
        Assert.Equal(responses[0].Id, (await check.OwnerOrderNotifications.SingleAsync()).OrderId);
    }

    [MySqlFact]
    public async Task Independent_last_unit_quotes_cannot_oversell_and_failed_acceptance_rolls_back_everything()
    {
        await using var database = await IsolatedDatabase.Create(); var productId = await Setup(database.ConnectionString, 1);
        async Task<Guid> Quote(string owner) { await using var db = Context(database.ConnectionString); return (await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).Quote(Owner(owner), new([new(productId, 1)]), default)).QuoteId; }
        var first = await Quote("first"); var second = await Quote("second");
        async Task<int> Accept(string owner, Guid quote)
        {
            await using var db = Context(database.ConnectionString);
            try { await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).Accept(Owner(owner), "last-unit-key-123456", Request(quote), default); return 1; }
            catch (CommerceException exception) { Assert.Equal("stock_unavailable", exception.Code); return 0; }
        }
        Assert.Equal(1, (await Task.WhenAll(Accept("first", first), Accept("second", second))).Sum());
        await using var check = Context(database.ConnectionString); Assert.Equal(0, await check.Products.Where(p => p.Id == productId).Select(p => p.Stock).SingleAsync()); Assert.Equal(1, await check.Orders.CountAsync()); Assert.Equal(1, await check.CommandReceipts.CountAsync()); Assert.Equal(1, await check.EmailOutbox.CountAsync());
        Assert.Equal(1, await check.OwnerOrderNotifications.CountAsync()); Assert.Equal(1, await check.GuestCapabilities.CountAsync());
    }

    [MySqlFact]
    public async Task Quote_price_and_owner_changes_are_explicit_conflicts_not_silent_adjustments()
    {
        await using var database = await IsolatedDatabase.Create(); var productId = await Setup(database.ConnectionString);
        await using var db = Context(database.ConnectionString); var service = new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration());
        var quote = await service.Quote(Owner(), new([new(productId, 1)]), default);
        var ownerError = await Assert.ThrowsAsync<CommerceException>(() => service.Accept(Owner("other"), "changed-owner-123456", Request(quote.QuoteId), default)); Assert.Equal("quote_owner_changed", ownerError.Code);
        db.ChangeTracker.Clear(); await db.Products.Where(p => p.Id == productId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, 500m).SetProperty(p => p.Version, p => p.Version + 1));
        var priceError = await Assert.ThrowsAsync<CommerceException>(() => service.Accept(Owner(), "changed-price-123456", Request(quote.QuoteId), default)); Assert.Equal("quote_changed", priceError.Code);
        Assert.Equal(0, await db.Orders.CountAsync()); Assert.Equal(3, await db.Products.Where(p => p.Id == productId).Select(p => p.Stock).SingleAsync());
        Assert.Equal(0, await db.EmailOutbox.CountAsync()); Assert.Equal(0, await db.OwnerOrderNotifications.CountAsync()); Assert.Equal(0, await db.CommandReceipts.CountAsync());
    }

    [MySqlFact]
    public async Task Versioned_stock_cancel_and_cash_collection_have_exactly_once_effects()
    {
        await using var database = await IsolatedDatabase.Create(); var productId = await Setup(database.ConnectionString);
        var actor = Guid.NewGuid(); OrderDto order;
        await using (var db = Context(database.ConnectionString))
        {
            var service = new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()); var quote = await service.Quote(Owner(), new([new(productId, 2)]), default); order = await service.Accept(Owner(), "command-order-123456", Request(quote.QuoteId), default);
        }
        async Task<OrderDto> Cancel()
        {
            await using var db = Context(database.ConnectionString); return await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).ChangeOrder(actor, order.Id, "cancel-key-123456789", "Cancelled", 1, "Sample cancelled", default);
        }
        var cancelled = await Task.WhenAll(Cancel(), Cancel()); Assert.All(cancelled, value => Assert.Equal(Core.Enums.OrderStatus.Cancelled, value.Fulfillment));
        await using (var db = Context(database.ConnectionString)) { Assert.Equal(3, await db.Products.Where(p => p.Id == productId).Select(p => p.Stock).SingleAsync()); Assert.Equal(2, await db.Set<OrderEvent>().CountAsync()); Assert.Equal(1, await db.OwnerOrderNotifications.CountAsync()); }
        await using var scope = Context(database.ConnectionString); var commands = new CommerceRepository(scope, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration());
        var quote2 = await commands.Quote(Owner("another"), new([new(productId, 1)]), default); var order2 = await commands.Accept(Owner("another"), "fulfillment-123456789", Request(quote2.QuoteId), default); scope.ChangeTracker.Clear();
        var earlyCash = await Assert.ThrowsAsync<CommerceException>(() => commands.ChangeOrder(actor, order2.Id, "early-cash-123456789", "Collected", 1, null, default)); Assert.Equal("collection_not_allowed", earlyCash.Code); scope.ChangeTracker.Clear();
        order2 = await commands.ChangeOrder(actor, order2.Id, "confirm-key-123456789", "Confirmed", 1, null, default); scope.ChangeTracker.Clear();
        order2 = await commands.ChangeOrder(actor, order2.Id, "ship-key-123456789", "Shipped", 2, null, default); scope.ChangeTracker.Clear();
        await Assert.ThrowsAsync<CommerceException>(() => commands.ChangeOrder(actor, order2.Id, "late-cancel-123456789", "Cancelled", 3, null, default)); scope.ChangeTracker.Clear();
        order2 = await commands.ChangeOrder(actor, order2.Id, "deliver-key-123456789", "Delivered", 3, null, default); scope.ChangeTracker.Clear();
        var collected = await commands.ChangeOrder(actor, order2.Id, "cash-key-123456789", "Collected", 4, "Full cash received", default); scope.ChangeTracker.Clear();
        var cashReplay = await commands.ChangeOrder(actor, order2.Id, "cash-key-123456789", "Collected", 4, "Full cash received", default);
        Assert.Equal(collected.Version, cashReplay.Version); Assert.Equal(Core.Enums.PaymentStatus.Collected, cashReplay.Payment); scope.ChangeTracker.Clear();
        var product = await scope.Products.AsNoTracking().SingleAsync(p => p.Id == productId);
        var adjusted = await commands.AdjustStock(actor, productId, "stock-key-123456789", new(3, product.Version, "Sample restock"), default); scope.ChangeTracker.Clear();
        var stockReplay = await commands.AdjustStock(actor, productId, "stock-key-123456789", new(3, product.Version, "Sample restock"), default);
        Assert.Equal(adjusted, stockReplay); Assert.Equal(1, await scope.StockAdjustments.CountAsync());
        Assert.Equal(2, await scope.OwnerOrderNotifications.CountAsync());
        await Assert.ThrowsAsync<CommerceException>(() => commands.AdjustStock(actor, productId, "stale-stock-123456789", new(1, product.Version, "Sample stale"), default));
    }
    [MySqlFact]
    public async Task Lock_timeout_retries_are_bounded_roll_back_receipts_and_original_key_can_recover()
    {
        await using var database = await IsolatedDatabase.Create(); var productId = await Setup(database.ConnectionString);
        Guid quoteId;
        await using (var quoteDb = Context(database.ConnectionString)) quoteId = (await new CommerceRepository(quoteDb, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).Quote(Owner(), new([new(productId, 1)]), default)).QuoteId;
        await using var locked = Context(database.ConnectionString); await using var blocker = await locked.Database.BeginTransactionAsync();
        await locked.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Products WHERE Id = {productId.ToString()} FOR UPDATE");
        await using var buyer = Context(database.ConnectionString); await buyer.Database.OpenConnectionAsync(); await buyer.Database.ExecuteSqlRawAsync("SET SESSION innodb_lock_wait_timeout = 1");
        var service = new CommerceRepository(buyer, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration());
        var exception = await Assert.ThrowsAsync<CommerceException>(() => service.Accept(Owner(), "timeout-recovery-123456", Request(quoteId), default)); Assert.Equal(503, exception.Status);
        Assert.Equal(0, await buyer.CommandReceipts.CountAsync()); Assert.Equal(0, await buyer.Orders.CountAsync()); Assert.Equal(0, await buyer.OwnerOrderNotifications.CountAsync()); Assert.Equal(0, await buyer.EmailOutbox.CountAsync()); Assert.Equal(0, await buyer.GuestCapabilities.CountAsync());
        await blocker.CommitAsync();
        var recovered = await service.Accept(Owner(), "timeout-recovery-123456", Request(quoteId), default);
        Assert.NotEqual(Guid.Empty, recovered.Id); Assert.Equal(1, await buyer.Orders.CountAsync()); Assert.Equal(2, await buyer.Products.Where(p => p.Id == productId).Select(p => p.Stock).SingleAsync());
        Assert.Equal(recovered.Id, (await buyer.OwnerOrderNotifications.SingleAsync()).OrderId); Assert.Equal(1, await buyer.EmailOutbox.CountAsync()); Assert.Equal(1, await buyer.GuestCapabilities.CountAsync()); Assert.Equal(1, await buyer.CommandReceipts.CountAsync());
    }
    [MySqlFact]
    public async Task Stock_adjustment_and_checkout_contention_never_lose_stock_updates()
    {
        await using var database = await IsolatedDatabase.Create(); var productId = await Setup(database.ConnectionString);
        Guid quoteId;
        await using (var db = Context(database.ConnectionString)) quoteId = (await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).Quote(Owner(), new([new(productId, 1)]), default)).QuoteId;
        async Task Accept() { await using var db = Context(database.ConnectionString); await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).Accept(Owner(), "stock-race-order-123456", Request(quoteId), default); }
        async Task<int> Adjust()
        {
            await using var db = Context(database.ConnectionString);
            try { await new CommerceRepository(db, Mail(), OwnerNotificationTestSettings.Builder(), OwnerNotificationTestSettings.Configuration()).AdjustStock(Guid.NewGuid(), productId, "stock-race-adjust-123456", new(1, 1, "Sample stock count"), default); return 1; }
            catch (CommerceException exception) { Assert.Equal("stale_version", exception.Code); return 0; }
        }
        var adjustment = Adjust(); await Task.WhenAll(Accept(), adjustment);
        await using var check = Context(database.ConnectionString); Assert.Equal(2 + await adjustment, await check.Products.Where(p => p.Id == productId).Select(p => p.Stock).SingleAsync()); Assert.Equal(1, await check.Orders.CountAsync());
    }
}
