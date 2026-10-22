using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;

namespace ElectroApi.Api.Security;

public sealed class OrderAccess(CommerceSecurity security, ApplicationDbContext db)
{
    public async Task<OrderDto> Read(HttpContext context, Guid id, bool accountOnly = false)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, context.RequestAborted);
        // Claim revocation and this private snapshot share one authorization/serialization boundary.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Orders WHERE Id = {id.ToString()} FOR UPDATE", context.RequestAborted);
        var order = await db.Orders.AsNoTracking().Include(o => o.Lines).Include(o => o.Events).AsSplitQuery().SingleOrDefaultAsync(o => o.Id == id, context.RequestAborted);
        await Require(context, order, accountOnly);
        var response = CommerceRepository.Map(order!);
        await transaction.CommitAsync(context.RequestAborted);
        return response;
    }
    private async Task Require(HttpContext context, Order? order, bool accountOnly)
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
