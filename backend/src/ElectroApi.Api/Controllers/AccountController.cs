using ElectroApi.Api.Security;
using ElectroApi.Core;
using ElectroApi.Core.DTOs;
using ElectroApi.Core.Entities;
using ElectroApi.Core.Interfaces;
using ElectroApi.Infrastructure.Data;
using ElectroApi.Infrastructure.Identity;
using ElectroApi.Infrastructure.Repositories;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ElectroApi.Api.Controllers;

[ApiController, Authorize(Policy = "Verified"), Route("api/v1/Account")]
public sealed class AccountController(CommerceSecurity security, OrderAccess access, ICommerceRepository commerce, ApplicationDbContext db, ICommerceMail mail) : ControllerBase
{
    [HttpGet("orders")]
    public async Task<IActionResult> Orders([FromQuery] int page = 1, [FromQuery] int pageSize = 12, CancellationToken ct = default)
    {
        var account = await security.RequireAccount(HttpContext);
        return Ok(await commerce.Orders(account.Id, null, page, pageSize, ct));
    }
    [HttpGet("orders/{id:guid}")]
    public async Task<IActionResult> Order(Guid id, CancellationToken ct)
    {
        var order = await commerce.Find(id, ct); await access.Require(HttpContext, order, true); return Ok(CommerceRepository.Map(order!));
    }
    [HttpPost("order-claims/request"), EnableRateLimiting("auth")]
    public async Task<IActionResult> RequestClaim(ClaimRequest request, CancellationToken ct)
    {
        var account = await security.RequireAccount(HttpContext); var email = account.NormalizedEmail!;
        var order = await db.Orders.AsNoTracking().SingleOrDefaultAsync(o => o.Id == request.OrderId && o.AccountId == null && o.NormalizedEmail == email, ct);
        if (order is not null)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var now = DateTime.UtcNow;
            await db.OrderClaims.Where(c => c.OrderId == order.Id && c.AccountId == account.Id && c.ConsumedAt == null).ExecuteUpdateAsync(s => s.SetProperty(c => c.ExpiresAt, now), ct);
            var proof = CommerceRepository.NewToken();
            var claim = new OrderClaim { OrderId = order.Id, AccountId = account.Id, TokenHash = CommerceRepository.Hash(proof), ExpiresAt = now.AddMinutes(20) };
            db.OrderClaims.Add(claim);
            db.EmailOutbox.Add(mail.Create(account.Email!, "Claim your ElectroMart guest order", "You requested to claim guest order " + order.Number + ". Open the link while signed in to your verified account and choose Confirm claim:\n" + mail.Link("/account/claim", new Dictionary<string, string> { ["claimId"] = claim.Id.ToString(), ["proof"] = proof }) + "\nThis one-use link expires in 20 minutes."));
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        }
        return Ok(new { message = "If this order is eligible for this verified account, an email has been queued with the next steps." });
    }
    [HttpPost("order-claims/complete"), EnableRateLimiting("auth")]
    public async Task<IActionResult> CompleteClaim(ClaimComplete request, CancellationToken ct)
    {
        var account = await security.RequireAccount(HttpContext);
        var probe = await db.OrderClaims.AsNoTracking().SingleOrDefaultAsync(c => c.Id == request.ClaimId && c.AccountId == account.Id, ct);
        CommerceRules.Require(probe is not null, "proof_invalid", "This claim proof is invalid or expired.");
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct);
        // Lock order before claim, matching guest exchange, to avoid claim/revocation races.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM Orders WHERE Id = {probe!.OrderId.ToString()} FOR UPDATE", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT Id FROM OrderClaims WHERE Id = {request.ClaimId.ToString()} FOR UPDATE", ct);
        var claim = await db.OrderClaims.SingleAsync(c => c.Id == request.ClaimId, ct);
        var now = DateTime.UtcNow;
        CommerceRules.Require(claim.AccountId == account.Id && claim.ConsumedAt == null && claim.ExpiresAt > now && claim.Attempts < 5, "proof_expired", "This claim proof is invalid, expired or already used.", 409);
        claim.Attempts++;
        if (claim.TokenHash != CommerceRepository.Hash(request.Proof))
        {
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
            throw new CommerceException(400, "proof_invalid", "This claim proof is invalid or expired.");
        }
        var order = await db.Orders.Include(o => o.Lines).Include(o => o.Events).SingleAsync(o => o.Id == claim.OrderId, ct);
        CommerceRules.Require(order.AccountId == null && order.NormalizedEmail == account.NormalizedEmail, "proof_invalid", "This order cannot be claimed by this account.", 409);
        order.AccountId = account.Id; order.Version++;
        claim.ConsumedAt = now;
        var audit = new OrderEvent { OrderId = order.Id, ActorId = account.Id, Action = "Claimed", Version = order.Version };
        db.Add(audit); order.Events.Add(audit);
        await db.GuestCapabilities.Where(g => g.OrderId == order.Id && g.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(g => g.RevokedAt, now), ct);
        await db.GuestGrants.Where(g => g.OrderId == order.Id && g.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(g => g.RevokedAt, now), ct);
        db.EmailOutbox.Add(mail.Create(order.Contact.Email, "ElectroMart guest order claimed", $"Order {order.Number} is now linked to your verified account. Previous guest access links were revoked. Your original contact and order snapshots are unchanged."));
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        return Ok(CommerceRepository.Map(order));
    }
}
