using ElectroApi.Core;
using ElectroApi.Core.Entities;
using ElectroApi.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ElectroApi.Infrastructure.Data;

public sealed class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Quote> Quotes => Set<Quote>();
    public DbSet<CommandReceipt> CommandReceipts => Set<CommandReceipt>();
    public DbSet<StockAdjustment> StockAdjustments => Set<StockAdjustment>();
    public DbSet<GuestCapability> GuestCapabilities => Set<GuestCapability>();
    public DbSet<GuestGrant> GuestGrants => Set<GuestGrant>();
    public DbSet<OrderClaim> OrderClaims => Set<OrderClaim>();
    public DbSet<EmailOutbox> EmailOutbox => Set<EmailOutbox>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        builder.Properties<decimal>().HavePrecision(18, 2);
        builder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>().HaveColumnType("datetime(6)");
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<ApplicationUser>().Property(u => u.Name).HasMaxLength(100);
        builder.Entity<ApplicationUser>().HasIndex(u => u.NormalizedEmail).IsUnique();
        builder.Entity<Category>(category =>
        {
            category.Property(c => c.Slug).HasMaxLength(160);
            category.HasIndex(c => c.Slug).IsUnique();
            category.Property(c => c.Name).HasMaxLength(100);
            category.Property(c => c.Description).HasMaxLength(500);
            category.Property(c => c.VisualKey).HasMaxLength(30);
            category.Property(c => c.Version).IsConcurrencyToken();
        });
        builder.Entity<Product>(product =>
        {
            product.Property(p => p.Slug).HasMaxLength(160);
            product.HasIndex(p => p.Slug).IsUnique();
            product.Property(p => p.Name).HasMaxLength(200);
            product.Property(p => p.Brand).HasMaxLength(100);
            product.Property(p => p.Description).HasMaxLength(5000);
            product.Property(p => p.Version).IsConcurrencyToken();
            product.HasOne(p => p.Category).WithMany(c => c.Products).HasForeignKey(p => p.CategoryId).OnDelete(DeleteBehavior.Restrict);
            product.HasMany(p => p.Images).WithOne().HasForeignKey(i => i.ProductId).OnDelete(DeleteBehavior.Cascade);
            product.HasMany(p => p.Specifications).WithOne().HasForeignKey(s => s.ProductId).OnDelete(DeleteBehavior.Cascade);
            product.HasIndex(p => new { p.IsArchived, p.CategoryId, p.Price, p.Id });
            product.ToTable("Products", table =>
            {
                table.HasCheckConstraint("CK_Product_Stock", "Stock >= 0 AND Stock <= 1000000");
                table.HasCheckConstraint("CK_Product_Price", "Price > 0 AND Price = TRUNCATE(Price, 0) AND (CompareAtPrice IS NULL OR (CompareAtPrice > Price AND CompareAtPrice = TRUNCATE(CompareAtPrice, 0)))");
            });
        });
        builder.Entity<ProductImage>().Property(i => i.Url).HasMaxLength(2000);
        builder.Entity<ProductImage>().HasIndex(i => new { i.ProductId, i.Order }).IsUnique();
        builder.Entity<ProductSpecification>().Property(s => s.Label).HasMaxLength(100);
        builder.Entity<ProductSpecification>().Property(s => s.Value).HasMaxLength(500);
        builder.Entity<ProductSpecification>().HasIndex(s => new { s.ProductId, s.Order }).IsUnique();
        builder.Entity<Order>(order =>
        {
            order.Property(o => o.Number).HasMaxLength(40);
            order.HasIndex(o => o.Number).IsUnique();
            order.Property(o => o.CheckoutOwner).HasMaxLength(80);
            order.Property(o => o.NormalizedEmail).HasMaxLength(254);
            order.Property(o => o.Notes).HasMaxLength(500);
            order.Property(o => o.Fulfillment).HasConversion<string>().HasMaxLength(20);
            order.Property(o => o.Payment).HasConversion<string>().HasMaxLength(20);
            order.Property(o => o.Version).IsConcurrencyToken();
            order.HasOne<ApplicationUser>().WithMany().HasForeignKey(o => o.AccountId).OnDelete(DeleteBehavior.Restrict);
            order.HasOne<Quote>().WithOne().HasForeignKey<Order>(o => o.QuoteId).OnDelete(DeleteBehavior.Restrict);
            order.HasIndex(o => new { o.AccountId, o.CreatedAt, o.Id });
            order.OwnsOne(o => o.Contact, contact =>
            {
                contact.Property(c => c.Name).HasMaxLength(100);
                contact.Property(c => c.Email).HasMaxLength(254);
                contact.Property(c => c.Phone).HasMaxLength(20);
            });
            order.OwnsOne(o => o.DeliveryAddress, address =>
            {
                address.Property(a => a.Street).HasMaxLength(300);
                address.Property(a => a.Area).HasMaxLength(100);
                address.Property(a => a.City).HasMaxLength(100);
                address.Property(a => a.District).HasMaxLength(100);
                address.Property(a => a.Postcode).HasMaxLength(4);
            });
            order.OwnsOne(o => o.Money, Money);
            order.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.OrderId).OnDelete(DeleteBehavior.Cascade);
            order.HasMany(o => o.Events).WithOne().HasForeignKey(e => e.OrderId).OnDelete(DeleteBehavior.Cascade);
        });
        builder.Entity<OrderLine>(line =>
        {
            line.Property(l => l.Name).HasMaxLength(200); line.Property(l => l.Slug).HasMaxLength(160);
            line.HasOne<Product>().WithMany().HasForeignKey(l => l.ProductId).OnDelete(DeleteBehavior.Restrict);
            line.HasIndex(l => new { l.OrderId, l.ProductId }).IsUnique();
            line.ToTable("OrderLines", table => table.HasCheckConstraint("CK_OrderLine_Quantity", "Quantity > 0 AND Quantity <= 99 AND UnitPrice > 0 AND LineTotal = UnitPrice * Quantity"));
        });
        builder.Entity<OrderEvent>().Property(e => e.Action).HasMaxLength(50);
        builder.Entity<OrderEvent>().Property(e => e.Note).HasMaxLength(500);
        builder.Entity<Quote>().Property(q => q.OwnerKey).HasMaxLength(80);
        builder.Entity<Quote>().OwnsOne(q => q.Money, Money);
        builder.Entity<Quote>().HasMany(q => q.Lines).WithOne().HasForeignKey(l => l.QuoteId).OnDelete(DeleteBehavior.Cascade);
        builder.Entity<QuoteLine>().HasOne<Product>().WithMany().HasForeignKey(l => l.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<QuoteLine>().HasIndex(l => new { l.QuoteId, l.ProductId }).IsUnique();
        builder.Entity<CommandReceipt>(receipt =>
        {
            receipt.Property(r => r.Id).HasMaxLength(64);
            receipt.Property(r => r.OwnerKey).HasMaxLength(80);
            receipt.Property(r => r.Operation).HasMaxLength(80);
            receipt.Property(r => r.KeyHash).HasMaxLength(64);
            receipt.Property(r => r.PayloadHash).HasMaxLength(64);
            receipt.Property(r => r.ResultJson).HasColumnType("longtext");
            receipt.HasIndex(r => new { r.OwnerKey, r.Operation, r.KeyHash }).IsUnique();
            receipt.HasOne<Order>().WithMany().HasForeignKey(r => r.OrderId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<StockAdjustment>().Property(s => s.Reason).HasMaxLength(500);
        builder.Entity<StockAdjustment>().HasOne<Product>().WithMany().HasForeignKey(s => s.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<GuestCapability>().Property(g => g.TokenHash).HasMaxLength(64);
        builder.Entity<GuestCapability>().HasIndex(g => g.TokenHash).IsUnique();
        builder.Entity<GuestCapability>().HasOne<Order>().WithMany().HasForeignKey(g => g.OrderId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<GuestGrant>().Property(g => g.TokenHash).HasMaxLength(64);
        builder.Entity<GuestGrant>().HasIndex(g => g.TokenHash).IsUnique();
        builder.Entity<GuestGrant>().HasOne<Order>().WithMany().HasForeignKey(g => g.OrderId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<OrderClaim>().Property(c => c.TokenHash).HasMaxLength(64);
        builder.Entity<OrderClaim>().HasOne<Order>().WithMany().HasForeignKey(c => c.OrderId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<OrderClaim>().HasOne<ApplicationUser>().WithMany().HasForeignKey(c => c.AccountId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<EmailOutbox>().Property(e => e.ProtectedPayload).HasColumnType("longtext");
        builder.Entity<EmailOutbox>().HasIndex(e => new { e.SentAt, e.NextAttemptAt, e.LeaseUntil });
    }

    private static void Money<TOwner>(OwnedNavigationBuilder<TOwner, MoneySnapshot> money) where TOwner : class
    {
        money.Property(m => m.Currency).HasMaxLength(3);
        money.Property(m => m.PolicyVersion).HasMaxLength(30);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess) { ValidateChanges(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) { ValidateChanges(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken); }
    private void ValidateChanges()
    {
        ChangeTracker.DetectChanges();
        foreach (var entry in ChangeTracker.Entries<Product>().Where(e => e.State is EntityState.Added or EntityState.Modified))
        {
            CommerceRules.WholePrice(entry.Entity.Price);
            if (entry.Entity.CompareAtPrice is { } compare) { CommerceRules.WholePrice(compare); CommerceRules.Require(compare > entry.Entity.Price, "invalid_compare_price", "Compare price must exceed sale price."); }
            CommerceRules.Require(entry.Entity.Stock is >= 0 and <= 1000000, "invalid_stock", "Stock is outside the permitted range.");
            if (entry.State == EntityState.Modified && entry.Property(p => p.Slug).IsModified) throw new CommerceException(409, "immutable_slug", "Product slugs cannot change.");
        }
        foreach (var entry in ChangeTracker.Entries<Category>().Where(e => e.State == EntityState.Modified))
            if (entry.Property(c => c.Slug).IsModified) throw new CommerceException(409, "immutable_slug", "Category slugs cannot change.");
        foreach (var entry in ChangeTracker.Entries().Where(e => e.State is EntityState.Modified or EntityState.Deleted))
            if (entry.Entity is OrderLine or ContactSnapshot or AddressSnapshot or MoneySnapshot)
                throw new CommerceException(409, "immutable_snapshot", "Accepted order snapshots cannot change.");
    }
}

public sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(value => value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime(), value => DateTime.SpecifyKind(value, DateTimeKind.Utc));
