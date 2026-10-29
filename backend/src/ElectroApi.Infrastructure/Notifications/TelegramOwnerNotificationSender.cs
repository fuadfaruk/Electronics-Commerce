using System.Net.Http.Json;
using System.Text.Json;

namespace ElectroApi.Infrastructure.Notifications;

public enum OwnerNotificationFailure
{
    None, Disabled, InvalidPayload, BadRequest, Unauthorized, Forbidden, RequestRejected,
    RateLimited, ProviderUnavailable, NetworkError, Timeout, InvalidResponse, ResponseTooLarge, RecipientMismatch
}

public sealed record OwnerNotificationSendResult(long? MessageId, OwnerNotificationFailure Failure = OwnerNotificationFailure.None, int? RetryAfterSeconds = null)
{
    public bool Succeeded => MessageId > 0 && Failure == OwnerNotificationFailure.None;
    public bool Permanent => Failure is OwnerNotificationFailure.Disabled or OwnerNotificationFailure.InvalidPayload or OwnerNotificationFailure.BadRequest or OwnerNotificationFailure.Unauthorized or OwnerNotificationFailure.Forbidden or OwnerNotificationFailure.RequestRejected or OwnerNotificationFailure.RecipientMismatch;
    public string SafeCode => Failure switch
    {
        OwnerNotificationFailure.Disabled => "notifications_disabled",
        OwnerNotificationFailure.InvalidPayload => "invalid_payload",
        OwnerNotificationFailure.BadRequest => "telegram_bad_request",
        OwnerNotificationFailure.Unauthorized => "telegram_unauthorized",
        OwnerNotificationFailure.Forbidden => "telegram_forbidden",
        OwnerNotificationFailure.RequestRejected => "telegram_request_rejected",
        OwnerNotificationFailure.RateLimited => "telegram_rate_limited",
        OwnerNotificationFailure.ProviderUnavailable => "telegram_unavailable",
        OwnerNotificationFailure.NetworkError => "telegram_network",
        OwnerNotificationFailure.Timeout => "telegram_timeout",
        OwnerNotificationFailure.ResponseTooLarge => "telegram_response_too_large",
        OwnerNotificationFailure.RecipientMismatch => "telegram_recipient_mismatch",
        _ => "telegram_invalid_response"
    };
}

public interface IOwnerNotificationSender
{
    Task<OwnerNotificationSendResult> Send(long chatId, string text, CancellationToken ct);
}

public sealed class TelegramOwnerNotificationSender(OwnerNotificationSettings settings, HttpMessageHandler handler) : DelegatingHandler(handler), IOwnerNotificationSender
{
    public const int MaximumResponseBytes = 65536;

    public static SocketsHttpHandler CreateHandler() => new()
    {
        // Direct handler dispatch avoids client/invoker URL telemetry and factory loggers.
        ActivityHeadersPropagator = null,
        AllowAutoRedirect = false,
        UseCookies = false,
        ConnectTimeout = TimeSpan.FromSeconds(15),
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        MaxResponseHeadersLength = 16,
        MaxResponseDrainSize = 0
    };

