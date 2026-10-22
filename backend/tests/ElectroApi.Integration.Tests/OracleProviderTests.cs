using ElectroApi.Core.Entities;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace ElectroApi.Integration.Tests;

public sealed class OracleProviderTests
{
    [MySqlFact]
    public async Task Existing_catalog_guid_decimal_and_ordered_dependents_round_trip()
    {
        await using var database = await IsolatedDatabase.Create();
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(database.ConnectionString).Options;
        await using var context = new ApplicationDbContext(options);
        await context.Database.EnsureCreatedAsync();
        var id = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var category = new Category { Slug = "sample", Name = "Sample category" };
        context.Categories.Add(category);
        context.Products.Add(new Product
        {
            Id = id, Slug = "provider-probe", Name = "Sample provider probe", CategoryId = category.Id,
            Price = 5000.00m, CompareAtPrice = 6000.00m, Stock = 2,
            Images = [new() { Url = "https://example.com/second.jpg", Order = 1 }, new() { Url = "https://example.com/first.jpg", Order = 0 }],
            Specifications = [new() { Label = "Storage", Value = "128 GB" }]
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var product = await context.Products.Include(p => p.Images).Include(p => p.Specifications).SingleAsync(p => p.Id == id);
        Assert.Equal(5000.00m, product.Price);
        Assert.Equal(6000.00m, product.CompareAtPrice);
        Assert.Equal("https://example.com/first.jpg", product.Images.OrderBy(i => i.Order).First().Url);
        Assert.Single(product.Specifications);
        Assert.Equal(1, await context.Products.Where(p => p.Id == id && p.Stock >= 1).ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, p => p.Stock - 1).SetProperty(p => p.Version, p => p.Version + 1)));
        Assert.Equal(1, await context.Products.Where(p => p.Id == id).Select(p => p.Stock).SingleAsync());
    }

