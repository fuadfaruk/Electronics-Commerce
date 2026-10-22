using ElectroApi.Core;
using ElectroApi.Core.Entities;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;

namespace ElectroApi.Api.Security;

public sealed class OrderAccess(CommerceSecurity security, ApplicationDbContext db)
{
    public async Task Require(HttpContext context, Order? order, bool accountOnly = false)
    {
        if (order is null) throw new CommerceException(404, "not_found", "Order unavailable.");
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var account = await security.RequireAccount(context);
            if (order.AccountId == account.Id) return;
        }
        else if (!accountOnly && order.AccountId == null)
        {
            if (context.Request.Cookies.ContainsKey(CommerceSecurity.AuthCookie)) throw new CommerceException(401, "session_expired", "Your account session expired. Sign in again.");
            if (context.Request.Cookies.ContainsKey(CommerceSecurity.GuestCookie))
            {
                try { if ((await security.Owner(context)).Key == order.CheckoutOwner) return; }
                catch (CommerceException exception) when (exception.Status == 401) { }
            }
            var cookie = context.Request.Cookies["ElectroMart.Grant." + order.Id.ToString("N")];
            if (cookie is { Length: 43 })
            {
                var hash = CommerceRepository.Hash(cookie); var now = DateTime.UtcNow;
                if (await db.GuestGrants.AsNoTracking().AnyAsync(g => g.OrderId == order.Id && g.TokenHash == hash && g.ExpiresAt > now && g.RevokedAt == null, context.RequestAborted)) return;
            }
        }
        throw new CommerceException(404, "not_found", "Order unavailable.");
    }
}
