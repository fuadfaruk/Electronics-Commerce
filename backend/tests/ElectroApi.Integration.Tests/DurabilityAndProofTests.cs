using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Notifications;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using MySql.Data.MySqlClient;

namespace ElectroApi.Integration.Tests;

public sealed class DurabilityAndProofTests
{
    [MySqlFact]
    public async Task Failure_after_stock_deduction_rolls_back_order_outbox_capability_receipt_and_stock()
    {
        await using var database = await IsolatedDatabase.Create();
        var protection = new EphemeralDataProtectionProvider();
        var mail = new CommerceMail(protection, OwnerNotificationTestSettings.Configuration()); var notifications = OwnerNotificationTestSettings.Builder(protection);
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options;
        Guid quoteId; long initialVersion; var id = Guid.Parse("00000000-0000-4000-8000-000000000013"); var owner = new CommerceOwner("g:" + CommerceRepository.Hash("rollback"), null, null);
        await using (var setup = new ApplicationDbContext(options))
        {
            await setup.Database.MigrateAsync(); await DevelopmentSeed.Seed(setup);
            initialVersion = await setup.Products.Where(p => p.Id == id).Select(p => p.Version).SingleAsync();
            quoteId = (await new CommerceRepository(setup, mail, notifications).Quote(owner, new([new(id, 1)]), default)).QuoteId;
        }
        var failure = new FailBeforeOrderSave();
        var failOptions = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).AddInterceptors(failure).Options;
        await using (var db = new ApplicationDbContext(failOptions))
        {
            var request = new AcceptOrderRequest(quoteId, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka" }, null);
            await Assert.ThrowsAsync<InvalidOperationException>(() => new CommerceRepository(db, mail, notifications).Accept(owner, "rollback-key-123456789", request, default));
        }
        Assert.True(failure.ReachedOrderSave); Assert.True(failure.ReachedNotificationSave); Assert.True(failure.ReachedMailAndCapabilitySave);
        await using var check = new ApplicationDbContext(options);
        Assert.Equal(50, await check.Products.Where(p => p.Id == id).Select(p => p.Stock).SingleAsync());
        Assert.Equal(initialVersion, await check.Products.Where(p => p.Id == id).Select(p => p.Version).SingleAsync());
        Assert.Equal(0, await check.Orders.CountAsync()); Assert.Equal(0, await check.CommandReceipts.CountAsync()); Assert.Equal(0, await check.GuestCapabilities.CountAsync()); Assert.Equal(0, await check.EmailOutbox.CountAsync()); Assert.Equal(0, await check.OwnerOrderNotifications.CountAsync());
    }

    [MySqlFact]
    public Task Owner_enqueuer_failure_rolls_back_acceptance_and_original_key_can_retry() => AssertNotificationRollback(databaseConstraint: false);

    [MySqlFact]
    public Task Notification_progress_constraint_failure_during_SaveChanges_rolls_back_acceptance() => AssertNotificationRollback(databaseConstraint: true);

