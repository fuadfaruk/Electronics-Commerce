import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/bff/[...path]/route";
import { account, catalogPage, order, orderReceipt, product } from "@/test/fixtures";

const origin = "https://shop.example.test";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
beforeEach(() => { vi.stubEnv("STOREFRONT_MODE", "live"); vi.stubEnv("STOREFRONT_GUEST_ONLY", "true"); vi.stubEnv("API_BASE_URL", "https://api.example.test"); vi.stubEnv("STOREFRONT_URL", origin); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("BFF route boundary", () => {
  it("forwards each selected Set-Cookie independently and drops upstream diagnostic headers", async () => {
    const headers = new Headers({ "X-Debug": "private", Location: "https://internal.test" });
    headers.append("Set-Cookie", "ElectroMart.Auth=auth; Path=/; Secure; HttpOnly; SameSite=Lax");
    headers.append("Set-Cookie", "ElectroMart.Antiforgery=csrf; Path=/; Secure; HttpOnly; SameSite=Lax");
    headers.append("Set-Cookie", "Other=secret; Path=/; Secure; HttpOnly; SameSite=Lax");
    const fetch = vi.fn().mockResolvedValue(Response.json({ token: "token-123", ownerKind: "account", account }, { headers })); vi.stubGlobal("fetch", fetch);
    const response = await GET(new Request(`${origin}/api/bff/Security/csrf`, { headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", Cookie: "ElectroMart.Guest=g; Other=secret", Authorization: "Bearer secret" } }), context(["Security", "csrf"]));
    expect(response.status).toBe(200); expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.getSetCookie()[0]).toContain("ElectroMart.Auth="); expect(response.headers.getSetCookie()[1]).toContain("ElectroMart.Antiforgery=");
    expect(response.headers.get("X-Debug")).toBeNull(); expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBeNull();
  });
  it("sanitizes upstream failures, including raw PII/URLs/stacks", async () => {
    vi.stubEnv("STOREFRONT_GUEST_ONLY", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "quote_expired", title: "secret PII", detail: "http://internal/password", stack: "private", traceId: "email@example.test" }, { status: 409 })));
    const response = await GET(new Request(`${origin}/api/bff/Order/${product.id}`), context(["Order", product.id]));
    const body = await response.json();
    expect(body).toMatchObject({ code: "QUOTE_EXPIRED", status: 409 }); expect(JSON.stringify(body)).not.toMatch(/secret|PII|http:|password|private|email@/);
  });
  it("does not proxy arbitrary routes or cross-site writes", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await GET(new Request(`${origin}/api/bff/diagnostics`), context(["diagnostics"]))).status).toBe(404);
    expect((await POST(new Request(`${origin}/api/bff/Order`, { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: "{}" }), context(["Order"]))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects fractional-price success instead of returning rounded/fallback browse data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...catalogPage, items: [{ ...product, price: 1.2 }] })));
    const response = await GET(new Request(`${origin}/api/bff/Product`), context(["Product"]));
    expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("explicit mock browsing does not hit live network, and every mutation is disabled", async () => {
    vi.stubEnv("STOREFRONT_MODE", "mock"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await GET(new Request(`${origin}/api/bff/Product`), context(["Product"]))).status).toBe(200);
    expect((await POST(new Request(`${origin}/api/bff/Auth/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" }), context(["Auth", "login"]))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ path: ["Order", product.id] }, { path: ["Account", "orders"] }])("does not contact the API for disabled tracking $path", async ({ path }) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await GET(new Request(`${origin}/api/bff/${path.join("/")}`), context(path));
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("strips all live tracking and contact fields from original-attempt receipts", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(order)); vi.stubGlobal("fetch", fetch);
    const response = await GET(new Request(`${origin}/api/bff/Order/attempt/${order.id}`), context(["Order", "attempt", order.id]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(orderReceipt);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
