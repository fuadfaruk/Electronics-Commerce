using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ElectroApi.Infrastructure.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ElectroApi.Integration.Tests;

internal sealed class CommerceApiFactory(string connectionString, string keyPath) : WebApplicationFactory<Program>
{
    public const string Origin = "https://localhost:3000";
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = connectionString,
            ["Storefront:Origin"] = Origin,
            ["Security:KeyPath"] = keyPath,
            ["Security:DevelopmentHttps"] = "true",
            ["Mail:Host"] = "",
            ["Mail:Sender"] = "development@example.com"
        }));
    }
    public async Task InitializeDatabase()
    {
        using var scope = Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        await db.Database.MigrateAsync(); await DevelopmentSeed.Seed(db);
    }
    public HttpClient Browser(bool cookies = true) => CreateClient(new() { BaseAddress = new Uri(Origin), AllowAutoRedirect = false, HandleCookies = cookies });
    public static async Task<HttpResponseMessage> Send(HttpClient client, string path, object body, string? key = null, bool csrf = true, string? origin = Origin, string method = "POST")
    {
        string? token = null;
        if (csrf)
        {
            using var response = await client.GetAsync("/api/v1/Security/csrf");
            if (!response.IsSuccessStatusCode) return response;
            token = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        }
        using var request = new HttpRequestMessage(new HttpMethod(method), "/api/v1/" + path) { Content = JsonContent.Create(body) };
        if (origin is not null) request.Headers.TryAddWithoutValidation("Origin", origin);
        request.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "same-origin");
        if (token is not null) request.Headers.Add("X-CSRF-Token", token);
        if (key is not null) request.Headers.Add("Idempotency-Key", key);
        return await client.SendAsync(request);
    }
}
