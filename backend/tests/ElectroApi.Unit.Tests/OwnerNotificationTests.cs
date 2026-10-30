using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.Tracing;
using System.Globalization;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Enums;
using ElectroApi.Infrastructure.Mail;
using ElectroApi.Infrastructure.Notifications;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit.Abstractions;

namespace ElectroApi.Unit.Tests;

[CollectionDefinition("Owner notification diagnostics", DisableParallelization = true)]
public sealed class OwnerNotificationDiagnosticsCollection;

[Collection("Owner notification diagnostics")]
public sealed class OwnerNotificationTests(ITestOutputHelper output)
{
    private const string BotToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
    private const long OwnerChatId = 4294967296;
    private const string Origin = "https://example.com";
    private const string Bangla = "\u09AC\u09BE\u0982\u09B2\u09BE";
    private const string JoinedBangla = "\u0995\u09CD\u200D\u09B7";
    private const string Emoji = "\U0001F469\U0001F3FD\u200D\U0001F4BB";

    [Fact]
    public void Accepted_snapshot_contains_complete_contact_items_fixed_BDT_amounts_and_staff_link()
    {
        var previousCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            var order = SampleOrder();
            var builder = Builder();
            var row = Assert.IsType<OwnerOrderNotification>(builder.Create(order));
            var payload = builder.Read(row.ProtectedPayload);
            var text = Body(payload);

            Assert.Equal(order.Id, row.OrderId);
            Assert.Equal(order.CreatedAt, row.CreatedAt);
            Assert.Equal(payload.Parts.Length, row.PartCount);
            Assert.Equal(order.Id, payload.OrderId);
            Assert.Equal(order.Number, payload.OrderNumber);
            Assert.Equal(OwnerChatId, payload.ChatId);
            Assert.Single(payload.Parts);
            Assert.Contains("Accepted at: 2026-10-29 12:34:56 UTC\n", text);
            Assert.Contains("Pending / Unpaid, awaiting manual confirmation/payment.", text);
            Assert.Contains("not confirmation or proof of payment", text);
            Assert.Contains("Alerts may be delayed; review current database state before acting.", text);
            Assert.Contains($"Staff order: {Origin}/admin/orders/{order.Id}\n", text);
            AssertContactAndAddress(order, text);
            Assert.Contains("Item name (provided text):\n  | Sample headphones\n  Quantity: 2 | Unit price: BDT 1499.00 | Line total: BDT 2998.00\n", text);
            Assert.Contains("Item name (provided text):\n  | Sample cable\n  Quantity: 3 | Unit price: BDT 80.00 | Line total: BDT 240.00\n", text);
            Assert.True(text.IndexOf("Sample headphones", StringComparison.Ordinal) < text.IndexOf("Sample cable", StringComparison.Ordinal));
            Assert.Contains("Subtotal: BDT 3238.00\nDelivery: BDT 80.00\nGrand total: BDT 3318.00\n", text);
            AssertField(text, "Customer notes", order.Notes!);
            Assert.DoesNotContain("3,238", text);
            Assert.DoesNotContain("3238,00", text);
            AssertParts(payload);
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
    }

    [Fact]
    public void Optional_postcode_and_notes_are_explicit_not_silently_missing()
    {
        var order = SampleOrder();
        order.DeliveryAddress = order.DeliveryAddress with { Postcode = null };
        order.Notes = null;
        var builder = Builder();
        var text = Body(builder.Read(builder.Create(order)!.ProtectedPayload));

        AssertField(text, "Postcode", "Not provided");
        AssertField(text, "Customer notes", "None");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("https://user:synthetic-password@example.com")]
    [InlineData("https://example.com/nested")]
    [InlineData("https://example.com/?token=synthetic-secret")]
    [InlineData("https://example.com/#proof=synthetic-secret")]
    [InlineData("ftp://example.com")]
    [InlineData("http://example.com")]
    public void Staff_link_rejects_noncanonical_or_credential_bearing_origin_without_echoing_configuration(string? origin)
    {
        var configuration = Configuration();
        configuration["Storefront:Origin"] = origin;
        var builder = Builder(configuration);
        var error = Assert.Throws<InvalidOperationException>(() => builder.Create(SampleOrder()));
        Assert.Equal("A canonical credential-free storefront origin is required.", error.Message);
    }

    [Theory]
    [InlineData("https://example.com/")]
    [InlineData("http://localhost:3000")]
    public void Staff_link_uses_canonical_root_including_local_development(string origin)
    {
        var configuration = Configuration();
        configuration["Storefront:Origin"] = origin;
        var builder = Builder(configuration);
        var order = SampleOrder();
        Assert.Contains($"Staff order: {new Uri(origin).GetLeftPart(UriPartial.Authority)}/admin/orders/{order.Id}\n", Body(builder.Read(builder.Create(order)!.ProtectedPayload)));
    }

