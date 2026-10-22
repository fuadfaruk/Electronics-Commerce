using System.Net;
using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using ElectroApi.Api.ExceptionHandling;
using ElectroApi.Api.Security;
using ElectroApi.Core;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Identity;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;
using Scalar.AspNetCore;
using Microsoft.Extensions.Logging.Abstractions;

public partial class Program
{
    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var configuration = builder.Configuration;
        builder.Services.AddDataProtection().SetApplicationName("ElectroMart.Commerce.v1");
        builder.Services.AddOptions<Microsoft.AspNetCore.DataProtection.KeyManagement.KeyManagementOptions>().Configure<IConfiguration>((options, current) => options.XmlRepository = new FileSystemXmlRepository(new DirectoryInfo(current["Security:KeyPath"]!), NullLoggerFactory.Instance));
        builder.Services.AddOptions<Microsoft.AspNetCore.DataProtection.KeyManagement.KeyManagementOptions>().Configure<IConfiguration>((options, current) =>
        {
            var thumbprint = current["Security:KeyCertificateThumbprint"];
            if (string.IsNullOrWhiteSpace(thumbprint)) return;
            using var store = new System.Security.Cryptography.X509Certificates.X509Store(System.Security.Cryptography.X509Certificates.StoreName.My, System.Security.Cryptography.X509Certificates.StoreLocation.LocalMachine);
            store.Open(System.Security.Cryptography.X509Certificates.OpenFlags.ReadOnly);
            var certificate = store.Certificates.Find(System.Security.Cryptography.X509Certificates.X509FindType.FindByThumbprint, thumbprint, true).OfType<System.Security.Cryptography.X509Certificates.X509Certificate2>().SingleOrDefault(c => c.HasPrivateKey) ?? throw new InvalidOperationException("Data Protection certificate with private key not available to the application identity.");
            options.XmlEncryptor = new Microsoft.AspNetCore.DataProtection.XmlEncryption.CertificateXmlEncryptor(certificate, NullLoggerFactory.Instance);
        });
        builder.Services.AddDbContext<ApplicationDbContext>(options => options.UseMySQL(configuration.GetConnectionString("DefaultConnection")!));
        builder.Services.AddScoped<ICatalogRepository, CatalogRepository>();
        builder.Services.AddScoped<ICommerceRepository, CommerceRepository>();
        builder.Services.AddScoped<OrderAccess>();
        builder.Services.AddScoped<CommerceMail>();
        builder.Services.AddScoped<ICommerceMail>(services => services.GetRequiredService<CommerceMail>());
        builder.Services.AddHostedService<MailOutboxWorker>();
        builder.Services.AddScoped<CommerceSecurity>();
        builder.Services.AddIdentity<ApplicationUser, IdentityRole<Guid>>(options =>
        {
            options.User.RequireUniqueEmail = true;
            options.SignIn.RequireConfirmedEmail = true;
            options.Password.RequiredLength = 10;
            options.Password.RequireDigit = true; options.Password.RequireUppercase = true; options.Password.RequireLowercase = true; options.Password.RequireNonAlphanumeric = true;
            options.Lockout.MaxFailedAccessAttempts = 5; options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        }).AddEntityFrameworkStores<ApplicationDbContext>().AddDefaultTokenProviders();
        builder.Services.Configure<DataProtectionTokenProviderOptions>(options => options.TokenLifespan = TimeSpan.FromHours(1));
        builder.Services.ConfigureApplicationCookie(options =>
        {
            var secureCookies = !builder.Environment.IsDevelopment() || configuration.GetValue("Security:DevelopmentHttps", false);
            options.Cookie.Name = CommerceSecurity.AuthCookie;
            options.Cookie.HttpOnly = true; options.Cookie.SameSite = SameSiteMode.Lax; options.Cookie.Path = "/"; options.Cookie.Domain = null;
            options.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.None;
            options.ExpireTimeSpan = TimeSpan.FromHours(8); options.SlidingExpiration = false;
            options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
            options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
            options.Events.OnValidatePrincipal = async context =>
            {
                var manager = context.HttpContext.RequestServices.GetRequiredService<UserManager<ApplicationUser>>();
                var user = await manager.GetUserAsync(context.Principal!);
                var stamp = context.Principal!.FindFirstValue("AspNet.Identity.SecurityStamp");
                if (user is null || !user.IsActive || !user.EmailConfirmed || await manager.IsLockedOutAsync(user) || stamp != await manager.GetSecurityStampAsync(user)) { context.RejectPrincipal(); return; }
                // Role decisions are rebuilt from the database on each request, not trusted from stale cookies.
                context.ReplacePrincipal(await context.HttpContext.RequestServices.GetRequiredService<IUserClaimsPrincipalFactory<ApplicationUser>>().CreateAsync(user));
            };
        });
        builder.Services.AddAuthorization(options =>
        {
            options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
            options.AddPolicy("Verified", policy => policy.RequireAuthenticatedUser());
            options.AddPolicy("Admin", policy => policy.RequireAuthenticatedUser().RequireRole("Admin"));
        });
        builder.Services.AddAntiforgery(options =>
        {
            var secureCookies = !builder.Environment.IsDevelopment() || configuration.GetValue("Security:DevelopmentHttps", false);
            options.HeaderName = "X-CSRF-Token"; options.Cookie.Name = "ElectroMart.Antiforgery";
            options.Cookie.HttpOnly = true; options.Cookie.SameSite = SameSiteMode.Lax; options.Cookie.Path = "/";
            options.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.None;
        });
        builder.Services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = 429;
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context => RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 15, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            options.OnRejected = async (context, ct) => { await context.HttpContext.Response.WriteAsJsonAsync(new { code = "request_throttled", title = "Too many requests", detail = "Wait before trying again.", status = 429, traceId = context.HttpContext.TraceIdentifier }, ct); };
        });
        builder.Services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = 1;
            foreach (var address in configuration.GetSection("Security:TrustedProxies").Get<string[]>() ?? [])
                options.KnownProxies.Add(IPAddress.Parse(address));
        });
        builder.Services.AddControllers().AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
        builder.Services.Configure<ApiBehaviorOptions>(options => options.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(new { code = "invalid_request", title = "Check the submitted details", detail = "One or more fields are missing or invalid.", status = 400, traceId = context.HttpContext.TraceIdentifier }));
        builder.Services.AddProblemDetails(); builder.Services.AddExceptionHandler<CommerceExceptionHandler>(); builder.Services.AddOpenApi();
        var app = builder.Build();
        ValidateConfiguration(app.Configuration, app.Environment);
        var development = app.Environment.IsDevelopment();
        var origin = new Uri(app.Configuration["Storefront:Origin"]!);

        if (args.Contains("--migrate-dev") || args.Contains("--seed-dev") || args.Contains("--bootstrap-admin"))
        {
            using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            if (args.Contains("--migrate-dev") || args.Contains("--seed-dev"))
            {
                if (!development) throw new InvalidOperationException("Local migration/seed commands require Development.");
                DevelopmentSeed.RequireLocalDatabase(db);
                if (args.Contains("--migrate-dev")) await db.Database.MigrateAsync();
                if (args.Contains("--seed-dev")) await DevelopmentSeed.Seed(db);
            }
            if (args.Contains("--bootstrap-admin")) await BootstrapAdmin(scope.ServiceProvider, configuration);
            return;
        }
        app.UseForwardedHeaders(); app.UseExceptionHandler();
        if (!development) { app.UseHsts(); app.UseHttpsRedirection(); }
        app.UseStatusCodePages(async context =>
        {
            var status = context.HttpContext.Response.StatusCode;
            await context.HttpContext.Response.WriteAsJsonAsync(new { code = status == 401 ? "authentication_required" : status == 403 ? "forbidden" : "not_found", title = "Request could not be completed", detail = status == 401 ? "Sign in to continue." : status == 403 ? "You are not permitted to perform this action." : "The requested record is unavailable.", status, traceId = context.HttpContext.TraceIdentifier });
        });
        app.UseRouting(); app.UseAuthentication(); app.UseRateLimiter(); app.UseAuthorization();
        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            if (context.Request.Method is not ("GET" or "HEAD" or "OPTIONS"))
            {
                if (context.Request.Headers.Origin != origin.GetLeftPart(UriPartial.Authority) || context.Request.Headers["Sec-Fetch-Site"] is var site && !string.IsNullOrEmpty(site) && site != "same-origin") throw new CommerceException(403, "origin_invalid", "This request origin is not permitted.");
                if (context.Request.ContentLength > 65536) throw new CommerceException(400, "invalid_request", "The submitted request is too large.");
                try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context); }
                catch (AntiforgeryValidationException) { throw new CommerceException(400, "csrf_invalid", "Refresh the security token and try again."); }
            }
            await next();
        });
        if (development) { app.MapOpenApi().AllowAnonymous(); app.MapScalarApiReference().AllowAnonymous(); }
        app.MapGet("/health/database", async (ApplicationDbContext db, CancellationToken ct) => await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "Healthy" }) : Results.StatusCode(503)).AllowAnonymous();
        app.MapControllers(); await app.RunAsync();
    }

    private static void ValidateConfiguration(IConfiguration configuration, IWebHostEnvironment environment)
    {
        var development = environment.IsDevelopment();
        var connection = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("Set a nonempty ConnectionStrings__DefaultConnection outside source control.");
        if (!Uri.TryCreate(configuration["Storefront:Origin"], UriKind.Absolute, out var origin) || !string.IsNullOrEmpty(origin.UserInfo) || origin.AbsolutePath != "/" || !string.IsNullOrEmpty(origin.Query) || !string.IsNullOrEmpty(origin.Fragment) || origin.Scheme != "https" && !(development && origin.IsLoopback && origin.Scheme == "http"))
            throw new InvalidOperationException("Storefront__Origin must be the canonical storefront HTTPS origin (local HTTP is development-only).");
        var keyPath = configuration["Security:KeyPath"];
        if (string.IsNullOrWhiteSpace(keyPath) || !Path.IsPathFullyQualified(keyPath)) throw new InvalidOperationException("Security__KeyPath must be an absolute persistent directory outside deployment artifacts.");
        var fullKeyPath = Path.GetFullPath(keyPath);
        var contentRoot = Path.GetFullPath(environment.ContentRootPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (fullKeyPath.StartsWith(contentRoot, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Data Protection keys must be outside deploy artifacts.");
        if (!development)
        {
            if (string.IsNullOrWhiteSpace(configuration["AllowedHosts"]) || configuration["AllowedHosts"] == "*") throw new InvalidOperationException("Production AllowedHosts must contain explicit API hosts.");
            if (string.IsNullOrWhiteSpace(configuration["Security:KeyCertificateThumbprint"])) throw new InvalidOperationException("Production requires a certificate-encrypted persistent Data Protection key ring.");
            if (string.IsNullOrWhiteSpace(configuration["Mail:Host"]) || string.IsNullOrWhiteSpace(configuration["Mail:Sender"]) || !configuration.GetValue("Mail:EnableSsl", false)) throw new InvalidOperationException("Production requires configured SMTP sender, host and TLS.");
            var mysql = new MySqlConnectionStringBuilder(connection);
            if (mysql.SslMode != MySqlSslMode.VerifyFull) throw new InvalidOperationException("Production MySQL requires SslMode=VerifyFull.");
        }
    }

    private static async Task BootstrapAdmin(IServiceProvider services, IConfiguration configuration)
    {
        var email = configuration["Bootstrap:Email"]; var password = configuration["Bootstrap:Password"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password)) throw new InvalidOperationException("Operator bootstrap requires Bootstrap__Email and Bootstrap__Password; no default credentials exist.");
        var users = services.GetRequiredService<UserManager<ApplicationUser>>(); var roles = services.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        if (await users.FindByEmailAsync(email) is not null) throw new InvalidOperationException("Refusing to promote an existing customer account. Provision a distinct operator account.");
        if (!await roles.RoleExistsAsync("Admin")) { var role = await roles.CreateAsync(new IdentityRole<Guid>("Admin")); if (!role.Succeeded) throw new InvalidOperationException("Admin role provisioning failed."); }
        var user = new ApplicationUser { Id = Guid.NewGuid(), Email = email.Trim(), UserName = email.Trim(), EmailConfirmed = true, Name = "Operator" };
        if (!(await users.CreateAsync(user, password)).Succeeded) throw new InvalidOperationException("Admin provisioning failed. Ensure the password meets the configured requirements.");
        if (!(await users.AddToRoleAsync(user, "Admin")).Succeeded) throw new InvalidOperationException("Admin role assignment failed.");
    }
}
