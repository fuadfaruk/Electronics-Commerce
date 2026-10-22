using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Enums;

namespace ElectroApi.Unit.Tests;

public sealed class CommerceRulesTests
{
    [Theory]
    [InlineData(0, 0, 0)] [InlineData(4999, 80, 5079)] [InlineData(5000, 0, 5000)] [InlineData(6000, 0, 6000)]
    public void Whole_taka_delivery_policy_is_exact(int subtotal, int delivery, int total)
    {
        var money = CommerceRules.Totals(subtotal);
        Assert.Equal(delivery, money.Delivery); Assert.Equal(total, money.Total); Assert.Equal("BDT", money.Currency);
    }
    [Theory]
    [InlineData("0")] [InlineData("-1")] [InlineData("100.01")] [InlineData("1000000000")]
    public void New_prices_reject_fractional_zero_negative_and_unbounded_values(string price) => Assert.Throws<CommerceException>(() => CommerceRules.WholePrice(decimal.Parse(price, System.Globalization.CultureInfo.InvariantCulture)));
    [Fact] public void Whole_decimal_price_is_valid() => CommerceRules.WholePrice(1234.00m);
    [Theory]
    [InlineData("hello-world", true)] [InlineData("Hello-World", false)] [InlineData("bad--slug", false)] [InlineData("../slug", false)]
    public void Slugs_are_url_safe(string slug, bool valid) { if (valid) CommerceRules.Slug(slug); else Assert.Throws<CommerceException>(() => CommerceRules.Slug(slug)); }
    [Fact]
    public void Fulfillment_and_collection_are_not_payment_gateways()
    {
        Assert.True(CommerceRules.CanTransition(OrderStatus.Pending, OrderStatus.Confirmed));
        Assert.True(CommerceRules.CanTransition(OrderStatus.Pending, OrderStatus.Cancelled));
        Assert.True(CommerceRules.CanTransition(OrderStatus.Confirmed, OrderStatus.Cancelled));
        Assert.False(CommerceRules.CanTransition(OrderStatus.Pending, OrderStatus.Delivered));
        Assert.False(CommerceRules.CanTransition(OrderStatus.Shipped, OrderStatus.Cancelled));
        Assert.False(CommerceRules.CanTransition(OrderStatus.Delivered, OrderStatus.Confirmed));
        Assert.False(CommerceRules.CanTransition(OrderStatus.Cancelled, OrderStatus.Pending));
    }
    [Theory]
    [InlineData("01712345678")] [InlineData("+8801712345678")] [InlineData("8801712345678")]
    public void Contact_uses_verified_email_and_Bangladesh_phone(string phone)
    {
        var request = Request(phone);
        var contact = CommerceRules.Contact(request, "verified@example.com");
        Assert.Equal("verified@example.com", contact.Contact.Email);
    }
    [Fact] public void Invalid_phone_and_district_are_rejected() { Assert.Throws<CommerceException>(() => CommerceRules.Contact(Request("01234567890"), null)); Assert.Throws<CommerceException>(() => CommerceRules.Contact(Request("01712345678", "Unknown"), null)); }
    private static AcceptOrderRequest Request(string phone, string district = "Dhaka") => new(Guid.NewGuid(), new() { Name = "Sample Customer", Email = "sample@example.com", Phone = phone }, new() { Street = "123 Sample Road", Area = "Sample Area", City = "Dhaka", District = district }, null);
}