    private static async Task AssertNotificationRollback(bool databaseConstraint)
    {
        await using var database = await IsolatedDatabase.Create();
        var protection = new EphemeralDataProtectionProvider(); var mail = new CommerceMail(protection, OwnerNotificationTestSettings.Configuration());
        var notifications = OwnerNotificationTestSettings.Builder(protection); var failingEnqueuer = new FailAfterBuildingNotification(notifications);
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options;
        var owner = new CommerceOwner("g:" + CommerceRepository.Hash("owner-notification-rollback"), null, null);
        var productId = Guid.Parse("00000000-0000-4000-8000-000000000013"); Guid quoteId; long initialVersion;
        await using (var setup = new ApplicationDbContext(options))
        {
            await setup.Database.MigrateAsync(); await DevelopmentSeed.Seed(setup);
            initialVersion = await setup.Products.Where(product => product.Id == productId).Select(product => product.Version).SingleAsync();
            quoteId = (await new CommerceRepository(setup, mail, notifications).Quote(owner, new([new(productId, 1)]), default)).QuoteId;
        }
        var request = new AcceptOrderRequest(quoteId, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka", Postcode = "1205" }, "Synthetic delivery notes");
        const string key = "notification-rollback-123456789";
        var invalidProgress = new InvalidateNotificationAtSave();
        var failingOptions = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString);
        if (databaseConstraint) failingOptions.AddInterceptors(invalidProgress);
        await using (var failed = new ApplicationDbContext(failingOptions.Options))
        {
            var commerce = new CommerceRepository(failed, mail, databaseConstraint ? notifications : failingEnqueuer);
            if (databaseConstraint)
            {
                var exception = await Assert.ThrowsAsync<DbUpdateException>(() => commerce.Accept(owner, key, request, default));
                Assert.Equal(3819, Assert.IsType<MySqlException>(exception.InnerException).Number); Assert.True(invalidProgress.ReachedNotificationSave);
            }
            else
            {
                await Assert.ThrowsAsync<InvalidOperationException>(() => commerce.Accept(owner, key, request, default));
                Assert.NotNull(failingEnqueuer.BuiltNotification); Assert.NotEmpty(failingEnqueuer.BuiltNotification.ProtectedPayload);
            }
        }
        await using var check = new ApplicationDbContext(options);
        Assert.Equal(50, await check.Products.Where(product => product.Id == productId).Select(product => product.Stock).SingleAsync());
        Assert.Equal(initialVersion, await check.Products.Where(product => product.Id == productId).Select(product => product.Version).SingleAsync());
        Assert.Equal(0, await check.Orders.CountAsync()); Assert.Equal(0, await check.Set<OrderEvent>().CountAsync()); Assert.Equal(0, await check.CommandReceipts.CountAsync());
        Assert.Equal(0, await check.EmailOutbox.CountAsync()); Assert.Equal(0, await check.GuestCapabilities.CountAsync()); Assert.Equal(0, await check.OwnerOrderNotifications.CountAsync());
        Assert.Equal(1, await check.Quotes.CountAsync());
        var recovered = await new CommerceRepository(check, mail, notifications).Accept(owner, key, request, default);
        Assert.Equal(recovered.Id, (await check.OwnerOrderNotifications.SingleAsync()).OrderId);
        Assert.Equal(1, await check.Orders.CountAsync()); Assert.Equal(1, await check.EmailOutbox.CountAsync()); Assert.Equal(1, await check.GuestCapabilities.CountAsync()); Assert.Equal(1, await check.CommandReceipts.CountAsync());
        Assert.Equal(49, await check.Products.Where(product => product.Id == productId).Select(product => product.Stock).SingleAsync());
        Assert.Equal(initialVersion + 1, await check.Products.Where(product => product.Id == productId).Select(product => product.Version).SingleAsync());
    }

