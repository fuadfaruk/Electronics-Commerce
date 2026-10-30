using System.Globalization;
using System.Text;
using System.Text.Json;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;

namespace ElectroApi.Infrastructure.Notifications;

public sealed class OwnerNotificationSettings
{
    public bool Enabled { get; }
    public long OwnerChatId { get; }
    internal string BotToken { get; }

    private OwnerNotificationSettings(bool enabled, long ownerChatId, string botToken) => (Enabled, OwnerChatId, BotToken) = (enabled, ownerChatId, botToken);

    public static OwnerNotificationSettings Read(IConfiguration configuration)
    {
        var switchValue = configuration["OwnerNotifications:Enabled"];
        if (switchValue is not null && !bool.TryParse(switchValue, out _)) throw new InvalidOperationException("OwnerNotifications__Enabled must be true or false.");
        if (!bool.TryParse(switchValue, out var enabled) || !enabled) return new(false, 0, "");
        var token = configuration["Telegram:BotToken"] ?? "";
        var separator = token.IndexOf(':');
        if (separator is < 1 or > 20 || token.Length - separator - 1 is < 30 or > 100 ||
            !token[..separator].All(char.IsAsciiDigit) || !token[(separator + 1)..].All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-'))
            throw new InvalidOperationException("Enabled owner notifications require a valid protected Telegram__BotToken.");
        var chat = configuration["Telegram:OwnerChatId"];
        if (!long.TryParse(chat, NumberStyles.None, CultureInfo.InvariantCulture, out var chatId) || chatId <= 0)
            throw new InvalidOperationException("Telegram__OwnerChatId must be a positive numeric private-chat ID within signed 64-bit range.");
        return new(true, chatId, token);
    }
}

public sealed record OwnerNotificationPayload(Guid OrderId, string OrderNumber, long ChatId, string[] Parts);

public sealed class OwnerOrderNotifications(IDataProtectionProvider protection, OwnerNotificationSettings settings, IConfiguration configuration) : IOwnerOrderNotifications
{
    public const int MessageLimit = 4096;
    private readonly IDataProtector _protector = protection.CreateProtector("ElectroMart.OwnerOrderNotifications.v1");

    public OwnerOrderNotification? Create(Order order)
    {
        if (!settings.Enabled) return null;
        if (!Uri.TryCreate(configuration["Storefront:Origin"], UriKind.Absolute, out var origin) ||
            !string.IsNullOrEmpty(origin.UserInfo) || origin.AbsolutePath != "/" || !string.IsNullOrEmpty(origin.Query) || !string.IsNullOrEmpty(origin.Fragment) ||
            origin.Scheme != "https" && !(origin.IsLoopback && origin.Scheme == "http"))
            throw new InvalidOperationException("A canonical credential-free storefront origin is required.");
        var text = new StringBuilder();
        text.Append("Accepted at: ").Append(order.CreatedAt.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss 'UTC'", CultureInfo.InvariantCulture)).Append('\n');
        text.Append("Acceptance snapshot: Pending / Unpaid, awaiting manual confirmation/payment.\n");
        text.Append("This alert is not confirmation or proof of payment. Alerts may be delayed; review current database state before acting.\n");
        text.Append("Staff order: ").Append(origin.GetLeftPart(UriPartial.Authority)).Append("/admin/orders/").Append(order.Id).Append("\n\n");
        Field(text, "Name", order.Contact.Name);
        Field(text, "Phone", order.Contact.Phone);
        Field(text, "Email", order.Contact.Email);
        Field(text, "Delivery street", order.DeliveryAddress.Street);
        Field(text, "Area", order.DeliveryAddress.Area);
        Field(text, "City", order.DeliveryAddress.City);
        Field(text, "District", order.DeliveryAddress.District);
        Field(text, "Postcode", order.DeliveryAddress.Postcode ?? "Not provided");
        text.Append("\nPurchased items (accepted price snapshots):\n");
        foreach (var line in order.Lines.OrderBy(l => l.Position).ThenBy(l => l.Id))
        {
            Field(text, "Item name", line.Name);
            text.Append("  Quantity: ").Append(line.Quantity.ToString(CultureInfo.InvariantCulture))
                .Append(" | Unit price: BDT ").Append(Money(line.UnitPrice)).Append(" | Line total: BDT ").Append(Money(line.LineTotal)).Append('\n');
        }
        text.Append("\nSubtotal: BDT ").Append(Money(order.Money.Subtotal))
            .Append("\nDelivery: BDT ").Append(Money(order.Money.Delivery))
            .Append("\nGrand total: BDT ").Append(Money(order.Money.Total)).Append('\n');
        Field(text, "Customer notes", order.Notes ?? "None");
        var parts = Split(order.Number, text.ToString());
        return new()
        {
            OrderId = order.Id,
            CreatedAt = order.CreatedAt,
            PartCount = parts.Length,
            ProtectedPayload = _protector.Protect(JsonSerializer.Serialize(new OwnerNotificationPayload(order.Id, order.Number, settings.OwnerChatId, parts)))
        };
    }

    public OwnerNotificationPayload Read(string protectedPayload) => JsonSerializer.Deserialize<OwnerNotificationPayload>(_protector.Unprotect(protectedPayload)) ?? throw new InvalidOperationException("Invalid protected owner notification.");

    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

    private static void Field(StringBuilder text, string label, string value)
    {
        text.Append(label).Append(" (provided text):\n");
        foreach (var line in Sanitize(value).Split('\n')) text.Append("  | ").Append(line).Append('\n');
    }

    public static string Sanitize(string value)
    {
        var text = new StringBuilder(value.Length);
        foreach (var rune in value.Replace("\r\n", "\n").Replace('\r', '\n').EnumerateRunes())
        {
            if (rune.Value is '\t') { text.Append(' '); continue; }
            if (rune.Value is 0x2028 or 0x2029) { text.Append('\n'); continue; }
            // Strip terminal/bidi controls, but retain joiners used by Bangla and emoji.
            if ((rune.Value != '\n' && Rune.GetUnicodeCategory(rune) == UnicodeCategory.Control) ||
                rune.Value is 0x061C or 0x200E or 0x200F or >= 0x202A and <= 0x202E or >= 0x2066 and <= 0x2069 or 0xFEFF) continue;
            text.Append(rune.ToString());
        }
        return text.ToString();
    }

    private static string Prefix(string number, int part, int count) => $"Order {number} | Part {part.ToString(CultureInfo.InvariantCulture)}/{count.ToString(CultureInfo.InvariantCulture)}\nAwaiting manual confirmation/payment.\n";

    public static string[] Split(string orderNumber, string body)
    {
        // Reserve the largest possible numeric prefix before counting parts.
        var capacity = MessageLimit - 1 - Prefix(orderNumber, int.MaxValue, int.MaxValue).Length;
        if (capacity < 2) throw new InvalidOperationException("Owner notification order label is invalid.");
        var chunks = new List<string>();
        for (var offset = 0; offset < body.Length;)
        {
            var length = Math.Min(capacity, body.Length - offset);
            if (offset + length < body.Length)
            {
                if (char.IsHighSurrogate(body[offset + length - 1]) && char.IsLowSurrogate(body[offset + length])) length--;
                var newline = body.LastIndexOf('\n', offset + length - 1, length);
                if (newline >= offset) length = newline - offset + 1;
            }
            chunks.Add(body.Substring(offset, length));
            offset += length;
        }
        if (chunks.Count == 0) chunks.Add("");
        return chunks.Select((chunk, index) => Prefix(orderNumber, index + 1, chunks.Count) + chunk).ToArray();
    }
}
