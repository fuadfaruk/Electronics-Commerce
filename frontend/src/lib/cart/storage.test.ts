import { describe, expect, it } from "vitest";
import { cartStorageKey, confirmedCart, emptyCart, parseStoredCart } from "@/lib/cart/storage";
import { cartLine, order, product } from "@/test/fixtures";

describe("bounded source-separated carts", () => {
  const stored = (lines: unknown[]) => JSON.stringify({ ...emptyCart("live"), lines });
  it("uses distinct live/mock/schema keys and invalidates old or wrong-source data", () => {
    expect(cartStorageKey("live")).not.toBe(cartStorageKey("mock"));
    expect(parseStoredCart(JSON.stringify([cartLine]), "live").invalid).toBe(true);
    expect(parseStoredCart(JSON.stringify({ ...emptyCart("mock"), lines: [cartLine] }), "live").cart.lines).toEqual([]);
  });
  it.each(["bad-json", "{}", "null", "a".repeat(160_000)])("handles malformed storage safely %s", (raw) => {
    expect(parseStoredCart(raw, "live")).toEqual({ cart: emptyCart("live"), invalid: true });
  });
  it("drops fractional, over-limit and unsafe lines visibly, dedupes valid whole quantities", () => {
    const parsed = parseStoredCart(stored([cartLine, { ...cartLine, quantity: 3 }, { ...cartLine, quantity: 1.1 }, { ...cartLine, unitPrice: 1200.1 }, { ...cartLine, image: "javascript:secret" }]), "live");
    expect(parsed.invalid).toBe(true); expect(parsed.cart.lines).toHaveLength(1); expect(parsed.cart.lines[0].quantity).toBe(5);
    expect(parseStoredCart(stored([{ ...cartLine, quantity: 100 }]), "live").cart.lines).toHaveLength(0);
  });
  it("subtracts only confirmed purchased units from the freshest cart and only once", () => {
    const cart = { ...emptyCart("live"), lines: [{ ...cartLine, quantity: 5 }, { ...cartLine, productId: product.categoryId, quantity: 2 }] };
    const confirmed = confirmedCart(cart, order.id, order.lines);
    expect(confirmed.lines.map((l) => l.quantity)).toEqual([3, 2]);
    expect(confirmedCart(confirmed, order.id, order.lines)).toBe(confirmed);
  });
});
