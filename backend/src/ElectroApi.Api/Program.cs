using ElectroApi.Api.ExceptionHandling;
using ElectroApi.Core.Interfaces.Repositories;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using System.Data.Common;

public partial class Program
{
    private static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add Database Configuration
        var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
        var serverVersion = ServerVersion.Parse(builder.Configuration["Database:ServerVersion"] ?? "8.0.0");

        builder.Services
            .AddDbContext<ApplicationDbContext>(options =>
                options.UseMySql(
                    connectionString,
                    serverVersion,
                    b => b.MigrationsAssembly("ElectroApi.Infrastructure")
                )
                //.UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking) // Optional: for read-heavy scenarios
            );

        builder.Services.AddScoped<IOrderRepository, OrderRepository>();
        builder.Services.AddScoped<IProductRepository, ProductRepository>();

        builder.Services.AddControllers();
        builder.Services.AddProblemDetails();
        builder.Services.AddExceptionHandler<DatabaseExceptionHandler>();
        // Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
        builder.Services.AddOpenApi();

        var app = builder.Build();

        // Configure the HTTP request pipeline.
        app.UseExceptionHandler();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
            app.MapScalarApiReference();
        }

        app.MapGet("/", () => "Hello World!");
        app.MapGet("/health/database", async (
            ApplicationDbContext dbContext,
            ILogger<Program> logger,
            CancellationToken cancellationToken) =>
        {
            try
            {
                if (await dbContext.Database.CanConnectAsync(cancellationToken))
                {
                    return Results.Ok(new { status = "Healthy" });
                }
            }
            catch (DbException)
            {
            }

            logger.LogWarning("Database health check failed; database connection is unavailable.");
            return Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Database unavailable",
                detail: "The database is currently unavailable. Please try again later.");
        });
        //app.UseHttpsRedirection();

        app.UseAuthorization();

        app.MapControllers();

        app.Run();
    }
}