    [Fact]
    public void Protected_payload_contains_only_owner_snapshot_not_ownership_account_capabilities_or_proofs()
    {
        var order = SampleOrder();
        var protection = new EphemeralDataProtectionProvider();
        var builder = Builder(protection: protection);
        var row = builder.Create(order)!;
        var json = protection.CreateProtector("ElectroMart.OwnerOrderNotifications.v1").Unprotect(row.ProtectedPayload);
        using var document = JsonDocument.Parse(json);

        Assert.Equal(new[] { "ChatId", "OrderId", "OrderNumber", "Parts" }, document.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        foreach (var secret in new[]
        {
            BotToken, order.CheckoutOwner, order.NormalizedEmail, order.AccountId!.Value.ToString(), order.QuoteId.ToString(),
            order.Events[0].Note!, order.Events[0].ActorId!.Value.ToString(), order.Events[0].Action,
            order.Lines[0].ProductId.ToString(), order.Lines[0].Slug
        })
        {
            Assert.DoesNotContain(secret, json);
        }
        Assert.DoesNotContain(order.Contact.Email, row.ProtectedPayload);
        Assert.DoesNotContain(order.Contact.Name, row.ProtectedPayload);
        Assert.DoesNotContain(order.Notes!, row.ProtectedPayload);
        Assert.DoesNotContain("/orders/access", json);
        Assert.DoesNotContain("#token=", json);
        Assert.DoesNotContain("#proof=", json);
    }

    [Fact]
    public void Sanitizing_user_typed_proof_like_text_does_not_claim_to_redact_customer_content()
    {
        var order = SampleOrder();
        order.Notes = "I typed guest-capability-test and https://example.com/help#proof=customer-text myself.";
        var builder = Builder();
        var text = Body(builder.Read(builder.Create(order)!.ProtectedPayload));

        AssertField(text, "Customer notes", order.Notes);
        Assert.Contains("#proof=customer-text", text);
        Assert.DoesNotContain(order.Events[0].Note!, text);
    }

    [Fact]
    public void Snapshot_and_recipient_remain_frozen_after_order_and_configuration_changes()
    {
        var protection = new EphemeralDataProtectionProvider();
        var configuration = Configuration();
        var builder = Builder(configuration, protection);
        var order = SampleOrder();
        var row = builder.Create(order)!;
        var before = builder.Read(row.ProtectedPayload);
        var originalJson = JsonSerializer.Serialize(before);
        var originalCreatedAt = row.CreatedAt;

        order.Number = "EM-CHANGED";
        order.CreatedAt = order.CreatedAt.AddDays(2);
        order.Contact = new("Changed customer", "changed@example.com", "01912345678");
        order.DeliveryAddress = new("Changed street", "Changed area", "Changed city", "Sylhet", "3100");
        order.Notes = "Changed notes";
        order.Money = new("BDT", 1m, 2m, 3m, "changed-policy");
        order.Fulfillment = OrderStatus.Delivered;
        order.Payment = PaymentStatus.Collected;
        order.Lines[0].Name = "Changed product";
        order.Lines[0].Quantity = 99;
        order.Lines[0].UnitPrice = 99m;
        order.Lines.Clear();
        configuration["Storefront:Origin"] = "https://changed.example.com";
        configuration["Telegram:OwnerChatId"] = long.MaxValue.ToString(CultureInfo.InvariantCulture);
        configuration["Telegram:BotToken"] = "987654321:" + new string('S', 35);

        var changedBuilder = Builder(configuration, protection);
        Assert.Equal(originalJson, JsonSerializer.Serialize(changedBuilder.Read(row.ProtectedPayload)));
        Assert.Equal(originalCreatedAt, row.CreatedAt);
        Assert.Equal(OwnerChatId, before.ChatId);
        Assert.Equal(long.MaxValue, changedBuilder.Read(changedBuilder.Create(order)!.ProtectedPayload).ChatId);
    }

    [Fact]
    public void Protection_is_randomized_tamper_evident_and_isolated_from_email_and_other_key_rings()
    {
        var protection = new EphemeralDataProtectionProvider();
        var configuration = Configuration();
        var builder = Builder(configuration, protection);
        var first = builder.Create(SampleOrder())!;
        var second = builder.Create(SampleOrder())!;
        Assert.NotEqual(first.ProtectedPayload, second.ProtectedPayload);
        Assert.Equal(builder.Read(first.ProtectedPayload).Parts, builder.Read(second.ProtectedPayload).Parts);

        var tampered = first.ProtectedPayload.ToCharArray();
        var middle = tampered.Length / 2;
        tampered[middle] = tampered[middle] == 'A' ? 'B' : 'A';
        Assert.Throws<CryptographicException>(() => builder.Read(new string(tampered)));
        Assert.Throws<CryptographicException>(() => Builder().Read(first.ProtectedPayload));
        Assert.Throws<CryptographicException>(() => protection.CreateProtector("ElectroMart.EmailOutbox.v1").Unprotect(first.ProtectedPayload));
        Assert.Throws<CryptographicException>(() => protection.CreateProtector("ElectroMart.OwnerOrderNotifications.v2").Unprotect(first.ProtectedPayload));
        var email = new CommerceMail(protection, configuration).Create("sample@example.com", "Sample", "https://example.com/orders/access#proof=email-proof-test");
        Assert.Throws<CryptographicException>(() => builder.Read(email.ProtectedPayload));
    }

    [Fact]
    public void Legitimate_Bangla_joiners_and_emoji_survive_sanitization_and_message_protection()
    {
        var unicode = $"{Bangla} {JoinedBangla} \u0995\u09CD\u200C\u09B7 {Emoji} \U0001F468\u200D\U0001F469\u200D\U0001F467 e\u0301";
        Assert.Equal(unicode, OwnerOrderNotifications.Sanitize(unicode));
        var order = SampleOrder();
        order.Contact = order.Contact with { Name = unicode };
        order.Lines[0].Name = unicode;
        order.Notes = unicode;
        var builder = Builder();
        var payload = builder.Read(builder.Create(order)!.ProtectedPayload);

        AssertField(Body(payload), "Name", unicode);
        AssertField(Body(payload), "Item name", unicode);
        AssertField(Body(payload), "Customer notes", unicode);
        AssertParts(payload);
    }

    [Fact]
    public void Unsafe_controls_are_removed_and_line_endings_tabs_and_Unicode_separators_normalized()
    {
        const string controls = "\0\u0001\u0007\u001B\u007F\u0085\u061C\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\uFEFF";
        Assert.Equal("", OwnerOrderNotifications.Sanitize(controls));
        Assert.Equal("first\nsecond\nthird fourth\nfifth\nsixth", OwnerOrderNotifications.Sanitize("first\r\nsecond\rthird\tfourth\u2028fifth\u2029sixth"));
        Assert.Equal(Bangla + Emoji, OwnerOrderNotifications.Sanitize(controls + Bangla + controls + Emoji + controls));
    }

    [Fact]
    public void Hostile_multiline_fields_remain_plain_text_and_indented_under_their_labels()
    {
        const string hostile = "Sample\r\nGrand total: BDT 0.00\t<admin>\u202E\nOrder FAKE | Part 9/9\u001B\n[click](https://example.com/hostile)";
        const string sanitized = "Sample\nGrand total: BDT 0.00 <admin>\nOrder FAKE | Part 9/9\n[click](https://example.com/hostile)";
        var order = SampleOrder();
        order.Contact = new(hostile, hostile, hostile);
        order.DeliveryAddress = new(hostile, hostile, hostile, hostile, hostile);
        order.Notes = hostile;
        order.Lines[0].Name = hostile;
        var builder = Builder();
        var text = Body(builder.Read(builder.Create(order)!.ProtectedPayload));

        foreach (var label in new[] { "Name", "Phone", "Email", "Delivery street", "Area", "City", "District", "Postcode", "Customer notes", "Item name" })
            AssertField(text, label, sanitized);
        Assert.DoesNotContain("\nGrand total: BDT 0.00", text);
        Assert.DoesNotContain("\nOrder FAKE", text);
        Assert.Contains("\nGrand total: BDT 3318.00\n", text);
        Assert.DoesNotContain("\u202E", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\u001B", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Fifty_maximum_length_items_and_all_maximum_snapshot_fields_are_complete_and_ordered()
    {
        var order = SampleOrder();
        order.Number = order.Number.PadRight(40, '0');
        order.Contact = new((Bangla + Emoji).PadRight(100, 'N'), new string('e', 242) + "@example.com", new string('7', 20));
        order.DeliveryAddress = new((JoinedBangla + Emoji).PadRight(300, 'S'), new string('A', 100), new string('C', 100), new string('D', 100), "1212");
        order.Notes = ("Maximum notes " + Bangla + Emoji).PadRight(500, 'X');
        order.Lines = Enumerable.Range(0, 50).Select(index => new OrderLine
        {
            OrderId = order.Id,
            ProductId = Guid.NewGuid(),
            Name = ($"Item {index:D2} " + JoinedBangla + Emoji).PadRight(200, (char)('a' + index % 26)),
            Slug = $"sample-item-{index}",
            UnitPrice = 999999999m,
            Quantity = index + 1,
            LineTotal = 999999999m * (index + 1),
            Position = index
        }).Reverse().ToList();
        var subtotal = order.Lines.Sum(line => line.LineTotal);
        order.Money = new("BDT", subtotal, 80m, subtotal + 80m, "bdt-cod-v1");
        var builder = Builder();
        var row = builder.Create(order)!;
        var payload = builder.Read(row.ProtectedPayload);
        var text = Body(payload);

        Assert.True(payload.Parts.Length > 1);
        Assert.Equal(payload.Parts.Length, row.PartCount);
        AssertContactAndAddress(order, text);
        AssertField(text, "Customer notes", order.Notes);
        Assert.Equal(50, text.Split("Item name (provided text):\n", StringSplitOptions.None).Length - 1);
        var previousPosition = -1;
        foreach (var line in order.Lines.OrderBy(line => line.Position))
        {
            Assert.Equal(200, line.Name.Length);
            var details = $"  | {line.Name}\n  Quantity: {line.Quantity} | Unit price: BDT 999999999.00 | Line total: BDT {line.LineTotal.ToString("0.00", CultureInfo.InvariantCulture)}\n";
            var position = text.IndexOf(details, StringComparison.Ordinal);
            Assert.True(position > previousPosition, $"Complete item {line.Position} must occur once in accepted order.");
            previousPosition = position;
        }
        Assert.Contains($"Subtotal: BDT {subtotal.ToString("0.00", CultureInfo.InvariantCulture)}\nDelivery: BDT 80.00\nGrand total: BDT {(subtotal + 80m).ToString("0.00", CultureInfo.InvariantCulture)}\n", text);
        Assert.True(text.Length > 50 * 200 + 500);
        AssertParts(payload);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(4095)]
    [InlineData(4096)]
    [InlineData(20000)]
    public void Split_preserves_all_characters_with_stable_numbered_prefixes(int length)
    {
        const string number = "EM-SPLIT-42";
        var body = new string('x', length);
        var parts = OwnerOrderNotifications.Split(number, body);
        var payload = new OwnerNotificationPayload(Guid.NewGuid(), number, OwnerChatId, parts);

        Assert.Equal(body, Body(payload));
        AssertParts(payload);
    }

    [Fact]
    public void Split_prefers_complete_lines_and_never_splits_a_surrogate_pair_at_a_hard_boundary()
    {
        const string number = "EM-UNICODE-42";
        var maximumPrefix = $"Order {number} | Part {int.MaxValue}/{int.MaxValue}\nAwaiting manual confirmation/payment.\n";
        var capacity = OwnerOrderNotifications.MessageLimit - 1 - maximumPrefix.Length;
        var body = new string('x', capacity - 1) + "\U0001F680" + new string('y', 10000) + Emoji;
        var payload = new OwnerNotificationPayload(Guid.NewGuid(), number, OwnerChatId, OwnerOrderNotifications.Split(number, body));
        Assert.Equal(body, Body(payload));
        AssertParts(payload);

        var lines = string.Concat(Enumerable.Repeat($"{Bangla} {Emoji} line\n", 1000));
        var lineParts = OwnerOrderNotifications.Split(number, lines);
        Assert.All(lineParts, part => Assert.EndsWith("\n", PartBody(part)));
        Assert.Equal(lines, string.Concat(lineParts.Select(PartBody)));
    }

    [Theory]
    [InlineData("1", 1L)]
    [InlineData("2147483648", 2147483648L)]
    [InlineData("4294967296", 4294967296L)]
    [InlineData("9223372036854775807", long.MaxValue)]
    public void Enabled_settings_accept_positive_numeric_signed_64_bit_private_chat_ids(string chat, long expected)
    {
        var settings = OwnerNotificationSettings.Read(Configuration(chat: chat));
        Assert.True(settings.Enabled);
        Assert.Equal(expected, settings.OwnerChatId);
        Assert.DoesNotContain(BotToken, settings.ToString()!);
        Assert.DoesNotContain(BotToken, JsonSerializer.Serialize(settings));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("-1001234567890")]
    [InlineData("+123")]
    [InlineData(" 123")]
    [InlineData("123 ")]
    [InlineData("1.0")]
    [InlineData("1e3")]
    [InlineData("@sample_owner")]
    [InlineData("9223372036854775808")]
    [InlineData("\u09E7\u09E8\u09E9")]
    public void Enabled_settings_reject_invalid_group_username_or_overflow_chat_ids_without_echoing_values(string? chat)
    {
        var exception = Assert.Throws<InvalidOperationException>(() => OwnerNotificationSettings.Read(Configuration(chat: chat)));
        Assert.Equal("Telegram__OwnerChatId must be a positive numeric private-chat ID within signed 64-bit range.", exception.Message);
        Assert.DoesNotContain(BotToken, exception.ToString());
    }

    public static IEnumerable<object?[]> InvalidTokens()
    {
        yield return new object?[] { null };
        yield return new object?[] { "" };
        yield return new object?[] { ":" + new string('T', 35) };
        yield return new object?[] { "not-digits:" + new string('T', 35) };
        yield return new object?[] { "\u09E7\u09E8:" + new string('T', 35) };
        yield return new object?[] { new string('1', 21) + ":" + new string('T', 35) };
        yield return new object?[] { "123:" + new string('T', 29) };
        yield return new object?[] { "123:" + new string('T', 101) };
        yield return new object?[] { BotToken + "/sendMessage" };
        yield return new object?[] { BotToken + "\r\nInjected: value" };
        yield return new object?[] { BotToken + "?query=value" };
        yield return new object?[] { BotToken + "\u00E9" };
        yield return new object?[] { " " + BotToken };
    }

    [Theory]
    [MemberData(nameof(InvalidTokens))]
    public void Enabled_settings_reject_invalid_token_syntax_with_a_fixed_safe_exception(string? token)
    {
        var exception = Assert.Throws<InvalidOperationException>(() => OwnerNotificationSettings.Read(Configuration(token: token)));
        Assert.Equal("Enabled owner notifications require a valid protected Telegram__BotToken.", exception.Message);
        Assert.DoesNotContain(BotToken, exception.ToString());
        if (!string.IsNullOrEmpty(token)) Assert.DoesNotContain(token, exception.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("false")]
    [InlineData("FALSE")]
    public async Task Disabled_settings_ignore_provider_configuration_and_do_not_build_or_send(string? enabled)
    {
        var configuration = Configuration(enabled: enabled, token: "invalid synthetic secret", chat: "@invalid");
        configuration["Storefront:Origin"] = null;
        var settings = OwnerNotificationSettings.Read(configuration);
        Assert.False(settings.Enabled);
        Assert.Equal(0, settings.OwnerChatId);
        Assert.Null(new OwnerOrderNotifications(new EphemeralDataProtectionProvider(), settings, configuration).Create(SampleOrder()));
        using var handler = new FakeHandler((_, _) => throw new InvalidOperationException("Disabled sending must not invoke HTTP."));
        using var sender = new TelegramOwnerNotificationSender(settings, handler);
        var result = await sender.Send(OwnerChatId, "Sample", CancellationToken.None);

        AssertFailure(result, OwnerNotificationFailure.Disabled, permanent: true);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public void Invalid_enabled_switch_does_not_echo_a_secret_used_as_its_value()
    {
        var exception = Assert.Throws<InvalidOperationException>(() => OwnerNotificationSettings.Read(Configuration(enabled: BotToken)));
        Assert.Equal("OwnerNotifications__Enabled must be true or false.", exception.Message);
        Assert.DoesNotContain(BotToken, exception.ToString());
    }

    [Fact]
    public async Task Sender_posts_fixed_HTTPS_method_host_and_plain_JSON_to_the_configured_private_recipient()
    {
        var text = $"{Bangla} {Emoji}\n<admin> [text](https://example.com/sample)";
        string? url = null;
        string? method = null;
        string? contentType = null;
        string? json = null;
        string[]? headers = null;
        CancellationToken requestCancellation = default;
        using var caller = new CancellationTokenSource();
        using var handler = new FakeHandler(async (request, ct) =>
        {
            url = request.RequestUri!.AbsoluteUri;
            method = request.Method.Method;
            contentType = request.Content!.Headers.ContentType!.MediaType;
            json = await request.Content.ReadAsStringAsync(ct);
            headers = request.Headers.Select(header => header.Key).ToArray();
            requestCancellation = ct;
            return Response(HttpStatusCode.OK, SuccessJson());
        });
        using var sender = Sender(handler);
        using var parent = new Activity("owner-notification-test").Start();
        var result = await sender.Send(OwnerChatId, text, caller.Token);

        Assert.True(result.Succeeded);
        Assert.Equal(42L, result.MessageId);
        Assert.Equal("POST", method);
        var uri = new Uri(url!);
        Assert.Equal("https", uri.Scheme);
        Assert.Equal("api.telegram.org", uri.Host);
        Assert.Equal(443, uri.Port);
        Assert.Equal($"/bot{BotToken}/sendMessage", uri.AbsolutePath);
        Assert.Equal("", uri.UserInfo);
        Assert.Equal("", uri.Query);
        Assert.Equal("", uri.Fragment);
        Assert.Equal("application/json", contentType);
        using var document = JsonDocument.Parse(json!);
        var root = document.RootElement;
        Assert.Equal(new[] { "chat_id", "link_preview_options", "text" }, root.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(JsonValueKind.Number, root.GetProperty("chat_id").ValueKind);
        Assert.Equal(OwnerChatId, root.GetProperty("chat_id").GetInt64());
        Assert.Equal(text, root.GetProperty("text").GetString());
        var preview = root.GetProperty("link_preview_options");
        Assert.Equal(new[] { "is_disabled" }, preview.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.True(preview.GetProperty("is_disabled").GetBoolean());
        Assert.DoesNotContain(BotToken, json!);
        Assert.DoesNotContain(headers!, name => name is "Authorization" or "traceparent" or "tracestate" or "baggage");
        Assert.True(requestCancellation.CanBeCanceled);
        Assert.NotEqual(caller.Token, requestCancellation);
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData(0L, "Sample")]
    [InlineData(-1L, "Sample")]
    [InlineData(-1001234567890L, "Sample")]
    [InlineData(OwnerChatId, "")]
    [InlineData(OwnerChatId, null)]
    public async Task Invalid_payloads_do_not_call_the_transport(long chatId, string? text)
    {
        using var handler = new FakeHandler((_, _) => throw new InvalidOperationException("Invalid payload must not reach HTTP."));
        using var sender = Sender(handler);
        AssertFailure(await sender.Send(chatId, text!, CancellationToken.None), OwnerNotificationFailure.InvalidPayload, permanent: true);
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData(4095, true)]
    [InlineData(4096, false)]
    [InlineData(4097, false)]
    public async Task Sender_accepts_only_text_strictly_below_the_message_limit(int length, bool valid)
    {
        using var handler = new FakeHandler((_, _) => Task.FromResult(Response(HttpStatusCode.OK, SuccessJson())));
        using var sender = Sender(handler);
        var result = await sender.Send(OwnerChatId, new string('x', length), CancellationToken.None);
        Assert.Equal(valid, result.Succeeded);
        Assert.Equal(valid ? 1 : 0, handler.Calls);
        if (!valid) AssertFailure(result, OwnerNotificationFailure.InvalidPayload, permanent: true);
    }

    [Theory]
    [InlineData(200)]
    [InlineData(201)]
    [InlineData(202)]
    public async Task Successful_HTTP_and_valid_ok_message_id_and_private_recipient_are_required(int status)
    {
        var result = await SendResponse((HttpStatusCode)status, SuccessJson(messageId: long.MaxValue));
        Assert.True(result.Succeeded);
        Assert.Equal(long.MaxValue, result.MessageId);
        Assert.False(result.Permanent);
    }

    public static IEnumerable<object[]> InvalidSuccessResponses()
    {
        foreach (var json in new[]
        {
            "", "not JSON", "null", "[]", "{}", "true", "{\"ok\":true}", "{\"ok\":false}",
            "{\"ok\":\"true\",\"result\":{\"message_id\":42}}",
            "{\"ok\":true,\"result\":null}", "{\"ok\":true,\"result\":[]}",
            "{\"ok\":true,\"result\":{}}", "{\"ok\":true,\"result\":{\"message_id\":0}}",
            "{\"ok\":true,\"result\":{\"message_id\":-1}}", "{\"ok\":true,\"result\":{\"message_id\":\"42\"}}",
            "{\"ok\":true,\"result\":{\"message_id\":1.5}}", "{\"ok\":true,\"result\":{\"message_id\":9223372036854775808}}",
            "{\"ok\":false,\"error_code\":999,\"description\":\"synthetic ambiguity\"}",
            SuccessJson() + "{}", SuccessJson()[..^1] + ",}"
        }) yield return new object[] { json };
        yield return new object[] { new string('[', 17) + "0" + new string(']', 17) };
    }

    [Theory]
    [MemberData(nameof(InvalidSuccessResponses))]
    public async Task Malformed_incomplete_or_unrecognized_responses_are_transient_not_acknowledged(string json)
    {
        AssertFailure(await SendResponse(HttpStatusCode.OK, json), OwnerNotificationFailure.InvalidResponse, permanent: false);
    }

    public static IEnumerable<object[]> AmbiguousResponses()
    {
        var valid = SuccessJson();
        yield return new object[] { valid.Replace("\"ok\":true", "\"ok\":false,\"ok\":true", StringComparison.Ordinal) };
        yield return new object[] { valid.Replace("\"message_id\":42", "\"message_id\":0,\"message_id\":42", StringComparison.Ordinal) };
        yield return new object[] { valid.Replace($"\"id\":{OwnerChatId}", $"\"id\":1,\"id\":{OwnerChatId}", StringComparison.Ordinal) };
        yield return new object[] { valid.Replace("\"type\":\"private\"", "\"type\":\"group\",\"type\":\"private\"", StringComparison.Ordinal) };
        yield return new object[] { "{\"ok\":true,\"result\":{},\"result\":" + valid[(valid.IndexOf("\"result\":", StringComparison.Ordinal) + 9)..] };
        yield return new object[] { valid[..^1] + ",\"error_code\":403}" };
        yield return new object[] { valid.Replace("\"ok\":true", "\"ok\":false", StringComparison.Ordinal) };
        yield return new object[] { "{\"ok\":false,\"error_code\":429,\"parameters\":{\"retry_after\":1,\"retry_after\":3600}}" };
    }

    [Theory]
    [MemberData(nameof(AmbiguousResponses))]
    public async Task Duplicate_or_contradictory_provider_fields_cannot_acknowledge_a_send(string json)
    {
        AssertFailure(await SendResponse(HttpStatusCode.OK, json), OwnerNotificationFailure.InvalidResponse, permanent: false);
    }

    public static IEnumerable<object[]> WrongRecipients()
    {
        foreach (var chat in new[]
        {
            "null", "{}", $"{{\"id\":{OwnerChatId}}}", $"{{\"type\":\"private\"}}",
            $"{{\"id\":{OwnerChatId},\"type\":\"group\"}}", $"{{\"id\":{OwnerChatId},\"type\":\"supergroup\"}}",
            $"{{\"id\":{OwnerChatId},\"type\":\"channel\"}}", $"{{\"id\":{OwnerChatId},\"type\":\"Private\"}}",
            $"{{\"id\":{OwnerChatId},\"type\":false}}", "{\"id\":1,\"type\":\"private\"}",
            "{\"id\":-1001234567890,\"type\":\"private\"}", $"{{\"id\":\"{OwnerChatId}\",\"type\":\"private\"}}",
            "{\"id\":9223372036854775808,\"type\":\"private\"}"
        }) yield return new object[] { $"{{\"ok\":true,\"result\":{{\"message_id\":42,\"chat\":{chat}}}}}" };
        yield return new object[] { "{\"ok\":true,\"result\":{\"message_id\":42}}" };
    }

    [Theory]
    [MemberData(nameof(WrongRecipients))]
    public async Task Missing_wrong_or_nonprivate_recipient_is_a_permanent_failure(string json)
    {
        AssertFailure(await SendResponse(HttpStatusCode.OK, json), OwnerNotificationFailure.RecipientMismatch, permanent: true);
    }

    [Theory]
    [InlineData(400, OwnerNotificationFailure.BadRequest)]
    [InlineData(401, OwnerNotificationFailure.Unauthorized)]
    [InlineData(403, OwnerNotificationFailure.Forbidden)]
    [InlineData(404, OwnerNotificationFailure.RequestRejected)]
    [InlineData(302, OwnerNotificationFailure.RequestRejected)]
    public async Task Permanent_HTTP_errors_and_redirects_are_not_successful_even_with_success_JSON(int status, OwnerNotificationFailure failure)
    {
        AssertFailure(await SendResponse((HttpStatusCode)status, SuccessJson()), failure, permanent: true);
    }

    [Theory]
    [InlineData(400, OwnerNotificationFailure.BadRequest, true)]
    [InlineData(401, OwnerNotificationFailure.Unauthorized, true)]
    [InlineData(403, OwnerNotificationFailure.Forbidden, true)]
    [InlineData(404, OwnerNotificationFailure.RequestRejected, true)]
    [InlineData(500, OwnerNotificationFailure.ProviderUnavailable, false)]
    public async Task Provider_error_codes_in_HTTP_OK_responses_are_typed_and_do_not_expose_descriptions(int errorCode, OwnerNotificationFailure failure, bool permanent)
    {
        var result = await SendResponse(HttpStatusCode.OK, JsonSerializer.Serialize(new { ok = false, error_code = errorCode, description = BotToken + " sample@example.com" }));
        AssertFailure(result, failure, permanent);
        Assert.DoesNotContain(BotToken, result.ToString());
        Assert.DoesNotContain("sample@example.com", result.ToString());
    }

    [Theory]
    [InlineData(408, OwnerNotificationFailure.Timeout)]
    [InlineData(500, OwnerNotificationFailure.ProviderUnavailable)]
    [InlineData(502, OwnerNotificationFailure.ProviderUnavailable)]
    [InlineData(503, OwnerNotificationFailure.ProviderUnavailable)]
    [InlineData(504, OwnerNotificationFailure.ProviderUnavailable)]
    public async Task HTTP_timeouts_and_provider_outages_are_transient_and_never_acknowledged(int status, OwnerNotificationFailure failure)
    {
        AssertFailure(await SendResponse((HttpStatusCode)status, SuccessJson()), failure, permanent: false);
    }

    [Theory]
    [InlineData(429)]
    [InlineData(200)]
    public async Task Rate_limit_retry_after_is_preserved_for_HTTP_and_provider_429(int status)
    {
        var result = await SendResponse((HttpStatusCode)status, "{\"ok\":false,\"error_code\":429,\"parameters\":{\"retry_after\":73}}");
        AssertFailure(result, OwnerNotificationFailure.RateLimited, permanent: false);
        Assert.Equal(73, result.RetryAfterSeconds);
        Assert.Equal(TimeSpan.FromSeconds(73), OwnerNotificationOutboxWorker.RetryDelay(1, result));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("not JSON")]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("{\"ok\":true,\"error_code\":403}")]
    [InlineData("{\"ok\":false,\"result\":{\"message_id\":42}}")]
    [InlineData("{\"parameters\":{\"retry_after\":0}}")]
    [InlineData("{\"parameters\":{\"retry_after\":-1}}")]
    [InlineData("{\"parameters\":{\"retry_after\":\"60\"}}")]
    [InlineData("{\"parameters\":{\"retry_after\":1.5}}")]
    [InlineData("{\"parameters\":{\"retry_after\":2147483648}}")]
    public async Task HTTP_429_without_valid_retry_after_stays_rate_limited_and_uses_bounded_backoff(string json)
    {
        var result = await SendResponse(HttpStatusCode.TooManyRequests, json);
        AssertFailure(result, OwnerNotificationFailure.RateLimited, permanent: false);
        Assert.Null(result.RetryAfterSeconds);
        Assert.Equal(TimeSpan.FromSeconds(30), OwnerNotificationOutboxWorker.RetryDelay(2, result));
    }

    [Theory]
    [InlineData(0, 15)]
    [InlineData(1, 15)]
    [InlineData(2, 30)]
    [InlineData(3, 60)]
    [InlineData(8, 1920)]
    [InlineData(9, 3600)]
    [InlineData(10, 3600)]
    [InlineData(int.MaxValue, 3600)]
    public void Retry_delay_is_exponential_and_capped_at_one_hour_without_waiting(int attempt, int seconds)
    {
        Assert.Equal(TimeSpan.FromSeconds(seconds), OwnerNotificationOutboxWorker.RetryDelay(attempt, new(null, OwnerNotificationFailure.NetworkError)));
    }

    [Fact]
    public void Rate_limit_delay_honors_provider_seconds_even_above_the_exponential_backoff_cap()
    {
        Assert.Equal(TimeSpan.FromSeconds(7200), OwnerNotificationOutboxWorker.RetryDelay(10, new(null, OwnerNotificationFailure.RateLimited, 7200)));
        Assert.Equal(TimeSpan.FromSeconds(15), OwnerNotificationOutboxWorker.RetryDelay(1, new(null, OwnerNotificationFailure.RateLimited, -1)));
        Assert.Equal(TimeSpan.FromSeconds(30), OwnerNotificationOutboxWorker.RetryDelay(2, new(null, OwnerNotificationFailure.NetworkError, 7200)));
    }

    [Theory]
    [InlineData(false, OwnerNotificationFailure.NetworkError)]
    [InlineData(true, OwnerNotificationFailure.Timeout)]
    public async Task Throwing_transport_maps_network_or_simulated_timeout_to_safe_typed_result_without_retries(bool timeout, OwnerNotificationFailure failure)
    {
        using var handler = new FakeHandler((_, _) => timeout
            ? Task.FromException<HttpResponseMessage>(new OperationCanceledException("Synthetic timeout " + BotToken))
            : Task.FromException<HttpResponseMessage>(new HttpRequestException("Synthetic failure " + BotToken + " sample@example.com")));
        using var sender = Sender(handler);
        var result = await sender.Send(OwnerChatId, "Sample", CancellationToken.None);
        AssertFailure(result, failure, permanent: false);
        Assert.DoesNotContain(BotToken, result.ToString());
        Assert.DoesNotContain("sample@example.com", result.ToString());
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Caller_cancellation_before_send_is_propagated_without_HTTP()
    {
        using var caller = new CancellationTokenSource();
        caller.Cancel();
        using var handler = new FakeHandler((_, _) => throw new InvalidOperationException("Canceled sending must not invoke HTTP."));
        using var sender = Sender(handler);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sender.Send(OwnerChatId, "Sample", caller.Token));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Caller_cancellation_during_send_is_linked_and_not_converted_to_a_retry()
    {
        using var caller = new CancellationTokenSource();
        CancellationToken observed = default;
        using var handler = new FakeHandler((_, ct) =>
        {
            observed = ct;
            caller.Cancel();
            ct.ThrowIfCancellationRequested();
            throw new InvalidOperationException("Linked cancellation was not observed.");
        });
        using var sender = Sender(handler);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sender.Send(OwnerChatId, "Sample", caller.Token));
        Assert.True(observed.IsCancellationRequested);
        Assert.NotEqual(caller.Token, observed);
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData(200, OwnerNotificationFailure.ResponseTooLarge)]
    [InlineData(429, OwnerNotificationFailure.RateLimited)]
    public async Task Oversized_content_length_is_rejected_before_any_response_body_read(int status, OwnerNotificationFailure failure)
    {
        var stream = new TrackedStream(new byte[1]);
        using var handler = new FakeHandler((_, _) =>
        {
            var response = new HttpResponseMessage((HttpStatusCode)status) { Content = new StreamContent(stream) };
            response.Content.Headers.ContentLength = TelegramOwnerNotificationSender.MaximumResponseBytes + 1L;
            return Task.FromResult(response);
        });
        using var sender = Sender(handler);
        var result = await sender.Send(OwnerChatId, "Sample", CancellationToken.None);
        AssertFailure(result, failure, permanent: false);
        Assert.Equal(0, stream.BytesRead);
        Assert.True(stream.Disposed);
    }

    [Theory]
    [InlineData(200, OwnerNotificationFailure.ResponseTooLarge)]
    [InlineData(429, OwnerNotificationFailure.RateLimited)]
    public async Task Unknown_length_response_reads_at_most_the_bound_plus_one_sentinel_byte(int status, OwnerNotificationFailure failure)
    {
        var stream = new TrackedStream(new byte[TelegramOwnerNotificationSender.MaximumResponseBytes * 4], chunkSize: 997);
        using var handler = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)status) { Content = new StreamContent(stream) }));
        using var sender = Sender(handler);
        var result = await sender.Send(OwnerChatId, "Sample", CancellationToken.None);
        AssertFailure(result, failure, permanent: false);
        Assert.Equal(TelegramOwnerNotificationSender.MaximumResponseBytes + 1, stream.BytesRead);
        Assert.True(stream.ReadCalls > 1);
        Assert.True(stream.LastCancellation.CanBeCanceled);
        Assert.True(stream.Disposed);
    }

    [Fact]
    public async Task Exactly_bounded_valid_JSON_response_is_accepted_and_consumed_without_truncation()
    {
        var json = SuccessJson();
        var bytes = Encoding.UTF8.GetBytes(json + new string(' ', TelegramOwnerNotificationSender.MaximumResponseBytes - Encoding.UTF8.GetByteCount(json)));
        var stream = new TrackedStream(bytes, chunkSize: 113);
        using var handler = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(stream) }));
        using var sender = Sender(handler);
        var result = await sender.Send(OwnerChatId, "Sample", CancellationToken.None);
        Assert.True(result.Succeeded);
        Assert.Equal(42L, result.MessageId);
        Assert.Equal(TelegramOwnerNotificationSender.MaximumResponseBytes, stream.BytesRead);
        Assert.True(stream.Disposed);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(401)]
    [InlineData(403)]
    [InlineData(408)]
    [InlineData(500)]
    public async Task Definitive_HTTP_failures_do_not_consume_untrusted_response_bodies(int status)
    {
        var stream = new TrackedStream(new byte[100]);
        using var handler = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)status) { Content = new StreamContent(stream) }));
        using var sender = Sender(handler);
        Assert.False((await sender.Send(OwnerChatId, "Sample", CancellationToken.None)).Succeeded);
        Assert.Equal(0, stream.BytesRead);
        Assert.True(stream.Disposed);
    }

    [Theory]
    [InlineData(200, false, OwnerNotificationFailure.NetworkError)]
    [InlineData(200, true, OwnerNotificationFailure.Timeout)]
    [InlineData(429, false, OwnerNotificationFailure.RateLimited)]
    [InlineData(429, true, OwnerNotificationFailure.RateLimited)]
    public async Task Response_read_failures_preserve_known_rate_limits_without_waiting(int status, bool timeout, OwnerNotificationFailure failure)
    {
        var stream = new TrackedStream(Encoding.UTF8.GetBytes(SuccessJson()), onRead: _ => throw (timeout
            ? new OperationCanceledException("Synthetic response timeout " + BotToken)
            : new IOException("Synthetic response failure " + BotToken)));
        using var handler = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)status) { Content = new StreamContent(stream) }));
        using var sender = Sender(handler);
        var result = await sender.Send(OwnerChatId, "Sample", CancellationToken.None);
        AssertFailure(result, failure, permanent: false);
        Assert.DoesNotContain(BotToken, result.ToString());
        Assert.True(stream.Disposed);
    }

    [Fact]
    public async Task Caller_cancellation_during_bounded_response_read_is_propagated_and_disposes_the_body()
    {
        using var caller = new CancellationTokenSource();
        var stream = new TrackedStream(Encoding.UTF8.GetBytes(SuccessJson()), onRead: _ => caller.Cancel());
        using var handler = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(stream) }));
        using var sender = Sender(handler);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sender.Send(OwnerChatId, "Sample", caller.Token));
        Assert.True(stream.LastCancellation.IsCancellationRequested);
        Assert.True(stream.Disposed);
    }

    [Fact]
    public void Handler_disables_URL_activity_propagation_redirects_cookies_and_response_draining()
    {
        using var handler = TelegramOwnerNotificationSender.CreateHandler();
        Assert.Null(handler.ActivityHeadersPropagator);
        Assert.False(handler.AllowAutoRedirect);
        Assert.False(handler.UseCookies);
        Assert.Equal(TimeSpan.FromSeconds(15), handler.ConnectTimeout);
        Assert.Equal(0, handler.MaxResponseDrainSize);
        Assert.Equal(65536, TelegramOwnerNotificationSender.MaximumResponseBytes);
        Assert.Equal(4096, OwnerOrderNotifications.MessageLimit);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Synthetic_token_is_absent_from_application_factory_logs_HTTP_diagnostics_spans_and_RequestStart(bool socketsHandler)
    {
        using var telemetry = new HttpTelemetryCapture();
        using var logs = new RecordingLoggerProvider();
        var services = new ServiceCollection();
        services.AddLogging(logging => logging.ClearProviders().SetMinimumLevel(LogLevel.Trace).AddProvider(logs));
        services.AddHttpClient("safe-telemetry-control").ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
        {
            UseProxy = false,
            ConnectCallback = (_, _) => ValueTask.FromException<Stream>(new IOException("Synthetic control connection rejected before network."))
        });
        using var serviceProvider = services.BuildServiceProvider();
        using var control = serviceProvider.GetRequiredService<IHttpClientFactory>().CreateClient("safe-telemetry-control");
        await Assert.ThrowsAsync<HttpRequestException>(() => control.GetAsync(Origin + "/notification-telemetry-control"));
        Assert.Contains(logs.Messages, message => message.Contains("System.Net.Http.HttpClient.safe-telemetry-control", StringComparison.Ordinal) && message.Contains("example.com", StringComparison.Ordinal));
        Assert.Contains(telemetry.Diagnostics, value => value.Contains("example.com", StringComparison.Ordinal));
        Assert.Contains(telemetry.Activities, activity => activity.Source == "System.Net.Http" && activity.Text.Contains("example.com", StringComparison.Ordinal));
        Assert.Contains(telemetry.Events, value => value.Source == "System.Net.Http" && value.Name == "RequestStart" && value.Text.Contains("example.com", StringComparison.Ordinal));

        var calls = 0;
        string? connectHost = null;
        int connectPort = 0;
        string[]? requestHeaders = null;
        HttpMessageHandler transport;
        if (socketsHandler)
        {
            var sockets = TelegramOwnerNotificationSender.CreateHandler();
            sockets.UseProxy = false;
            sockets.ConnectCallback = (context, _) =>
            {
                Interlocked.Increment(ref calls);
                connectHost = context.DnsEndPoint.Host;
                connectPort = context.DnsEndPoint.Port;
                requestHeaders = context.InitialRequestMessage.Headers.Select(header => header.Key).ToArray();
                return ValueTask.FromException<Stream>(new IOException("Synthetic connection rejected before DNS, TLS or network."));
            };
            transport = sockets;
        }
        else
        {
            transport = new FakeHandler((request, _) =>
            {
                Interlocked.Increment(ref calls);
                requestHeaders = request.Headers.Select(header => header.Key).ToArray();
                return Task.FromException<HttpResponseMessage>(new HttpRequestException("Synthetic error " + BotToken));
            });
        }
        using var sender = Sender(transport);
        using var parent = new Activity("notification-caller").Start();
        parent.AddBaggage("sample-context", "synthetic-value");
        AssertFailure(await sender.Send(OwnerChatId, "Sample customer at sample@example.com", CancellationToken.None), OwnerNotificationFailure.NetworkError, permanent: false);
        Assert.Equal(1, calls);
        if (socketsHandler)
        {
            Assert.Equal("api.telegram.org", connectHost);
            Assert.Equal(443, connectPort);
        }
        var internalEvents = telemetry.Events.Where(value => value.Source == "Private.InternalDiagnostics.System.Net.Http").ToArray();
        var internalTokenEvents = internalEvents.Count(value => value.Text.Contains(BotToken, StringComparison.Ordinal));
        output.WriteLine("Opt-in private runtime HTTP diagnostics: {0} events, {1} synthetic-token events. Fail-before-network coverage cannot establish safety for low-level runtime request/byte dumps.", internalEvents.Length, internalTokenEvents);
        Assert.DoesNotContain(requestHeaders!, name => name is "traceparent" or "tracestate" or "baggage" or "Authorization");
        Assert.All(logs.Messages, message => Assert.DoesNotContain(BotToken, message));
        Assert.All(telemetry.Diagnostics, value => Assert.DoesNotContain(BotToken, value));
        Assert.All(telemetry.Activities, activity => Assert.DoesNotContain(BotToken, activity.Text));
        Assert.All(telemetry.Events.Where(value => value.Source == "System.Net.Http"), value => Assert.DoesNotContain(BotToken, value.Text));
        Assert.DoesNotContain(telemetry.Events, value => value.Source == "System.Net.Http" && value.Name == "RequestStart" && value.Text.Contains("api.telegram.org", StringComparison.Ordinal));
        Assert.DoesNotContain(telemetry.Activities, activity => activity.Source == "System.Net.Http" && activity.Text.Contains("api.telegram.org", StringComparison.Ordinal));

    }

    private static IConfigurationRoot Configuration(string? enabled = "true", string? token = BotToken, string? chat = "4294967296") => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Mail:Enabled"] = "true",
        ["OwnerNotifications:Enabled"] = enabled,
        ["Telegram:BotToken"] = token,
        ["Telegram:OwnerChatId"] = chat,
        ["Storefront:Origin"] = Origin + "/"
    }).Build();

    private static OwnerOrderNotifications Builder(IConfiguration? configuration = null, IDataProtectionProvider? protection = null)
    {
        configuration ??= Configuration();
        return new(protection ?? new EphemeralDataProtectionProvider(), OwnerNotificationSettings.Read(configuration), configuration);
    }

    private static TelegramOwnerNotificationSender Sender(HttpMessageHandler handler) => new(OwnerNotificationSettings.Read(Configuration()), handler);

    private static HttpResponseMessage Response(HttpStatusCode status, string json) => new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static string SuccessJson(long chatId = OwnerChatId, long messageId = 42) => JsonSerializer.Serialize(new { ok = true, result = new { message_id = messageId, chat = new { id = chatId, type = "private" } } });

    private static async Task<OwnerNotificationSendResult> SendResponse(HttpStatusCode status, string json)
    {
        using var handler = new FakeHandler((_, _) => Task.FromResult(Response(status, json)));
        using var sender = Sender(handler);
        var result = await sender.Send(OwnerChatId, "Sample", CancellationToken.None);
        Assert.Equal(1, handler.Calls);
        return result;
    }

    private static void AssertFailure(OwnerNotificationSendResult result, OwnerNotificationFailure failure, bool permanent)
    {
        Assert.False(result.Succeeded);
        Assert.Null(result.MessageId);
        Assert.Equal(failure, result.Failure);
        Assert.Equal(permanent, result.Permanent);
        Assert.Matches("^[a-z_]{1,40}$", result.SafeCode);
        Assert.DoesNotContain(BotToken, result.SafeCode);
    }

    private static void AssertField(string text, string label, string value) => Assert.Contains(label + " (provided text):\n" + string.Concat(value.Split('\n').Select(line => "  | " + line + "\n")), text);

    private static void AssertContactAndAddress(Order order, string text)
    {
        AssertField(text, "Name", order.Contact.Name);
        AssertField(text, "Phone", order.Contact.Phone);
        AssertField(text, "Email", order.Contact.Email);
        AssertField(text, "Delivery street", order.DeliveryAddress.Street);
        AssertField(text, "Area", order.DeliveryAddress.Area);
        AssertField(text, "City", order.DeliveryAddress.City);
        AssertField(text, "District", order.DeliveryAddress.District);
        AssertField(text, "Postcode", order.DeliveryAddress.Postcode!);
    }

    private static string Body(OwnerNotificationPayload payload) => string.Concat(payload.Parts.Select(PartBody));

    private static string PartBody(string part)
    {
        var firstNewline = part.IndexOf('\n');
        var secondNewline = part.IndexOf('\n', firstNewline + 1);
        Assert.True(firstNewline >= 0 && secondNewline > firstNewline);
        return part[(secondNewline + 1)..];
    }

    private static void AssertParts(OwnerNotificationPayload payload)
    {
        Assert.NotEmpty(payload.Parts);
        for (var index = 0; index < payload.Parts.Length; index++)
        {
            var part = payload.Parts[index];
            Assert.InRange(part.Length, 1, OwnerOrderNotifications.MessageLimit - 1);
            Assert.StartsWith($"Order {payload.OrderNumber} | Part {index + 1}/{payload.Parts.Length}\nAwaiting manual confirmation/payment.\n", part);
            for (var offset = 0; offset < part.Length; offset++)
            {
                if (char.IsHighSurrogate(part[offset]))
                {
                    Assert.True(offset + 1 < part.Length && char.IsLowSurrogate(part[offset + 1]), "No part may end with or contain an unpaired high surrogate.");
                    offset++;
                }
                else Assert.False(char.IsLowSurrogate(part[offset]), "No part may start with or contain an unpaired low surrogate.");
            }
        }
    }

    private static Order SampleOrder()
    {
        var order = new Order
        {
            Id = Guid.Parse("10000000-0000-0000-0000-000000000042"),
            Number = "EM-20261029-000042",
            CreatedAt = new DateTime(2026, 10, 29, 12, 34, 56, DateTimeKind.Utc),
            QuoteId = Guid.Parse("20000000-0000-0000-0000-000000000042"),
            AccountId = Guid.Parse("30000000-0000-0000-0000-000000000042"),
            CheckoutOwner = "checkout-owner-test-only",
            NormalizedEmail = "normalized-only@example.com",
            Contact = new("Sample Customer", "sample@example.com", "+8801712345678"),
            DeliveryAddress = new("123 Sample Road", "Sample Area", "Sample City", "Dhaka", "1212"),
            Money = new("BDT", 3238m, 80m, 3318m, "bdt-cod-v1"),
            Notes = "Call before delivery.",
            Events = [new() { ActorId = Guid.Parse("40000000-0000-0000-0000-000000000042"), Action = "private-proof-event-test", Note = "guest-capability-test|email-proof-test|claim-proof-test" }]
        };
        order.Lines =
        [
            new() { OrderId = order.Id, ProductId = Guid.Parse("50000000-0000-0000-0000-000000000042"), Name = "Sample cable", Slug = "sample-cable-private-metadata", UnitPrice = 80m, Quantity = 3, LineTotal = 240m, Position = 1 },
            new() { OrderId = order.Id, ProductId = Guid.Parse("60000000-0000-0000-0000-000000000042"), Name = "Sample headphones", Slug = "sample-headphones", UnitPrice = 1499m, Quantity = 2, LineTotal = 2998m, Position = 0 }
        ];
        return order;
    }

    private sealed class FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return send(request, cancellationToken);
        }
    }

    private sealed class TrackedStream(byte[] bytes, int chunkSize = int.MaxValue, Action<CancellationToken>? onRead = null) : Stream
    {
        public int BytesRead { get; private set; }
        public int ReadCalls { get; private set; }
        public bool Disposed { get; private set; }
        public CancellationToken LastCancellation { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => BytesRead; set => throw new NotSupportedException(); }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            ReadCalls++;
            LastCancellation = cancellationToken;
            onRead?.Invoke(cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            var count = Math.Min(Math.Min(buffer.Length, chunkSize), bytes.Length - BytesRead);
            bytes.AsMemory(BytesRead, count).CopyTo(buffer);
            BytesRead += count;
            return ValueTask.FromResult(count);
        }

        public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer.AsMemory(offset, count)).GetAwaiter().GetResult();
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            Disposed = true;
            base.Dispose(disposing);
        }
    }

    private sealed class RecordingLoggerProvider : ILoggerProvider
    {
        public ConcurrentQueue<string> Messages { get; } = new();
        public ILogger CreateLogger(string categoryName) => new RecordingLogger(categoryName, Messages);
        public void Dispose() { }

        private sealed class RecordingLogger(string category, ConcurrentQueue<string> messages) : ILogger
        {
            public bool IsEnabled(LogLevel logLevel) => true;
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull
            {
                messages.Enqueue(category + " scope " + RenderState(state));
                return null;
            }
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => messages.Enqueue(category + " " + formatter(state, exception) + " " + RenderState(state) + " " + exception);
            private static string RenderState<TState>(TState state) => state is IEnumerable<KeyValuePair<string, object?>> properties
                ? string.Join(";", properties.Select(property => property.Key + "=" + property.Value)) : state?.ToString() ?? "";
        }
    }

    private sealed record CapturedHttpEvent(string Source, string Name, string Text);
    private sealed record CapturedActivity(string Source, string Text);

    private sealed class HttpTelemetryCapture : IDisposable, IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>
    {
        private readonly ConcurrentBag<IDisposable> _diagnosticSubscriptions = new();
        private readonly HttpEventCapture _events = new();
        private readonly ActivityListener _activities;
        private readonly IDisposable _allListeners;
        public ConcurrentQueue<string> Diagnostics { get; } = new();
        public ConcurrentQueue<CapturedActivity> Activities { get; } = new();
        public IEnumerable<CapturedHttpEvent> Events => _events.Events;

        public HttpTelemetryCapture()
        {
            _activities = new ActivityListener
            {
                ShouldListenTo = source => source.Name.Contains("System.Net.Http", StringComparison.Ordinal),
                Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
                SampleUsingParentId = (ref ActivityCreationOptions<string> _) => ActivitySamplingResult.AllDataAndRecorded,
                ActivityStopped = activity => Activities.Enqueue(new(activity.Source.Name, activity.DisplayName + " " + activity.OperationName + " " + string.Join(";", activity.TagObjects.Select(tag => tag.Key + "=" + tag.Value)) + " " + string.Join(";", activity.Events.Select(value => value.Name + " " + string.Join(";", value.Tags.Select(tag => tag.Key + "=" + tag.Value))))))
            };
            ActivitySource.AddActivityListener(_activities);
            _allListeners = DiagnosticListener.AllListeners.Subscribe(this);
        }

        public void OnNext(DiagnosticListener value)
        {
            if (value.Name.Contains("Http", StringComparison.Ordinal)) _diagnosticSubscriptions.Add(value.Subscribe(this));
        }

        public void OnNext(KeyValuePair<string, object?> value)
        {
            var properties = value.Value?.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance) ?? [];
            Diagnostics.Enqueue(value.Key + " " + string.Join(";", properties.Where(property => property.GetIndexParameters().Length == 0).Select(property => property.Name + "=" + property.GetValue(value.Value))));
        }

        public void OnCompleted() { }
        public void OnError(Exception error) { }
        public void Dispose()
        {
            _allListeners.Dispose();
            foreach (var subscription in _diagnosticSubscriptions) subscription.Dispose();
            _activities.Dispose();
            _events.Dispose();
        }

        private sealed class HttpEventCapture : EventListener
        {
            public ConcurrentQueue<CapturedHttpEvent> Events { get; } = new();
            protected override void OnEventSourceCreated(EventSource eventSource)
            {
                if (eventSource.Name is "System.Net.Http" or "Private.InternalDiagnostics.System.Net.Http") EnableEvents(eventSource, EventLevel.Verbose, EventKeywords.All);
            }
            protected override void OnEventWritten(EventWrittenEventArgs eventData) => Events?.Enqueue(new(eventData.EventSource.Name, eventData.EventName ?? "", string.Join(";", eventData.PayloadNames?.Zip(eventData.Payload ?? [], (name, value) => name + "=" + value) ?? [])));
        }
    }
}
