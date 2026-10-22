namespace ElectroApi.Integration.Tests;

public sealed class MySqlFactAttribute : FactAttribute
{
    public MySqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ELECTROMART_TEST_MYSQL")))
            Skip = "Set ELECTROMART_TEST_MYSQL to an isolated MySQL 8.4 server. This gate is not validated when skipped.";
    }
}
