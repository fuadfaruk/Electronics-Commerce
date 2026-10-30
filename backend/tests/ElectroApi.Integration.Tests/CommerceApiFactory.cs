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

internal sealed class CommerceApiFactory(string connectionString, string keyPath, bool mailEnabled = false, string environment = "Development", IReadOnlyDictionary<string, string?>? overrides = null) : WebApplicationFactory<Program>
{
    public const string Origin = "https://localhost:3000";
    public static IReadOnlyDictionary<string, string?> FullFeatures => new Dictionary<string, string?> { ["Commerce:GuestOnly"] = "false", ["Mail:Enabled"] = "true" };
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            var settings = new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = connectionString,
                ["Storefront:Origin"] = Origin,
                ["Security:KeyPath"] = keyPath,
                ["Security:DevelopmentHttps"] = "true",
                ["Mail:Enabled"] = mailEnabled ? "true" : "false",
                ["Mail:Host"] = mailEnabled ? "127.0.0.1" : "",
                ["Mail:Port"] = "1025",
                ["Mail:EnableSsl"] = "false",
                ["Logging:LogLevel:Default"] = "Warning",
                ["Commerce:CheckoutEnabled"] = "true",
                ["Mail:Sender"] = "development@example.com",
                ["OwnerNotifications:Enabled"] = "false",
                ["Telegram:BotToken"] = "",
                ["Telegram:OwnerChatId"] = ""
            };
            foreach (var item in overrides ?? new Dictionary<string, string?>()) settings[item.Key] = item.Value;
            configuration.AddInMemoryCollection(settings);
        });
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
            var response = await client.GetAsync("/api/v1/Security/csrf");
            if (!response.IsSuccessStatusCode) return response;
            using (response) token = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        }
        using var request = new HttpRequestMessage(new HttpMethod(method), "/api/v1/" + path) { Content = JsonContent.Create(body) };
        if (origin is not null) request.Headers.TryAddWithoutValidation("Origin", origin);
        request.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "same-origin");
        if (token is not null) request.Headers.Add("X-CSRF-Token", token);
        if (key is not null) request.Headers.Add("Idempotency-Key", key);
        return await client.SendAsync(request);
    }
}
