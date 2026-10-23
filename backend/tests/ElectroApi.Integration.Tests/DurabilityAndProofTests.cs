using System.Net;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ElectroApi.Integration.Tests;

public sealed class DurabilityAndProofTests
{
    [MySqlFact]
    public async Task Failure_after_stock_deduction_rolls_back_order_outbox_capability_receipt_and_stock()
    {
        await using var database = await IsolatedDatabase.Create();
        var mail = new CommerceMail(DataProtectionProvider.Create("ElectroMart.Tests"), new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Storefront:Origin"] = "https://localhost:3000" }).Build());
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options;
        Guid quoteId; long initialVersion; var id = Guid.Parse("00000000-0000-4000-8000-000000000013"); var owner = new CommerceOwner("g:" + CommerceRepository.Hash("rollback"), null, null);
        await using (var setup = new ApplicationDbContext(options))
        {
            await setup.Database.MigrateAsync(); await DevelopmentSeed.Seed(setup);
            initialVersion = await setup.Products.Where(p => p.Id == id).Select(p => p.Version).SingleAsync();
            quoteId = (await new CommerceRepository(setup, mail).Quote(owner, new([new(id, 1)]), default)).QuoteId;
        }
        var failure = new FailBeforeOrderSave();
        var failOptions = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).AddInterceptors(failure).Options;
        await using (var db = new ApplicationDbContext(failOptions))
        {
            var request = new AcceptOrderRequest(quoteId, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka" }, null);
            await Assert.ThrowsAsync<InvalidOperationException>(() => new CommerceRepository(db, mail).Accept(owner, "rollback-key-123456789", request, default));
        }
        Assert.True(failure.ReachedOrderSave);
        await using var check = new ApplicationDbContext(options);
        Assert.Equal(50, await check.Products.Where(p => p.Id == id).Select(p => p.Stock).SingleAsync());
        Assert.Equal(initialVersion, await check.Products.Where(p => p.Id == id).Select(p => p.Version).SingleAsync());
        Assert.Equal(0, await check.Orders.CountAsync()); Assert.Equal(0, await check.CommandReceipts.CountAsync()); Assert.Equal(0, await check.GuestCapabilities.CountAsync()); Assert.Equal(0, await check.EmailOutbox.CountAsync());
    }
    [MySqlFact]
    public async Task Expired_guest_capability_and_scoped_grant_never_authorize_private_order()
    {
        await using var database = await IsolatedDatabase.Create(); await using var factory = new CommerceApiFactory(database.ConnectionString, Path.Combine(Path.GetTempPath(), "kilo", "proof_keys_" + Guid.NewGuid().ToString("N"))); await factory.InitializeDatabase();
        Guid orderId; var capability = CommerceRepository.NewToken(); var grant = CommerceRepository.NewToken();
        using (var scope = factory.Services.CreateScope())
        {
            var commerce = scope.ServiceProvider.GetRequiredService<ICommerceRepository>(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var owner = new CommerceOwner("g:" + CommerceRepository.Hash("proof-owner"), null, null);
            var quote = await commerce.Quote(owner, new([new(Guid.Parse("00000000-0000-4000-8000-000000000013"), 1)]), default);
            orderId = (await commerce.Accept(owner, "proof-test-key-123456789", new(quote.QuoteId, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka" }, null), default)).Id;
            db.GuestCapabilities.Add(new() { OrderId = orderId, TokenHash = CommerceRepository.Hash(capability), ExpiresAt = DateTime.UtcNow.AddSeconds(-1) });
            db.GuestGrants.Add(new() { OrderId = orderId, TokenHash = CommerceRepository.Hash(grant), ExpiresAt = DateTime.UtcNow.AddSeconds(-1) }); await db.SaveChangesAsync();
        }
        using var browser = factory.Browser(); using var expiredCapability = await CommerceApiFactory.Send(browser, "Guest/exchange", new { orderId, capability }); Assert.Equal(HttpStatusCode.BadRequest, expiredCapability.StatusCode);
        using var expiredGrant = factory.Browser(false); expiredGrant.DefaultRequestHeaders.Add("Cookie", "ElectroMart.Grant." + orderId.ToString("N") + "=" + grant);
        using var privateRead = await expiredGrant.GetAsync("/api/v1/Order/" + orderId); Assert.Equal(HttpStatusCode.NotFound, privateRead.StatusCode);
    }
    private sealed class FailBeforeOrderSave : SaveChangesInterceptor
    {
        public bool ReachedOrderSave { get; private set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<Order>().Any(e => e.State == EntityState.Added)) { ReachedOrderSave = true; throw new InvalidOperationException("Injected rollback verification failure."); }
            return ValueTask.FromResult(result);
        }
    }
}