    [MySqlFact]
    public async Task Lost_response_recovery_and_expired_replay_keep_one_fixed_private_snapshot_without_token_or_proof()
    {
        await using var database = await IsolatedDatabase.Create();
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options;
        var protection = new EphemeralDataProtectionProvider(); var configuration = OwnerNotificationTestSettings.Configuration();
        var mail = new CommerceMail(protection, configuration); var notifications = OwnerNotificationTestSettings.Builder(protection);
        var owner = new CommerceOwner("g:" + CommerceRepository.Hash("lost-response-owner"), null, null);
        const string key = "lost-response-notification-123456789";
        AcceptOrderRequest request; OwnerOrderNotification original; OwnerNotificationPayload payload; Guid orderId;
        await using (var db = new ApplicationDbContext(options))
        {
            await db.Database.MigrateAsync(); await DevelopmentSeed.Seed(db); var commerce = new CommerceRepository(db, mail, notifications);
            var quote = await commerce.Quote(owner, new([new(Guid.Parse("00000000-0000-4000-8000-000000000013"), 1)]), default);
            request = new(quote.QuoteId, new() { Name = "Sample Customer", Email = "sample@example.com", Phone = "01712345678" }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka", Postcode = "1205" }, "Synthetic delivery notes");
            await commerce.Accept(owner, key, request, default); // Discard the accepted response, then recover in another context.
            db.ChangeTracker.Clear(); orderId = (await db.Orders.AsNoTracking().SingleAsync()).Id;
            original = await db.OwnerOrderNotifications.AsNoTracking().SingleAsync(); payload = notifications.Read(original.ProtectedPayload);
            var emailRow = await db.EmailOutbox.AsNoTracking().SingleAsync();
            var email = JsonSerializer.Deserialize<MailPayload>(protection.CreateProtector("ElectroMart.EmailOutbox.v1").Unprotect(emailRow.ProtectedPayload))!;
            var link = email.Body.Split('\n').Single(line => line.StartsWith(CommerceApiFactory.Origin + "/orders/" + orderId, StringComparison.Ordinal));
            var fragment = new Uri(link).Fragment; Assert.StartsWith("#capability=", fragment);
            var capability = Uri.UnescapeDataString(fragment["#capability=".Length..]); Assert.NotEmpty(capability);
            var capabilityHash = CommerceRepository.Hash(capability); Assert.Equal(capabilityHash, (await db.GuestCapabilities.AsNoTracking().SingleAsync()).TokenHash);
            var serialized = JsonSerializer.Serialize(payload); var text = string.Join("\n", payload.Parts);
            foreach (var forbidden in new[] { capability, capabilityHash, key, owner.Key, OwnerNotificationTestSettings.BotToken, "capability=", "proof=", "/account/", "#" }) Assert.DoesNotContain(forbidden, serialized);
            foreach (var privateText in new[] { "Sample Customer", "sample@example.com", "01712345678", "123 Sample Road", "Synthetic delivery notes", OwnerNotificationTestSettings.BotToken, capability }) Assert.DoesNotContain(privateText, original.ProtectedPayload);
            foreach (var required in new[] { "Sample Customer", "sample@example.com", "01712345678", "123 Sample Road", "Sample Area", "Dhaka", "1205", "Sample USB-C Cable", "Quantity: 1", "Unit price: BDT 499.00", "Line total: BDT 499.00", "Subtotal: BDT 499.00", "Delivery: BDT 80.00", "Grand total: BDT 579.00", "Synthetic delivery notes", "Pending / Unpaid", "awaiting manual confirmation/payment", CommerceApiFactory.Origin + "/admin/orders/" + orderId }) Assert.Contains(required, text);
            Assert.Equal(orderId, payload.OrderId); Assert.Equal(OwnerNotificationTestSettings.ChatId, payload.ChatId);
            Assert.All(payload.Parts, part => Assert.InRange(part.Length, 1, OwnerOrderNotifications.MessageLimit - 1));
            Assert.Throws<CryptographicException>(() => notifications.Read(emailRow.ProtectedPayload));
        }
        var rotated = OwnerNotificationTestSettings.Configuration(); rotated["Telegram:OwnerChatId"] = (OwnerNotificationTestSettings.ChatId - 1).ToString(CultureInfo.InvariantCulture);
        rotated["Telegram:BotToken"] = "9876543210:synthetic_rotated_owner_token_123456789"; rotated["Storefront:Origin"] = "https://changed.example.com";
        var restartedBuilder = new OwnerOrderNotifications(protection, OwnerNotificationSettings.Read(rotated), rotated);
        var unchanged = restartedBuilder.Read(original.ProtectedPayload); Assert.Equal(payload.ChatId, unchanged.ChatId); Assert.Equal(payload.Parts, unchanged.Parts);
        await using var restarted = new ApplicationDbContext(options);
        await restarted.Quotes.Where(quote => quote.Id == request.QuoteId).ExecuteUpdateAsync(setters => setters.SetProperty(quote => quote.ExpiresAt, DateTime.UtcNow.AddHours(-1)));
        var recovery = new CommerceRepository(restarted, mail, restartedBuilder);
        var recovered = await recovery.Attempt(owner.Key, key, default); Assert.NotNull(recovered); Assert.Equal(orderId, recovered.Id);
        var replay = await recovery.Accept(owner, key, request, default); Assert.Equal(orderId, replay.Id);
        Assert.NotNull(await recovery.Find(orderId, default)); Assert.Null(await recovery.Attempt("g:" + CommerceRepository.Hash("stranger"), key, default));
        var retained = await restarted.OwnerOrderNotifications.AsNoTracking().SingleAsync(); Assert.Equal(original.Id, retained.Id); Assert.Equal(original.ProtectedPayload, retained.ProtectedPayload);
        Assert.Equal(0, retained.Attempts); Assert.Equal(0, retained.CurrentPart); Assert.Null(retained.CompletedAt); Assert.Null(retained.FailedAt);
        Assert.Equal(1, await restarted.Orders.CountAsync()); Assert.Equal(1, await restarted.CommandReceipts.CountAsync()); Assert.Equal(1, await restarted.EmailOutbox.CountAsync()); Assert.Equal(1, await restarted.GuestCapabilities.CountAsync());
        Assert.Equal(49, await restarted.Products.Where(product => product.Slug == "sample-usb-c-cable").Select(product => product.Stock).SingleAsync());
        var publicReceipt = JsonSerializer.Serialize(replay); Assert.DoesNotContain(OwnerNotificationTestSettings.BotToken, publicReceipt); Assert.DoesNotContain(OwnerNotificationTestSettings.ChatId.ToString(CultureInfo.InvariantCulture), publicReceipt);
    }

    [MySqlFact]
    public async Task Additive_notification_migration_preserves_existing_commerce_data_without_historical_backfill()
    {
        await using var database = await IsolatedDatabase.Create();
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options;
        await using var db = new ApplicationDbContext(options); var migrator = db.GetService<IMigrator>();
        const string initial = "20261022123955_OracleCommerceInitial";
        var notificationMigration = Assert.Single(db.Database.GetMigrations(), migration => migration.EndsWith("_OwnerOrderNotifications", StringComparison.Ordinal));
        await migrator.MigrateAsync(initial); await DevelopmentSeed.Seed(db);
        Assert.Equal(new[] { initial }, await db.Database.GetAppliedMigrationsAsync());
        var configuration = OwnerNotificationTestSettings.Configuration(enabled: false); var protection = new EphemeralDataProtectionProvider();
        var mail = new CommerceMail(protection, configuration); var disabled = new OwnerOrderNotifications(protection, OwnerNotificationSettings.Read(configuration), configuration);
        var commerce = new CommerceRepository(db, mail, disabled); var owner = new CommerceOwner("g:" + CommerceRepository.Hash("historical-order"), null, null);
        const string key = "historical-order-key-123456789";
        var productId = Guid.Parse("00000000-0000-4000-8000-000000000013");
        var quote = await commerce.Quote(owner, new([new(productId, 1)]), default);
        var request = new AcceptOrderRequest(quote.QuoteId, new() { Name = "Sample Historical Customer", Email = "historical@example.com", Phone = "01712345678" }, new() { Street = "123 Historical Road", Area = "Sample Area", City = "Dhaka", District = "Dhaka", Postcode = "1205" }, "Historical delivery note");
        var historical = await commerce.Accept(owner, key, request, default);
        db.GuestGrants.Add(new() { OrderId = historical.Id, TokenHash = CommerceRepository.Hash("synthetic-historical-grant"), ExpiresAt = DateTime.UtcNow.AddHours(1) }); await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        var beforeOrder = JsonSerializer.Serialize(CommerceRepository.Map((await commerce.Find(historical.Id, default))!, true));
        var beforeProducts = JsonSerializer.Serialize(await db.Products.AsNoTracking().OrderBy(product => product.Id).Select(product => new { product.Id, product.Slug, product.Name, product.Price, product.Stock, product.Version }).ToArrayAsync());
        var beforeEmail = JsonSerializer.Serialize(await db.EmailOutbox.AsNoTracking().SingleAsync());
        var beforeCapability = JsonSerializer.Serialize(await db.GuestCapabilities.AsNoTracking().SingleAsync());
        var beforeGrant = JsonSerializer.Serialize(await db.GuestGrants.AsNoTracking().SingleAsync());
        var beforeReceipt = JsonSerializer.Serialize(await db.CommandReceipts.AsNoTracking().SingleAsync());
        var beforeQuote = JsonSerializer.Serialize(await db.Quotes.AsNoTracking().Include(value => value.Lines).SingleAsync());
        await migrator.MigrateAsync(notificationMigration); db.ChangeTracker.Clear();
        Assert.Contains(notificationMigration, await db.Database.GetAppliedMigrationsAsync()); Assert.Equal(0, await db.OwnerOrderNotifications.CountAsync());
        Assert.Equal(beforeOrder, JsonSerializer.Serialize(CommerceRepository.Map((await commerce.Find(historical.Id, default))!, true)));
        Assert.Equal(beforeProducts, JsonSerializer.Serialize(await db.Products.AsNoTracking().OrderBy(product => product.Id).Select(product => new { product.Id, product.Slug, product.Name, product.Price, product.Stock, product.Version }).ToArrayAsync()));
        Assert.Equal(beforeEmail, JsonSerializer.Serialize(await db.EmailOutbox.AsNoTracking().SingleAsync()));
        Assert.Equal(beforeCapability, JsonSerializer.Serialize(await db.GuestCapabilities.AsNoTracking().SingleAsync()));
        Assert.Equal(beforeGrant, JsonSerializer.Serialize(await db.GuestGrants.AsNoTracking().SingleAsync()));
        Assert.Equal(beforeReceipt, JsonSerializer.Serialize(await db.CommandReceipts.AsNoTracking().SingleAsync()));
        Assert.Equal(beforeQuote, JsonSerializer.Serialize(await db.Quotes.AsNoTracking().Include(value => value.Lines).SingleAsync()));
        Assert.Equal(8, await db.Categories.CountAsync()); Assert.Equal(17, await db.Products.CountAsync()); Assert.Equal(1, await db.Orders.CountAsync());
        var enabled = new CommerceRepository(db, mail, OwnerNotificationTestSettings.Builder(protection));
        Assert.Equal(historical.Id, (await enabled.Accept(owner, key, request, default)).Id); Assert.Equal(0, await db.OwnerOrderNotifications.CountAsync());
        var newOwner = new CommerceOwner("g:" + CommerceRepository.Hash("post-migration-order"), null, null);
        var newQuote = await enabled.Quote(newOwner, new([new(productId, 1)]), default);
        var accepted = await enabled.Accept(newOwner, "post-migration-key-123456789", request with { QuoteId = newQuote.QuoteId }, default);
        var notification = await db.OwnerOrderNotifications.AsNoTracking().SingleAsync(); Assert.Equal(accepted.Id, notification.OrderId); Assert.NotEqual(historical.Id, notification.OrderId);
        Assert.Equal(2, await db.Orders.CountAsync()); Assert.Equal(48, await db.Products.Where(product => product.Id == productId).Select(product => product.Stock).SingleAsync());
        await migrator.MigrateAsync(); Assert.Equal(notification.ProtectedPayload, (await db.OwnerOrderNotifications.AsNoTracking().SingleAsync()).ProtectedPayload);
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
        public bool ReachedNotificationSave { get; private set; }
        public bool ReachedMailAndCapabilitySave { get; private set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<Order>().Any(e => e.State == EntityState.Added))
            {
                ReachedOrderSave = true;
                ReachedNotificationSave = eventData.Context.ChangeTracker.Entries<OwnerOrderNotification>().Count(entry => entry.State == EntityState.Added) == 1;
                ReachedMailAndCapabilitySave = eventData.Context.ChangeTracker.Entries<EmailOutbox>().Any(entry => entry.State == EntityState.Added) && eventData.Context.ChangeTracker.Entries<GuestCapability>().Any(entry => entry.State == EntityState.Added);
                throw new InvalidOperationException("Injected rollback verification failure.");
            }
            return ValueTask.FromResult(result);
        }
    }

    private sealed class FailAfterBuildingNotification(OwnerOrderNotifications builder) : IOwnerOrderNotifications
    {
        public OwnerOrderNotification? BuiltNotification { get; private set; }
        public OwnerOrderNotification? Create(Order order)
        {
            BuiltNotification = builder.Create(order); throw new InvalidOperationException("Injected owner notification enqueue failure.");
        }
    }

    private sealed class InvalidateNotificationAtSave : SaveChangesInterceptor
    {
        public bool ReachedNotificationSave { get; private set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var db = (ApplicationDbContext)eventData.Context!;
            var notification = db.ChangeTracker.Entries<OwnerOrderNotification>().SingleOrDefault(entry => entry.State == EntityState.Added)?.Entity;
            if (notification is not null)
            {
                ReachedNotificationSave = true;
                notification.PartCount = 0;
            }
            return ValueTask.FromResult(result);
        }
    }
}
