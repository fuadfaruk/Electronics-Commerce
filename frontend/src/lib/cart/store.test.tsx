// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CartProvider, useCart } from "@/lib/cart/store";
import { cartStorageKey, emptyCart, LEGACY_CART_KEY } from "@/lib/cart/storage";
import { cartLine, order } from "@/test/fixtures";

function Probe() {
  const cart = useCart();
  return <><p>Quantity {cart.itemCount}</p>{cart.notice ? <p role="status">{cart.notice}</p> : null}<button onClick={() => cart.confirmPurchase(order.id, order.lines)}>Confirm purchase</button></>;
}
beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); window.localStorage.clear(); });
describe("cart cross-tab reconciliation", () => {
  it("uses the freshest stored quantity and applies the same confirmed receipt only once across tabs", async () => {
    const key = cartStorageKey("live"); window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [cartLine] }));
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await screen.findByText("Quantity 2");
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 5 }] }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" })); expect(screen.getByText("Quantity 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" })); expect(screen.getByText("Quantity 3")).toBeTruthy();
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 7 }], appliedOrders: [order.id] }));
    fireEvent(window, new StorageEvent("storage", { key })); expect(screen.getByText("Quantity 7")).toBeTruthy();
  });
  it("invalidates unsafe v1 visibly, without carrying it into live v2", async () => {
    window.localStorage.setItem(LEGACY_CART_KEY, JSON.stringify([cartLine]));
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await waitFor(() => expect(screen.getByText(/old cart could not be safely restored/)).toBeTruthy()); expect(screen.getByText("Quantity 0")).toBeTruthy(); expect(window.localStorage.getItem(LEGACY_CART_KEY)).toBeNull();
  });
});
