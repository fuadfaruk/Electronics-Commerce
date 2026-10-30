import { ApiRequestError } from "@/lib/api/errors";
import { GUID_PATTERN, SLUG_PATTERN } from "@/lib/api/decoders";

export type ResponseKind = "catalog" | "productDetail" | "home" | "categories" | "category" |
  "product" | "stock" | "account" | "csrf" | "quote" | "receipt" | "order" | "orders" | "message" | "empty";

export interface CommerceRoute {
  path: string;
  kind: ResponseKind;
  queryKeys: readonly string[];
  mockRead: boolean;
}

const CATALOG_QUERY = ["q", "category", "brand", "min", "max", "stock", "sort", "page", "pageSize"];
const UUID = GUID_PATTERN;

export function commerceRoute(method: string, segments: string[], guestOnly = true): CommerceRoute | null {
  if (!segments.length || segments.length > 4 || segments.some((s) => !/^[A-Za-z0-9-]{1,160}$/.test(s))) return null;
  const path = segments.join("/");
  if (guestOnly && (segments[0] === "Account" || segments[0] === "Guest" ||
    (segments[0] === "Auth" && !["Auth/login", "Auth/logout", "Auth/me"].includes(path)))) return null;
  const route = (kind: ResponseKind, queryKeys: readonly string[] = [], mockRead = false) => ({ path, kind, queryKeys, mockRead });

  if (method === "GET") {
    if (path === "Product") return route("catalog", CATALOG_QUERY, true);
    if (path === "Product/home") return route("home", [], true);
    if (segments[0] === "Product" && (
      (segments.length === 2 && UUID.test(segments[1])) ||
      (segments.length === 3 && segments[1] === "by-slug" && SLUG_PATTERN.test(segments[2]))
    )) return route("productDetail", [], true);
    if (path === "Category") return route("categories", [], true);
    if (segments.length === 3 && segments[0] === "Category" && segments[1] === "by-slug" && SLUG_PATTERN.test(segments[2])) return route("category", [], true);
    if (path === "Security/csrf") return route("csrf");
    if (path === "Auth/me") return route("account");
    if (segments[0] === "Order" && segments.length === 3 && segments[1] === "attempt" && UUID.test(segments[2])) return route(guestOnly ? "receipt" : "order");
    if (!guestOnly && segments[0] === "Order" && segments.length === 2 && UUID.test(segments[1])) return route("order");
    if (path === "Account/orders") return route("orders", ["page", "pageSize"]);
    if (segments.length === 3 && segments[0] === "Account" && segments[1] === "orders" && UUID.test(segments[2])) return route("order");
    if (path === "Admin/categories") return route("categories");
    if (path === "Admin/products") return route("catalog", ["page", "pageSize", "q"]);
    if (path === "Admin/orders") return route("orders", ["page", "pageSize", "status"]);
    if (segments.length === 3 && segments[0] === "Admin" && UUID.test(segments[2])) {
      if (segments[1] === "products") return route("product");
      if (segments[1] === "orders") return route("order");
    }
  }
  if (method === "POST") {
    if (path === "Checkout/quote") return route("quote");
    if (path === "Order") return route(guestOnly ? "receipt" : "order");
    if (path === "Auth/login") return route("account");
    if (path === "Account/order-claims/complete") return route("order");
    if (["Auth/register", "Auth/logout", "Auth/verify", "Auth/resend", "Auth/forgot", "Auth/reset", "Guest/exchange", "Account/order-claims/request"].includes(path)) return route("message");
    if (path === "Admin/categories") return route("category");
    if (path === "Admin/products") return route("product");
    if (segments.length === 4 && segments[0] === "Admin" && UUID.test(segments[2])) {
      if (segments[1] === "categories" && segments[3] === "archive") return route("category");
      if (segments[1] === "products" && segments[3] === "archive") return route("product");
      if (segments[1] === "products" && segments[3] === "stock") return route("stock");
      if (segments[1] === "orders" && ["fulfillment", "cancel", "collect"].includes(segments[3])) return route("order");
    }
  }
  if (segments.length === 3 && segments[0] === "Admin" && UUID.test(segments[2])) {
    if (method === "PUT" && segments[1] === "categories") return route("category");
    if (method === "PUT" && segments[1] === "products") return route("product");
    if (method === "DELETE" && segments[1] === "categories") return route("empty", ["expectedVersion"]);
  }
  return null;
}

export function allowQuery(params: URLSearchParams, route: CommerceRoute): URLSearchParams {
  const result = new URLSearchParams();
  if (params.toString().length > 4096) throw new ApiRequestError({ status: 400 });
  for (const [key, value] of params) {
    if (!route.queryKeys.includes(key) || value.length > 1000) throw new ApiRequestError({ status: 400 });
    if (["page", "pageSize", "expectedVersion"].includes(key)) {
      const maximum = key === "pageSize" ? 100 : key === "page" ? 100_000 : Number.MAX_SAFE_INTEGER;
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum || result.has(key)) throw new ApiRequestError({ status: 400 });
    }
    result.append(key, value);
  }
  if (route.kind === "catalog" || route.kind === "orders") {
    if (!result.has("page")) result.set("page", "1");
    if (!result.has("pageSize")) result.set("pageSize", "12");
  }
  return result;
}

