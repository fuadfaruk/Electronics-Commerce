import { afterEach, describe, expect, it, vi } from "vitest";
import { commerceMutation } from "@/lib/api/client";
import { parseAccount, parseOrder } from "@/lib/api/decoders";
import { account, order, orderRequest } from "@/test/fixtures";

afterEach(() => vi.unstubAllGlobals());
describe("client ownership and CSRF boundary", () => {
  it("obtains CSRF and guest binding before checkout, preserving supplied idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token: "fresh-csrf", ownerKind: "guest" })).mockResolvedValueOnce(Response.json(order)); vi.stubGlobal("fetch", fetch);
    await commerceMutation("Order", orderRequest, parseOrder, { mode: "live", expectedOwner: "guest", idempotencyKey: order.id });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/bff/Security/csrf", "/api/bff/Order"]);
    const request = fetch.mock.calls[1][1]; expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("fresh-csrf"); expect(new Headers(request.headers).get("Idempotency-Key")).toBe(order.id);
    expect(request.body).toBe(JSON.stringify(orderRequest));
  });
  it("refreshes CSRF after login identity changes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token: "guest-csrf", ownerKind: "guest" })).mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(Response.json({ token: "account-csrf", ownerKind: "account", account })); vi.stubGlobal("fetch", fetch);
    await commerceMutation("Auth/login", { email: account.email, password: "Testing123!" }, parseAccount, { mode: "live" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/bff/Security/csrf", "/api/bff/Auth/login", "/api/bff/Security/csrf"]);
  });
  it("never retries failed account checkout as guest", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token: "account-csrf", ownerKind: "account", account })).mockResolvedValueOnce(new Response(null, { status: 401 })); vi.stubGlobal("fetch", fetch);
    await expect(commerceMutation("Order", orderRequest, parseOrder, { mode: "live", expectedOwner: "account", expectedAccountId: account.id, idempotencyKey: order.id })).rejects.toMatchObject({ problem: { status: 401 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("blocks changed or expired account before quote/Order submission", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ token: "expired-csrf", ownerKind: "account", account: null, sessionExpired: true })); vi.stubGlobal("fetch", fetch);
    await expect(commerceMutation("Order", orderRequest, parseOrder, { mode: "live", expectedOwner: "account", expectedAccountId: account.id, idempotencyKey: order.id })).rejects.toMatchObject({ problem: { status: 401 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("mock mutations fail before CSRF or any live network call", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(commerceMutation("Order", orderRequest, parseOrder, { mode: "mock" })).rejects.toMatchObject({ problem: { code: "MOCK_READ_ONLY" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