    public async Task<OwnerNotificationSendResult> Send(long chatId, string text, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (!settings.Enabled) return new(null, OwnerNotificationFailure.Disabled);
        if (chatId <= 0 || string.IsNullOrEmpty(text) || text.Length >= OwnerOrderNotifications.MessageLimit) return new(null, OwnerNotificationFailure.InvalidPayload);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        var status = 0;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.telegram.org/bot" + settings.BotToken + "/sendMessage")
            {
                Content = JsonContent.Create(new { chat_id = chatId, text, link_preview_options = new { is_disabled = true } })
            };
            using var response = await base.SendAsync(request, timeout.Token);
            status = (int)response.StatusCode;
            if (status is 400 or 401 or 403 || status is >= 300 and < 500 && status is not (408 or 429)) return Error(status);
            if (status is >= 500 and <= 599) return new(null, OwnerNotificationFailure.ProviderUnavailable);
            if (status == 408) return new(null, OwnerNotificationFailure.Timeout);
            var bytes = new byte[MaximumResponseBytes + 1];
            var count = 0;
            if (response.Content.Headers.ContentLength > MaximumResponseBytes) return new(null, status == 429 ? OwnerNotificationFailure.RateLimited : OwnerNotificationFailure.ResponseTooLarge);
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            while (count < bytes.Length)
            {
                var read = await stream.ReadAsync(bytes.AsMemory(count), timeout.Token);
                if (read == 0) break;
                count += read;
            }
            if (count > MaximumResponseBytes) return new(null, status == 429 ? OwnerNotificationFailure.RateLimited : OwnerNotificationFailure.ResponseTooLarge);
            using var json = JsonDocument.Parse(bytes.AsMemory(0, count), new JsonDocumentOptions { MaxDepth = 16, AllowDuplicateProperties = false });
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return new(null, status == 429 ? OwnerNotificationFailure.RateLimited : OwnerNotificationFailure.InvalidResponse);
            var hasOk = root.TryGetProperty("ok", out var ok);
            if ((hasOk && ok.ValueKind == JsonValueKind.True && root.TryGetProperty("error_code", out _)) ||
                (hasOk && ok.ValueKind == JsonValueKind.False && root.TryGetProperty("result", out _)))
                return new(null, OwnerNotificationFailure.InvalidResponse);
            if (status == 429 || root.TryGetProperty("error_code", out var error) && error.ValueKind == JsonValueKind.Number && error.TryGetInt32(out var code) && code == 429)
            {
                int? retry = null;
                if (root.TryGetProperty("parameters", out var parameters) && parameters.ValueKind == JsonValueKind.Object &&
                    parameters.TryGetProperty("retry_after", out var after) && after.ValueKind == JsonValueKind.Number && after.TryGetInt32(out var seconds) && seconds > 0) retry = seconds;
                return new(null, OwnerNotificationFailure.RateLimited, retry);
            }
            if (!response.IsSuccessStatusCode) return new(null, OwnerNotificationFailure.InvalidResponse);
            if (!hasOk || ok.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return new(null, OwnerNotificationFailure.InvalidResponse);
            if (ok.ValueKind == JsonValueKind.False)
            {
                if (root.TryGetProperty("error_code", out var errorCode) && errorCode.ValueKind == JsonValueKind.Number && errorCode.TryGetInt32(out var providerCode)) return Error(providerCode);
                return new(null, OwnerNotificationFailure.InvalidResponse);
            }
            if (!root.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty("message_id", out var message) || message.ValueKind != JsonValueKind.Number || !message.TryGetInt64(out var messageId) || messageId <= 0)
                return new(null, OwnerNotificationFailure.InvalidResponse);
            if (!result.TryGetProperty("chat", out var chat) || chat.ValueKind != JsonValueKind.Object ||
                !chat.TryGetProperty("id", out var recipient) || recipient.ValueKind != JsonValueKind.Number || !recipient.TryGetInt64(out var recipientId) || recipientId != chatId ||
                !chat.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "private")
                return new(null, OwnerNotificationFailure.RecipientMismatch);
            return new(messageId);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new(null, OwnerNotificationFailure.Timeout); }
        catch (JsonException) { return new(null, status == 429 ? OwnerNotificationFailure.RateLimited : OwnerNotificationFailure.InvalidResponse); }
        catch (Exception) when (!ct.IsCancellationRequested) { return new(null, OwnerNotificationFailure.NetworkError); }
    }

    private static OwnerNotificationSendResult Error(int code) => new(null, code switch
    {
        400 => OwnerNotificationFailure.BadRequest,
        401 => OwnerNotificationFailure.Unauthorized,
        403 => OwnerNotificationFailure.Forbidden,
        408 => OwnerNotificationFailure.Timeout,
        429 => OwnerNotificationFailure.RateLimited,
        >= 500 and <= 599 => OwnerNotificationFailure.ProviderUnavailable,
        >= 300 and < 500 => OwnerNotificationFailure.RequestRejected,
        _ => OwnerNotificationFailure.InvalidResponse
    });
}
