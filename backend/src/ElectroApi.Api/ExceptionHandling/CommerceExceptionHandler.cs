using System.Data.Common;
using ElectroApi.Core;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace ElectroApi.Api.ExceptionHandling;

public sealed class CommerceExceptionHandler(ILogger<CommerceExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        var commerce = exception as CommerceException;
        var mysql = exception as MySqlException ?? exception.InnerException as MySqlException;
        var status = commerce?.Status ?? (exception is DbUpdateConcurrencyException ? 409 : mysql?.Number is 1062 or 1451 or 1452 or 3819 ? 409 : exception is DbException || mysql is not null ? 503 : 500);
        var code = commerce?.Code ?? (status == 409 ? "stale_version" : status == 503 ? "temporarily_unavailable" : "internal_error");
        var detail = commerce?.Message ?? (status == 409 ? "This record changed or conflicts with another record. Reload before trying again." : "The service is temporarily unavailable. Try again later.");
        logger.LogWarning("Request failed with safe code {Code}; correlation {TraceId}.", code, context.TraceIdentifier);
        context.Response.StatusCode = status; context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new { code, title = "Request could not be completed", detail, status, traceId = context.TraceIdentifier }, ct);
        return true;
    }
}
