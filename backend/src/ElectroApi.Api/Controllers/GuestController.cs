using ElectroApi.Api.Security;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ElectroApi.Api.Controllers;

[ApiController, AllowAnonymous, EnableRateLimiting("auth"), Route("api/v1/Guest")]
public sealed class GuestController(ApplicationDbContext db, CommerceSecurity security) : ControllerBase
{
    [HttpPost("exchange")]
    public async Task<IActionResult> Exchange(GuestExchange request, CancellationToken ct)
    {
        var hash = CommerceRepository.Hash(request.Capability);
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Orders WHERE Id = {request.OrderId.ToString()} FOR UPDATE", ct);
        var order = await db.Orders.AsNoTracking().SingleOrDefaultAsync(o => o.Id == request.OrderId, ct);
        var now = DateTime.UtcNow;
        CommerceRules.Require(order is { AccountId: null } && await db.GuestCapabilities.AnyAsync(g => g.OrderId == request.OrderId && g.TokenHash == hash && g.RevokedAt == null && g.ExpiresAt > now, ct), "proof_invalid", "The private order link is invalid or expired.", 400);
        var grant = CommerceRepository.NewToken();
        db.GuestGrants.Add(new() { OrderId = request.OrderId, TokenHash = CommerceRepository.Hash(grant), ExpiresAt = now.AddMinutes(30) });
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        Response.Cookies.Append("ElectroMart.Grant." + request.OrderId.ToString("N"), grant, security.Cookie(TimeSpan.FromMinutes(30)));
        return Ok(new { message = "Private order access unlocked for 30 minutes." });
    }
}
