namespace ElectroApi.Integration.Tests;

public sealed class ProductionConfigurationTests
{
    private static string Keys => Path.Combine(Path.GetTempPath(), "kilo", "config_test_keys");
    private static void Reject(IReadOnlyDictionary<string, string?> settings, string message, string environment = "Production")
    {
        using var factory = new CommerceApiFactory("Server=127.0.0.1;Database=electromart_mvp_dev;User ID=sample;Password=not-real;SslMode=Disabled;", Keys, false, environment, settings);
        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains(message, exception.Message);
    }
    [Fact] public void Missing_connection_is_not_a_runtime_default() => Reject(new Dictionary<string, string?> { ["ConnectionStrings:DefaultConnection"] = "" }, "nonempty ConnectionStrings");
    [Fact] public void Production_storefront_requires_canonical_https() => Reject(new Dictionary<string, string?> { ["Storefront:Origin"] = "http://shop.example.com" }, "canonical storefront HTTPS");
    [Fact] public void Production_hosts_cannot_be_wildcard() => Reject(new Dictionary<string, string?> { ["AllowedHosts"] = "*" }, "explicit API hosts");
    [Fact] public void Production_key_ring_requires_certificate_encryption() => Reject(new Dictionary<string, string?> { ["AllowedHosts"] = "api.example.com", ["Security:KeyCertificateThumbprint"] = "" }, "certificate-encrypted");
    [Fact]
    public void Keys_cannot_equal_deployment_root_or_be_its_descendants()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "ElectroApi.Api"));
        Reject(new Dictionary<string, string?> { ["Security:KeyPath"] = root }, "outside deploy artifacts", "Development");
        Reject(new Dictionary<string, string?> { ["Security:KeyPath"] = Path.Combine(root, "keys") }, "outside deploy artifacts", "Development");
    }
}
