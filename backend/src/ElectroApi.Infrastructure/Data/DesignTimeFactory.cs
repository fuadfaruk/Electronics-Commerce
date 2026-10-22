using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace ElectroApi.Infrastructure.Data;

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<ApplicationDbContext>
{
    public ApplicationDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("Set ConnectionStrings__DefaultConnection to the explicitly selected database before running EF commands.");
        return new(new DbContextOptionsBuilder<ApplicationDbContext>().UseMySQL(connection).Options);
    }
}
