// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiProductToProduct } from "@/lib/api/adapters";
import { CartProvider, useCart } from "@/lib/cart/store";
import { cartStorageKey, emptyCart, LEGACY_CART_KEY } from "@/lib/cart/storage";
import { withStorageLock } from "@/lib/storage-lock";
import { cartLine, order, product as productDto } from "@/test/fixtures";

const product = apiProductToProduct(productDto);
const otherProduct = { ...product, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "Speaker", slug: "speaker" };
const otherLine = { ...cartLine, productId: otherProduct.id, name: otherProduct.name, slug: otherProduct.slug, quantity: 3 };

function Probe() {
  const cart = useCart();
  return <><p>Quantity {cart.itemCount}</p><p>Purchased quantity {cart.lines.find((line) => line.productId === product.id)?.quantity ?? 0}</p><p>Other quantity {cart.lines.find((line) => line.productId === otherProduct.id)?.quantity ?? 0}</p>{cart.notice ? <p role="status">{cart.notice}</p> : null}<button onClick={() => cart.confirmPurchase(order.id, order.lines)}>Confirm purchase</button><button onClick={() => cart.addProduct(product)}>Add product</button><button onClick={() => cart.addProduct(otherProduct)}>Add another product</button></>;
}
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, operation: () => unknown) => operation() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });
describe("cart cross-tab reconciliation", () => {
  it("uses the freshest stored quantity and applies the same confirmed receipt only once across tabs", async () => {
    const key = cartStorageKey("live"); window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [cartLine] }));
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await screen.findByText("Quantity 2");
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 5 }] }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" })); await screen.findByText("Quantity 3");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" })); }); expect(screen.getByText("Quantity 3")).toBeTruthy();
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 7 }], appliedOrders: [order.id] }));
    fireEvent(window, new StorageEvent("storage", { key })); expect(screen.getByText("Quantity 7")).toBeTruthy();
  });
  it("invalidates unsafe v1 visibly, without carrying it into live v2", async () => {
    window.localStorage.setItem(LEGACY_CART_KEY, JSON.stringify([cartLine]));
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await waitFor(() => expect(screen.getByText(/old cart could not be safely restored/)).toBeTruthy()); expect(screen.getByText("Quantity 0")).toBeTruthy(); expect(window.localStorage.getItem(LEGACY_CART_KEY)).toBeNull();
  });
  it.each(["unsupported", "rejected"])("keeps %s Web Lock cart updates tab-only instead of overwriting another tab", async (mode) => {
    const key = cartStorageKey("live");
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [cartLine] }));
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await screen.findByText("Quantity 2");
    const freshest = JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 5 }, otherLine] });
    window.localStorage.setItem(key, freshest);
    vi.stubGlobal("navigator", mode === "unsupported" ? {} : { locks: { request: vi.fn().mockRejectedValue(new Error("Denied")) } });
    const write = vi.spyOn(Storage.prototype, "setItem");
    const read = vi.spyOn(Storage.prototype, "getItem");
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    await screen.findByText("Quantity 3");
    expect(screen.getByText(/Cross-tab cart synchronization is unavailable/)).toBeTruthy();
    expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    fireEvent(window, new StorageEvent("storage", { key }));
    fireEvent.click(screen.getByRole("button", { name: "Add another product" }));
    await screen.findByText("Quantity 4");
    expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key)).toBe(freshest);
  });
  it("never writes a stale snapshot when the freshest storage read is denied, even if writes work", async () => {
    const key = cartStorageKey("live");
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [cartLine] }));
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await screen.findByText("Quantity 2");
    const freshest = JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 5 }, otherLine] });
    window.localStorage.setItem(key, freshest);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Reads denied"); });
    const write = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" }));
    await screen.findByText("Quantity 0");
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByText(/Cart storage is unavailable/)).toBeTruthy();
    vi.restoreAllMocks();
    expect(window.localStorage.getItem(key)).toBe(freshest);
    fireEvent(window, new StorageEvent("storage", { key }));
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    await screen.findByText("Quantity 1");
    expect(window.localStorage.getItem(key)).toBe(freshest);
  });
  it("continues cart work in memory when storage rejects reads and writes", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage denied"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await screen.findByText(/Cart storage is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    await screen.findByText("Quantity 2");
    expect(write).not.toHaveBeenCalled();
  });
  it("preserves freshest added quantities and new items during overlapping purchase and add operations", async () => {
    const key = cartStorageKey("live");
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [cartLine] }));
    render(<CartProvider source="live"><Probe /></CartProvider>);
    await screen.findByText("Quantity 2");
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    const held = withStorageLock(key, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" }));
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    fireEvent.click(screen.getByRole("button", { name: "Add another product" }));
    window.localStorage.setItem(key, JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 5 }, otherLine] }));
    await act(async () => { release.resolve(); await held; });
    await screen.findByText("Quantity 8");
    expect(screen.getByText("Purchased quantity 4")).toBeTruthy(); expect(screen.getByText("Other quantity 4")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" })); });
    const stored = JSON.parse(window.localStorage.getItem(key)!);
    expect(stored.lines.map((line: { quantity: number }) => line.quantity)).toEqual([4, 4]);
    expect(stored.appliedOrders).toEqual([order.id]);
  });
});
