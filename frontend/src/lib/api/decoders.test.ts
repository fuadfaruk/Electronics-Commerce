import { describe, expect, it } from "vitest";
import { parseCatalogPage, parseCsrf, parseMoney, parseOrder, parseProduct, parseQuote } from "@/lib/api/decoders";
import { account, catalogPage, order, product, quote } from "@/test/fixtures";

describe("strict dedicated commerce DTOs", () => {
  it.each([null, 0, -1, 100.5, Number.NaN, Number.POSITIVE_INFINITY, "1200"])("rejects unsafe product price %s", (price) => {
    expect(() => parseProduct({ ...product, price })).toThrow();
  });
  it.each([null, undefined, 1.5, -1, "20"])("rejects invalid stock %s", (stock) => { expect(() => parseProduct({ ...product, stock })).toThrow(); });
  it("requires explicit slug, category FK, version and booleans, not old entity contracts", () => {
    for (const field of ["id", "slug", "categoryId", "categorySlug", "categoryName", "version", "saleEligible", "featured"]) {
      const invalid = { ...product, [field]: undefined }; expect(() => parseProduct(invalid)).toThrow();
    }
    expect(() => parseProduct({ productId: product.id, productPrice: 1200 })).toThrow();
  });
  it("accepts empty brands, empty images and sold-out authoritative eligibility without fabricating values", () => {
    expect(parseProduct({ ...product, brand: "", stock: 0, saleEligible: false, images: [] })).toMatchObject({ brand: "", stock: 0, images: [] });
    expect(parseProduct({ ...product, slug: "a".repeat(160) }).slug).toHaveLength(160);
  });
  it("rejects unsafe image URLs in live mode; local placeholders only in explicit mock", () => {
    for (const image of ["http://images.example/a", "https://user:secret@images.example/a", "javascript:alert(1)", "//images.example/a", "/placeholders/audio.svg"]) {
      expect(() => parseProduct({ ...product, images: [image] })).toThrow();
    }
    expect(parseProduct({ ...product, images: ["/placeholders/audio.svg"] }, "mock").images).toEqual(["/placeholders/audio.svg"]);
  });
  it("caps catalog pageSize and rejects overfull page payloads", () => {
    expect(() => parseCatalogPage({ ...catalogPage, pageSize: 101 })).toThrow();
    expect(() => parseCatalogPage({ ...catalogPage, pageSize: 1, items: [product, product] })).toThrow();
  });
  it("checks whole-BDT arithmetic and exact delivery policy", () => {
    expect(parseMoney(quote.money)).toEqual(quote.money);
    for (const patch of [{ currency: "USD" }, { subtotal: 2400.5 }, { delivery: 79, total: 2479 }, { total: 2481 }, { policyVersion: "invented" }]) {
      expect(() => parseMoney({ ...quote.money, ...patch })).toThrow();
    }
    expect(parseMoney({ ...quote.money, subtotal: 5000, delivery: 0, total: 5000 }).total).toBe(5000);
  });
  it("rejects fabricated line totals/quantities and numeric order statuses", () => {
    expect(parseOrder(order).fulfillment).toBe("Pending");
    expect(() => parseOrder({ ...order, fulfillment: 0 })).toThrow();
    expect(() => parseOrder({ ...order, payment: "Paid" })).toThrow();
    expect(() => parseQuote({ ...quote, lines: [{ ...quote.lines[0], quantity: 100 }] })).toThrow();
    expect(() => parseQuote({ ...quote, lines: [{ ...quote.lines[0], lineTotal: 2399 }] })).toThrow();
  });
  it("permits the expired account CSRF marker only without guest fallback", () => {
    expect(parseCsrf({ token: "token-123", ownerKind: "account", account: null, sessionExpired: true })).toMatchObject({ ownerKind: "account", sessionExpired: true });
    expect(() => parseCsrf({ token: "token-123", ownerKind: "account", account: null })).toThrow();
    expect(() => parseCsrf({ token: "token-123", ownerKind: "guest", account })).toThrow();
    expect(() => parseCsrf({ token: "token-123", ownerKind: "guest", sessionExpired: true })).toThrow();
  });
});
