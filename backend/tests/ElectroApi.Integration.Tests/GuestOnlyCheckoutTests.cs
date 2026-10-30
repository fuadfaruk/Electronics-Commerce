using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Enums;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Identity;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Notifications;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace ElectroApi.Integration.Tests;

public sealed class GuestOnlyCheckoutTests
{
    private static readonly Guid ProductId = Guid.Parse("00000000-0000-4000-8000-000000000013");
    private static ApplicationDbContext Context(string connection) => new(new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(connection).Options);
    private static IConfigurationRoot Settings() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Storefront:Origin"] = CommerceApiFactory.Origin, ["OwnerNotifications:Enabled"] = "false"
    }).Build();
    private static CommerceRepository Service(ApplicationDbContext db, IConfiguration? configuration = null)
    {
        configuration ??= Settings();
        var protection = new EphemeralDataProtectionProvider();
        return new(db, new CommerceMail(protection, configuration), new OwnerOrderNotifications(protection, OwnerNotificationSettings.Read(configuration), configuration), configuration);
    }
    private static CommerceOwner Owner(string name = "first") => new("g:" + CommerceRepository.Hash(name), null, null);
    private static AcceptOrderRequest Request(Guid quote) => new(quote, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka" }, "Sample delivery note");
    private static async Task Setup(string connection)
    {
        await using var db = Context(connection);
        await db.Database.MigrateAsync(); await DevelopmentSeed.Seed(db);
        await db.Products.Where(p => p.Id == ProductId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, 3));
    }
    private static async Task NoExternalPayloads(ApplicationDbContext db)
    {
        Assert.Equal(0, await db.EmailOutbox.CountAsync()); Assert.Equal(0, await db.GuestCapabilities.CountAsync());
        Assert.Equal(0, await db.GuestGrants.CountAsync()); Assert.Equal(0, await db.OrderClaims.CountAsync());
        Assert.Equal(0, await db.OwnerOrderNotifications.CountAsync());
    }

    [Fact]
    public async Task Missing_guest_flag_rejects_account_quotes_before_any_database_access()
    {
        await using var db = Context("Server=127.0.0.1;Port=1;Database=electromart_test_unused;User ID=sample;Password=not-real;SslMode=Disabled;");
        var accountId = Guid.NewGuid(); var owner = new CommerceOwner("a:" + accountId.ToString("N"), accountId, "account@example.com");
        var error = await Assert.ThrowsAsync<CommerceException>(() => Service(db).Quote(owner, new([new(ProductId, 1)]), default));
        Assert.Equal(409, error.Status); Assert.Equal("guest_checkout_required", error.Code);
        Assert.Contains("Sign out", error.Message);
    }

    [MySqlFact]
    public async Task Guest_only_checkout_creates_no_email_or_capability_even_if_mail_is_explicitly_enabled()
    {
        await using var database = await IsolatedDatabase.Create(); await Setup(database.ConnectionString);
        var configuration = Settings(); configuration["Mail:Enabled"] = "true";
        await using var db = Context(database.ConnectionString); var commerce = Service(db, configuration);
        var quote = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default);
        var order = await commerce.Accept(Owner(), "guest-mail-enabled-123456789", Request(quote.QuoteId), default); db.ChangeTracker.Clear();
        await commerce.ChangeOrder(Guid.NewGuid(), order.Id, "guest-mail-update-123456789", "Confirmed", 1, null, default);
        Assert.Equal(1, await db.Orders.CountAsync()); await NoExternalPayloads(db);
    }

    [MySqlFact]
    public async Task Default_quota_survives_cancellation_rejects_another_order_and_keeps_exact_replay()
    {
        await using var database = await IsolatedDatabase.Create(); await Setup(database.ConnectionString);
        await using var db = Context(database.ConnectionString); var commerce = Service(db);
        var quote = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default);
        var request = Request(quote.QuoteId); const string key = "guest-first-order-123456789";
        var order = await commerce.Accept(Owner(), key, request, default); db.ChangeTracker.Clear();
        Assert.Equal(2, await db.CommandReceipts.CountAsync()); await NoExternalPayloads(db);
        var cancelled = await commerce.ChangeOrder(Guid.NewGuid(), order.Id, "guest-cancel-order-123456789", "Cancelled", 1, "Staff-only cancellation note", default); db.ChangeTracker.Clear();
        Assert.Equal(OrderStatus.Cancelled, cancelled.Fulfillment);
        var anotherQuote = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default); db.ChangeTracker.Clear();
        var error = await Assert.ThrowsAsync<CommerceException>(() => commerce.Accept(Owner(), "guest-second-order-123456789", Request(anotherQuote.QuoteId), default));
        Assert.Equal(409, error.Status); Assert.Equal("guest_order_limit", error.Code); db.ChangeTracker.Clear();
        Assert.Equal(1, await db.Orders.CountAsync()); Assert.Equal(3, await db.Products.Where(p => p.Id == ProductId).Select(p => p.Stock).SingleAsync());
        Assert.Equal(1, await db.CommandReceipts.CountAsync(r => r.Operation == "accept-order"));
        Assert.Equal(order.Id, (await db.CommandReceipts.SingleAsync(r => r.Operation == "guest-order-limit")).OrderId);
        await db.Quotes.Where(q => q.Id == quote.QuoteId).ExecuteUpdateAsync(s => s.SetProperty(q => q.ExpiresAt, DateTime.UtcNow.AddHours(-1)));
        var replay = await commerce.Accept(Owner(), key, request, default); db.ChangeTracker.Clear();
        Assert.Equal(order.Id, replay.Id); Assert.Equal(OrderStatus.Cancelled, replay.Fulfillment);
        Assert.Equal(order.Id, (await commerce.Attempt(Owner().Key, key, default))!.Id);
        var independent = await commerce.Quote(Owner("independent"), new([new(ProductId, 1)]), default);
        Assert.NotEqual(order.Id, (await commerce.Accept(Owner("independent"), "guest-independent-123456789", Request(independent.QuoteId), default)).Id);
        Assert.Equal(2, await db.Orders.CountAsync()); Assert.Equal(2, await db.Products.Where(p => p.Id == ProductId).Select(p => p.Stock).SingleAsync());
        await NoExternalPayloads(db);
    }

    [MySqlFact]
    public async Task Different_quotes_keys_and_products_racing_for_one_guest_accept_only_one_order()
    {
        await using var database = await IsolatedDatabase.Create(); await Setup(database.ConnectionString);
        Guid otherProduct; Guid firstQuote; Guid secondQuote;
        await using (var setup = Context(database.ConnectionString))
        {
            otherProduct = await setup.Products.Where(p => p.Id != ProductId && !p.IsArchived).Select(p => p.Id).FirstAsync();
            await setup.Products.Where(p => p.Id == otherProduct).ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, 3));
            var commerce = Service(setup);
            firstQuote = (await commerce.Quote(Owner(), new([new(ProductId, 1)]), default)).QuoteId;
            secondQuote = (await commerce.Quote(Owner(), new([new(otherProduct, 1)]), default)).QuoteId;
        }
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<(Guid? Id, Guid Quote, string Key)> Accept(Guid quote, string key)
        {
            await using var db = Context(database.ConnectionString); await start.Task;
            try { return ((await Service(db).Accept(Owner(), key, Request(quote), default)).Id, quote, key); }
            catch (CommerceException error) { Assert.Equal(409, error.Status); Assert.Equal("guest_order_limit", error.Code); return (null, quote, key); }
        }
        var first = Accept(firstQuote, "guest-race-first-123456789"); var second = Accept(secondQuote, "guest-race-second-123456789"); start.SetResult();
        var responses = await Task.WhenAll(first, second); var winner = Assert.Single(responses, response => response.Id.HasValue); Assert.Single(responses, response => !response.Id.HasValue);
        await using var check = Context(database.ConnectionString);
        Assert.Equal(1, await check.Orders.CountAsync()); Assert.Equal(2, await check.CommandReceipts.CountAsync());
        Assert.Equal(1, await check.CommandReceipts.CountAsync(r => r.Operation == "accept-order"));
        Assert.Equal(5, await check.Products.Where(p => p.Id == ProductId || p.Id == otherProduct).SumAsync(p => p.Stock));
        Assert.Equal(winner.Id, (await Service(check).Accept(Owner(), winner.Key, Request(winner.Quote), default)).Id);
        Assert.Equal(winner.Id, (await check.CommandReceipts.SingleAsync(r => r.Operation == "guest-order-limit")).OrderId);
        await NoExternalPayloads(check);
    }

    [MySqlFact]
    public async Task Concurrent_exact_key_replay_uses_one_order_and_one_owner_quota()
    {
        await using var database = await IsolatedDatabase.Create(); await Setup(database.ConnectionString);
        Guid quote;
        await using (var setup = Context(database.ConnectionString)) quote = (await Service(setup).Quote(Owner(), new([new(ProductId, 1)]), default)).QuoteId;
        async Task<OrderDto> Accept()
        {
            await using var db = Context(database.ConnectionString);
            return await Service(db).Accept(Owner(), "guest-same-key-123456789", Request(quote), default);
        }
        var responses = await Task.WhenAll(Accept(), Accept()); Assert.Equal(responses[0].Id, responses[1].Id);
        await using var check = Context(database.ConnectionString);
        Assert.Equal(1, await check.Orders.CountAsync()); Assert.Equal(2, await check.CommandReceipts.CountAsync());
        Assert.Equal(2, await check.Products.Where(p => p.Id == ProductId).Select(p => p.Stock).SingleAsync());
        await NoExternalPayloads(check);
    }

    [MySqlFact]
    public async Task Historical_claimed_guest_order_without_quota_counts_and_keeps_guest_access_revoked()
    {
        await using var database = await IsolatedDatabase.Create(); await Setup(database.ConnectionString);
        var configuration = Settings(); configuration["Commerce:GuestOnly"] = "false";
        await using var db = Context(database.ConnectionString); var commerce = Service(db, configuration);
        var quote = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default); var request = Request(quote.QuoteId);
        const string key = "guest-historical-123456789"; var order = await commerce.Accept(Owner(), key, request, default); db.ChangeTracker.Clear();
        var account = new ApplicationUser { Id = Guid.NewGuid(), UserName = "claimed@example.com", Email = "claimed@example.com", EmailConfirmed = true };
        db.Users.Add(account); await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        await db.Orders.Where(o => o.Id == order.Id).ExecuteUpdateAsync(s => s.SetProperty(o => o.AccountId, account.Id).SetProperty(o => o.Version, o => o.Version + 1));
        Assert.Equal(0, await db.CommandReceipts.CountAsync(r => r.Operation == "guest-order-limit"));
        configuration["Commerce:GuestOnly"] = "true";
        var nextQuote = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default); db.ChangeTracker.Clear();
        var error = await Assert.ThrowsAsync<CommerceException>(() => commerce.Accept(Owner(), "guest-historical-new-123456789", Request(nextQuote.QuoteId), default));
        Assert.Equal("guest_order_limit", error.Code); db.ChangeTracker.Clear();
        var replay = await Assert.ThrowsAsync<CommerceException>(() => commerce.Accept(Owner(), key, request, default));
        Assert.Equal(404, replay.Status); Assert.Equal("not_found", replay.Code); db.ChangeTracker.Clear();
        Assert.Equal(1, await db.Orders.CountAsync()); Assert.Equal(1, await db.CommandReceipts.CountAsync());
        await NoExternalPayloads(db);
    }

    [MySqlFact]
    public async Task Failed_new_acceptance_rolls_back_both_receipts_and_leaves_the_guest_quota_available()
    {
        await using var database = await IsolatedDatabase.Create(); await Setup(database.ConnectionString);
        await using var db = Context(database.ConnectionString); var commerce = Service(db);
        var quote = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default); db.ChangeTracker.Clear();
        await db.Products.Where(p => p.Id == ProductId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, 599m));
        var error = await Assert.ThrowsAsync<CommerceException>(() => commerce.Accept(Owner(), "guest-rollback-key-123456789", Request(quote.QuoteId), default));
        Assert.Equal("quote_changed", error.Code); db.ChangeTracker.Clear();
        Assert.Equal(0, await db.CommandReceipts.CountAsync()); Assert.Equal(0, await db.Orders.CountAsync());
        Assert.Equal(3, await db.Products.Where(p => p.Id == ProductId).Select(p => p.Stock).SingleAsync());
        var fresh = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default);
        await commerce.Accept(Owner(), "guest-rollback-key-123456789", Request(fresh.QuoteId), default);
        Assert.Equal(1, await db.Orders.CountAsync()); Assert.Equal(2, await db.CommandReceipts.CountAsync()); await NoExternalPayloads(db);
    }

    [MySqlFact]
    public async Task Full_mode_can_accept_multiple_guest_orders_with_mail_off_without_creating_capabilities_or_updates()
    {
        await using var database = await IsolatedDatabase.Create(); await Setup(database.ConnectionString);
        var configuration = Settings(); configuration["Commerce:GuestOnly"] = "false"; configuration["Mail:Enabled"] = "false";
        await using var db = Context(database.ConnectionString); var commerce = Service(db, configuration);
        for (var index = 0; index < 2; index++)
        {
            var quote = await commerce.Quote(Owner(), new([new(ProductId, 1)]), default);
            await commerce.Accept(Owner(), "guest-full-mode-key-123456789-" + index, Request(quote.QuoteId), default); db.ChangeTracker.Clear();
        }
        var order = await db.Orders.AsNoTracking().FirstAsync();
        await commerce.ChangeOrder(Guid.NewGuid(), order.Id, "guest-full-update-123456789", "Confirmed", 1, null, default);
        Assert.Equal(2, await db.Orders.CountAsync()); Assert.Equal(0, await db.CommandReceipts.CountAsync(r => r.Operation == "guest-order-limit"));
        Assert.Equal(1, await db.Products.Where(p => p.Id == ProductId).Select(p => p.Stock).SingleAsync()); await NoExternalPayloads(db);
    }
}
