using electroapi.core.Entities;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Infrastructure.Data
{
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options)
        {
        }

        public DbSet<Order> Orders { get; set; }
        public DbSet<Product> Products { get; set; }
        public DbSet<ProductImage> ProductImages { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<Product>(entity =>
            {
                entity.HasKey(p => p.ProductId);

                entity.OwnsMany(p => p.ProductSpecs, a =>
                {
                    a.WithOwner().HasForeignKey("ProductId");
                    a.Property<Guid>("Id");
                    a.HasKey("Id");
                    a.Property(ps => ps.SpecName).HasColumnName("SpecName").IsRequired();
                    a.Property(ps => ps.SpecValue).HasColumnName("SpecValue");
                    a.ToTable("ProductSpecs");
                });
            });
        }
    }
}