export function checkSameOrigin(request: Request, storefrontOrigin: string): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const unsafe = request.method !== "GET" && request.method !== "HEAD";
  if ((site !== null && site !== "same-origin") || (origin !== null && origin !== storefrontOrigin) || (unsafe && origin !== storefrontOrigin)) {
    throw new ApiRequestError({ status: 403, code: "FORBIDDEN" });
  }
}

export function isCommerceCookie(name: string): boolean {
  return ["ElectroMart.Auth", "ElectroMart.Antiforgery", "ElectroMart.Guest"].includes(name) ||
    /^ElectroMart\.Grant\.(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(name);
}

export function selectedCookies(cookies: { name: string; value: string }[]): string {
  return cookies.filter(({ name, value }) => isCommerceCookie(name) && value.length <= 4096 && /^[\x21-\x3a\x3c-\x7e]*$/.test(value))
    .slice(0, 24).map(({ name, value }) => `${name}=${value}`).join("; ");
}

export function selectedCookieHeader(raw: string | null): string {
  return selectedCookies((raw ?? "").split(";").map((entry) => {
    const i = entry.indexOf("=");
    return { name: entry.slice(0, i).trim(), value: i < 0 ? "" : entry.slice(i + 1).trim() };
  }));
}

export function allowSetCookie(value: string, requireSecure: boolean): boolean {
  if (value.length > 8192 || /[\r\n]/.test(value)) return false;
  const pieces = value.split(";").map((p) => p.trim());
  const i = pieces[0].indexOf("=");
  if (i < 1 || !isCommerceCookie(pieces[0].slice(0, i)) || !/^[\x21-\x3a\x3c-\x7e]*$/.test(pieces[0].slice(i + 1))) return false;
  const attributes = pieces.slice(1);
  return !attributes.some((a) => /^domain\s*=/i.test(a)) &&
    attributes.filter((a) => /^path\s*=/i.test(a)).length === 1 &&
    attributes.some((a) => /^path=\/$/i.test(a)) &&
    attributes.some((a) => /^httponly$/i.test(a)) &&
    attributes.some((a) => /^samesite=lax$/i.test(a)) &&
    (!requireSecure || attributes.some((a) => /^secure$/i.test(a)));
}

export function upstreamHeaders(request: Request): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const cookies = selectedCookieHeader(request.headers.get("cookie"));
  if (cookies) headers.set("Cookie", cookies);
  for (const key of ["Origin", "Sec-Fetch-Site", "X-CSRF-Token", "Idempotency-Key"]) {
    const value = request.headers.get(key);
    if (!value) continue;
    if (value.length > (key === "X-CSRF-Token" ? 4096 : 256) || /[\r\n]/.test(value)) throw new ApiRequestError({ status: 400 });
    if (key === "Idempotency-Key" && !UUID.test(value)) throw new ApiRequestError({ status: 400 });
    headers.set(key, value);
  }
  return headers;
}

/** Reject entity-shaped/owner-shaped writes rather than forwarding unknown fields. */
export function allowBody(path: string, method: string, value: unknown): unknown {
  if (method === "GET") return undefined;
  if (method === "DELETE") {
    if (value != null) throw new ApiRequestError({ status: 400 });
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiRequestError({ status: 400 });
  const body = value as Record<string, unknown>;
  const keys = path === "Checkout/quote" ? ["items"] : path === "Order" ? ["quoteId", "contact", "deliveryAddress", "notes"] :
    path === "Auth/register" ? ["name", "email", "password"] : path === "Auth/login" ? ["email", "password"] :
    path === "Auth/logout" ? [] : path === "Auth/verify" ? ["userId", "token"] :
    path === "Auth/reset" ? ["userId", "token", "password"] : path.startsWith("Auth/") ? ["email"] :
    path === "Guest/exchange" ? ["orderId", "capability"] :
    path === "Account/order-claims/request" ? ["orderId"] : path === "Account/order-claims/complete" ? ["claimId", "proof"] :
    /Admin\/categories(?:\/[0-9a-f-]+)?$/.test(path) ? ["slug", "name", "description", "visualKey", "sortOrder", "expectedVersion"] :
    /Admin\/products(?:\/[0-9a-f-]+)?$/.test(path) ? ["slug", "name", "brand", "categoryId", "description", "price", "compareAtPrice", "featured", "images", "specs", "expectedVersion"] :
    path.endsWith("/stock") ? ["delta", "expectedVersion", "reason"] :
    path.endsWith("/fulfillment") ? ["status", "expectedVersion", "note"] : ["expectedVersion", "note"];

  const checkKeys = (object: unknown, allowed: string[]) => {
    if (!object || typeof object !== "object" || Array.isArray(object) || Object.keys(object).some((key) => !allowed.includes(key))) throw new ApiRequestError({ status: 400 });
  };
  checkKeys(body, keys);
  if (path === "Order") {
    checkKeys(body.contact, ["name", "email", "phone"]);
    checkKeys(body.deliveryAddress, ["street", "area", "city", "district", "postcode"]);
  }
  if (path === "Checkout/quote") {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw new ApiRequestError({ status: 400 });
    for (const item of body.items) {
      checkKeys(item, ["productId", "quantity"]);
      if (typeof item.productId !== "string" || !UUID.test(item.productId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new ApiRequestError({ status: 400 });
    }
  }
  if (Array.isArray(body.specs)) for (const spec of body.specs) checkKeys(spec, ["label", "value"]);
  return body;
}
