import { describe, expect, it } from "vitest";
import { allowBody, allowQuery, allowSetCookie, checkSameOrigin, commerceRoute, isCommerceCookie, selectedCookieHeader, upstreamHeaders } from "@/lib/api/bff-policy";
import { orderRequest, product } from "@/test/fixtures";

const origin = "https://shop.example.test";
describe("bounded BFF policy", () => {
  it.each([["GET", ["Product"]], ["GET", ["Product", "home"]], ["GET", ["Product", "by-slug", "headphones"]], ["GET", ["Order", "attempt", product.id]], ["POST", ["Order"]], ["POST", ["Auth", "login"]], ["POST", ["Account", "order-claims", "complete"]]])("allows selected commerce %s %j", (method, path) => {
    expect(commerceRoute(String(method), path as string[], false)).not.toBeNull();
  });
  it.each([["GET", ["https:", "evil"]], ["GET", ["..", "Product"]], ["POST", ["Product"]], ["DELETE", ["Order", product.id]], ["PATCH", ["Auth", "me"]], ["GET", ["diagnostics"]], ["GET", ["Product", "by-slug", "a/b"]]])("rejects arbitrary method/path %s %j", (method, path) => {
    expect(commerceRoute(String(method), path as string[])).toBeNull();
  });
  it("defaults catalog to page1/pageSize12 and caps100 without unknown query forwarding", () => {
    const route = commerceRoute("GET", ["Product"])!;
    expect(allowQuery(new URLSearchParams(), route).toString()).toBe("page=1&pageSize=12");
    for (const query of ["pageSize=101", "page=0", "page=1.1", "page=100001", "page=1&page=2", "ownerId=secret", "url=https://evil"]) {
      expect(() => allowQuery(new URLSearchParams(query), route)).toThrow();
    }
    expect(allowQuery(new URLSearchParams("category=audio&category=laptops&pageSize=100"), route).getAll("category")).toEqual(["audio", "laptops"]);
  });
  it("rejects entity orders, client owner IDs, prices and fractional quote quantities", () => {
    expect(allowBody("Order", "POST", orderRequest)).toEqual(orderRequest);
    for (const body of [{ ...orderRequest, userId: product.id }, { ...orderRequest, money: { total: 1 } }, { ...orderRequest, contact: { ...orderRequest.contact, accountId: product.id } }]) {
      expect(() => allowBody("Order", "POST", body)).toThrow();
    }
    for (const quantity of [0, 1.5, 100, "2"]) expect(() => allowBody("Checkout/quote", "POST", { items: [{ productId: product.id, quantity }] })).toThrow();
    expect(() => allowBody("Checkout/quote", "POST", { items: [{ productId: product.id, quantity: 1, unitPrice: 1 }] })).toThrow();
  });
  it.each([["GET", ["Order", product.id]], ["GET", ["Account", "orders"]], ["POST", ["Account", "order-claims", "complete"]], ["POST", ["Guest", "exchange"]], ["POST", ["Auth", "register"]], ["POST", ["Auth", "forgot"]]])("disables customer features by default %s %j", (method, path) => {
    expect(commerceRoute(String(method), path as string[])).toBeNull();
    expect(commerceRoute(String(method), path as string[], false)).not.toBeNull();
  });
  it("keeps receipt recovery and staff routes without exposing customer tracking", () => {
    expect(commerceRoute("POST", ["Order"])?.kind).toBe("receipt");
    expect(commerceRoute("GET", ["Order", "attempt", product.id])?.kind).toBe("receipt");
    expect(commerceRoute("GET", ["Admin", "orders", product.id])?.kind).toBe("order");
    expect(commerceRoute("GET", ["Auth", "me"])?.kind).toBe("account");
    expect(commerceRoute("POST", ["Auth", "logout"])?.kind).toBe("message");
  });
});

describe("same-origin defense", () => {
  const req = (method: string, headers: Record<string, string>) => new Request(`${origin}/api/bff/Order`, { method, headers });
  it("allows modern same-origin and absent Fetch Metadata fallback with canonical Origin on writes", () => {
    expect(() => checkSameOrigin(req("POST", { Origin: origin, "Sec-Fetch-Site": "same-origin" }), origin)).not.toThrow();
    expect(() => checkSameOrigin(req("POST", { Origin: origin }), origin)).not.toThrow();
    expect(() => checkSameOrigin(req("GET", {}), origin)).not.toThrow();
  });
  it.each([{ Origin: "https://evil.test", "Sec-Fetch-Site": "same-origin" }, { Origin: origin, "Sec-Fetch-Site": "same-site" }, { Origin: origin, "Sec-Fetch-Site": "cross-site" }, { Origin: "null" }, {}])("rejects unsafe origin/metadata %j", (headers) => {
    expect(() => checkSameOrigin(req("POST", headers as Record<string, string>), origin)).toThrow();
  });
});

describe("selected cookies and headers", () => {
  it("accepts only exact commerce cookies and GUID/N scoped grants", () => {
    expect(isCommerceCookie(`ElectroMart.Grant.${product.id}`)).toBe(true);
    expect(isCommerceCookie(`ElectroMart.Grant.${product.id.replaceAll("-", "")}`)).toBe(true);
    expect(isCommerceCookie("ElectroMart.Grant.secret" )).toBe(false);
    expect(selectedCookieHeader(`ElectroMart.Auth=a; Other=private; ElectroMart.Guest=g; ElectroMart.Grant.${product.id}=s; ElectroMart.Admin=bad`)).toBe(`ElectroMart.Auth=a; ElectroMart.Guest=g; ElectroMart.Grant.${product.id}=s`);
  });
  it("never forwards Authorization or client owner identity headers", () => {
    const forwarded = upstreamHeaders(new Request(`${origin}/api/bff/Order`, { headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "X-CSRF-Token": "token", "Idempotency-Key": product.id, Cookie: "ElectroMart.Auth=a; Other=secret", Authorization: "Bearer secret", "X-Owner-ID": "secret", "X-Account-ID": "secret" } }));
    expect(forwarded.get("Authorization")).toBeNull(); expect(forwarded.get("X-Owner-ID")).toBeNull(); expect(forwarded.get("X-Account-ID")).toBeNull();
    expect(forwarded.get("Cookie")).toBe("ElectroMart.Auth=a"); expect(forwarded.get("X-CSRF-Token")).toBe("token");
  });
  it("accepts compatible host-only Path=/ HttpOnly Lax cookies separately, not broadened or merged", () => {
    const good = "ElectroMart.Auth=value; Path=/; Secure; HttpOnly; SameSite=Lax";
    expect(allowSetCookie(good, true)).toBe(true);
    for (const bad of [good.replace("Path=/", "Path=/api"), `${good}; Domain=.example.test`, good.replace("; Secure", ""), good.replace("; HttpOnly", ""), good.replace("Lax", "None"), good.replace("ElectroMart.Auth", "Other"), `${good}\r\nX-Injected:secret`]) expect(allowSetCookie(bad, true)).toBe(false);
  });
});