    [MySqlFact]
    public async Task Identity_unique_indexes_and_owned_money_contact_and_dates_round_trip()
    {
        await using var database = await IsolatedDatabase.Create();
        var options = new DbContextOptionsBuilder<ProbeContext>().UseMySQL(database.ConnectionString).Options;
        await using var context = new ProbeContext(options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        context.Users.Add(new ProbeUser { Id = userId, UserName = "probe@example.com", NormalizedUserName = "PROBE@EXAMPLE.COM", Email = "probe@example.com", NormalizedEmail = "PROBE@EXAMPLE.COM", EmailConfirmed = true });
        var created = new DateTime(2026, 10, 22, 11, 0, 0, DateTimeKind.Utc);
        var row = new ProbeOrder { Id = Guid.NewGuid(), AccountId = userId, CreatedAt = created, Contact = new ProbeContact("Sample Customer", "probe@example.com"), Money = new ProbeMoney(5000.00m, 0.00m, 5000.00m) };
        context.Probes.Add(row);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var stored = await context.Probes.SingleAsync(p => p.Id == row.Id);
        Assert.Equal(userId, stored.AccountId);
        Assert.Equal(created, stored.CreatedAt);
        Assert.Equal(5000.00m, stored.Money.Total);
        Assert.Equal("probe@example.com", stored.Contact.Email);
        context.Users.Add(new ProbeUser { Id = Guid.NewGuid(), UserName = "other", NormalizedUserName = "OTHER", Email = "probe@example.com", NormalizedEmail = "PROBE@EXAMPLE.COM" });
        var exception = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        Assert.Equal(1062, Assert.IsType<MySqlException>(exception.InnerException).Number);
    }

    [MySqlFact]
    public async Task For_update_locks_and_conditional_row_counts_prevent_last_unit_oversell()
    {
        await using var database = await IsolatedDatabase.Create();
        await using var setup = new MySqlConnection(database.ConnectionString);
        await setup.OpenAsync();
        await new MySqlCommand("CREATE TABLE StockProbe (Id CHAR(36) PRIMARY KEY, Stock INT NOT NULL, Version BIGINT NOT NULL) ENGINE=InnoDB; INSERT INTO StockProbe VALUES ('00000000-0000-0000-0000-000000000001', 1, 1);", setup).ExecuteNonQueryAsync();
        async Task<int> Buy()
        {
            await using var connection = new MySqlConnection(database.ConnectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await new MySqlCommand("SELECT Id FROM StockProbe WHERE Id = '00000000-0000-0000-0000-000000000001' FOR UPDATE", connection, transaction).ExecuteScalarAsync();
            var affected = await new MySqlCommand("UPDATE StockProbe SET Stock = Stock - 1, Version = Version + 1 WHERE Id = '00000000-0000-0000-0000-000000000001' AND Stock >= 1", connection, transaction).ExecuteNonQueryAsync();
            await transaction.CommitAsync();
            return affected;
        }
        var results = await Task.WhenAll(Buy(), Buy());
        Assert.Equal(1, results.Sum());
        Assert.Equal(0L, Convert.ToInt64(await new MySqlCommand("SELECT Stock FROM StockProbe", setup).ExecuteScalarAsync()));
        Assert.Equal(2L, Convert.ToInt64(await new MySqlCommand("SELECT Version FROM StockProbe", setup).ExecuteScalarAsync()));
    }

    private sealed class ProbeUser : IdentityUser<Guid>;
    private sealed record ProbeContact(string Name, string Email);
    private sealed record ProbeMoney(decimal Subtotal, decimal Delivery, decimal Total);
    private sealed class ProbeOrder
    {
        public Guid Id { get; set; }
        public Guid? AccountId { get; set; }
        public DateTime CreatedAt { get; set; }
        public ProbeContact Contact { get; set; } = new("", "");
        public ProbeMoney Money { get; set; } = new(0, 0, 0);
    }
    private sealed class ProbeContext(DbContextOptions<ProbeContext> options) : IdentityDbContext<ProbeUser, IdentityRole<Guid>, Guid>(options)
    {
        public DbSet<ProbeOrder> Probes => Set<ProbeOrder>();
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<ProbeUser>().HasIndex(u => u.NormalizedEmail).IsUnique();
            builder.Entity<ProbeOrder>().HasOne<ProbeUser>().WithMany().HasForeignKey(p => p.AccountId).OnDelete(DeleteBehavior.Restrict);
            builder.Entity<ProbeOrder>().OwnsOne(p => p.Contact, contact => { contact.Property(p => p.Name).HasMaxLength(100); contact.Property(p => p.Email).HasMaxLength(254); });
            builder.Entity<ProbeOrder>().OwnsOne(p => p.Money, money => { money.Property(p => p.Subtotal).HasPrecision(18, 2); money.Property(p => p.Delivery).HasPrecision(18, 2); money.Property(p => p.Total).HasPrecision(18, 2); });
        }
    }
}

internal sealed class IsolatedDatabase : IAsyncDisposable
{
    private readonly string _adminConnection;
    private readonly string _name;
    public string ConnectionString { get; }
    private IsolatedDatabase(string adminConnection, string name)
    {
        _adminConnection = adminConnection;
        _name = name;
        ConnectionString = new MySqlConnectionStringBuilder(adminConnection) { Database = name }.ConnectionString;
    }
    public static async Task<IsolatedDatabase> Create()
    {
        var connectionString = Environment.GetEnvironmentVariable("ELECTROMART_TEST_MYSQL") ?? throw new InvalidOperationException("An explicitly isolated test server is required.");
        var builder = new MySqlConnectionStringBuilder(connectionString) { Database = "" };
        var database = new IsolatedDatabase(builder.ConnectionString, "electromart_test_" + Guid.NewGuid().ToString("N"));
        await using var connection = new MySqlConnection(builder.ConnectionString);
        await connection.OpenAsync();
        var version = Convert.ToString(await new MySqlCommand("SELECT VERSION()", connection).ExecuteScalarAsync());
        Assert.StartsWith("8.4.", version);
        await new MySqlCommand($"CREATE DATABASE `{database._name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci", connection).ExecuteNonQueryAsync();
        return database;
    }
    public async ValueTask DisposeAsync()
    {
        if (!_name.StartsWith("electromart_test_", StringComparison.Ordinal)) throw new InvalidOperationException("Refusing non-test database cleanup.");
        MySqlConnection.ClearAllPools();
        await using var connection = new MySqlConnection(_adminConnection);
        await connection.OpenAsync();
        await new MySqlCommand($"DROP DATABASE `{_name}`", connection).ExecuteNonQueryAsync();
    }
}
