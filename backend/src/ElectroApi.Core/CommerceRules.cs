using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;

namespace ElectroApi.Core;

public sealed class CommerceException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

public static partial class CommerceRules
{
    public const string MoneyPolicy = "bdt-cod-v1";
    public static readonly HashSet<string> VisualKeys = ["smartphones", "laptops", "audio", "wearables", "cameras", "gaming", "accessories", "tablets"];
    public static readonly HashSet<string> Districts = new("Bagerhat,Bandarban,Barguna,Barishal,Bhola,Bogura,Brahmanbaria,Chandpur,Chattogram,Chuadanga,Cox's Bazar,Cumilla,Dhaka,Dinajpur,Faridpur,Feni,Gaibandha,Gazipur,Gopalganj,Habiganj,Jamalpur,Jashore,Jhalokathi,Jhenaidah,Joypurhat,Khagrachhari,Khulna,Kishoreganj,Kurigram,Kushtia,Lakshmipur,Lalmonirhat,Madaripur,Magura,Manikganj,Meherpur,Moulvibazar,Munshiganj,Mymensingh,Naogaon,Narail,Narayanganj,Narsingdi,Natore,Netrokona,Nilphamari,Noakhali,Pabna,Panchagarh,Patuakhali,Pirojpur,Rajbari,Rajshahi,Rangamati,Rangpur,Satkhira,Shariatpur,Sherpur,Sirajganj,Sunamganj,Sylhet,Tangail,Thakurgaon,Chapainawabganj".Split(','), StringComparer.OrdinalIgnoreCase);
    public static MoneySnapshot Totals(decimal subtotal) => new("BDT", subtotal, subtotal >= 5000m || subtotal == 0m ? 0m : 80m, subtotal + (subtotal >= 5000m || subtotal == 0m ? 0m : 80m), MoneyPolicy);
    public static void WholePrice(decimal price)
    {
        Require(price >= 1m && price <= 999999999m && decimal.Truncate(price) == price, "invalid_price", "Prices must be positive whole BDT taka.");
    }
    public static void Slug(string slug) => Require(SlugPattern().IsMatch(slug), "invalid_slug", "Use a lowercase URL slug with letters, numbers and hyphens.");
    public static void Product(ProductRequest request)
    {
        Slug(request.Slug); WholePrice(request.Price);
        if (request.CompareAtPrice is { } compare) { WholePrice(compare); Require(compare > request.Price, "invalid_compare_price", "Compare price must exceed the sale price."); }
        Require(request.Images.Length <= 10 && request.Images.All(url => url.Length <= 2000 && Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https" && string.IsNullOrEmpty(uri.UserInfo)), "invalid_images", "Images must be externally hosted HTTPS URLs without credentials.");
        Require(request.Specs.Length <= 30 && request.Specs.All(s => !string.IsNullOrWhiteSpace(s.Label) && s.Label.Length <= 100 && !string.IsNullOrWhiteSpace(s.Value) && s.Value.Length <= 500), "invalid_specs", "Specifications require bounded labels and values.");
        Require(!string.IsNullOrWhiteSpace(request.Name) && request.CategoryId != Guid.Empty, "invalid_product", "A name and category are required.");
    }
    public static (ContactSnapshot Contact, AddressSnapshot Address) Contact(AcceptOrderRequest request, string? accountEmail)
    {
        var contact = request.Contact; var address = request.DeliveryAddress;
        Require(contact is not null && address is not null, "invalid_contact", "Contact and delivery address are required.");
        var email = (accountEmail ?? contact!.Email).Trim();
        Require(new EmailAddressAttribute().IsValid(email) && email.Length <= 254, "invalid_email", "Enter a valid email address.");
        Require(contact!.Name.Trim().Length is >= 2 and <= 100 && !contact.Name.Any(char.IsControl), "invalid_name", "Enter the recipient's full name.");
        var phone = Regex.Replace(contact.Phone, "[ ()-]", "");
        Require(PhonePattern().IsMatch(phone), "invalid_phone", "Enter a Bangladesh mobile number, such as 01712345678.");
        Require(address!.Street.Trim().Length is >= 5 and <= 300 && address.Area.Trim().Length is >= 2 and <= 100 && address.City.Trim().Length is >= 2 and <= 100 && Districts.Contains(address.District.Trim()), "invalid_address", "Enter street, area, city and a Bangladesh district.");
        Require(string.IsNullOrEmpty(address.Postcode) || PostcodePattern().IsMatch(address.Postcode), "invalid_postcode", "Postcode must contain four digits.");
        Require(request.Notes?.Length is null or <= 500, "invalid_notes", "Delivery notes must not exceed 500 characters.");
        return (new(contact.Name.Trim(), email, phone), new(address.Street.Trim(), address.Area.Trim(), address.City.Trim(), address.District.Trim(), string.IsNullOrWhiteSpace(address.Postcode) ? null : address.Postcode));
    }
    public static bool CanTransition(OrderStatus from, OrderStatus to) => (from, to) is (OrderStatus.Pending, OrderStatus.Confirmed) or (OrderStatus.Confirmed, OrderStatus.Shipped) or (OrderStatus.Shipped, OrderStatus.Delivered) or (OrderStatus.Pending or OrderStatus.Confirmed, OrderStatus.Cancelled);
    public static void Require(bool condition, string code, string message, int status = 400) { if (!condition) throw new CommerceException(status, code, message); }
    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")] private static partial Regex SlugPattern();
    [GeneratedRegex("^(?:\\+?88)?01[3-9][0-9]{8}$")] private static partial Regex PhonePattern();
    [GeneratedRegex("^[0-9]{4}$")] private static partial Regex PostcodePattern();
}
