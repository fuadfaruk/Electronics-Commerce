// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { CartProvider, useCart } from "@/lib/cart/store";
import { cartStorageKey, emptyCart } from "@/lib/cart/storage";
import { ATTEMPT_STORAGE_KEY, attemptMemory, clearAttempt, createAttempt, readAttempt } from "@/lib/checkout/attempt";
import { withStorageLock } from "@/lib/storage-lock";
import { formatBDT } from "@/lib/money";
import { account, cartLine, order, orderRequest, quote } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks, unstable_rethrow: () => {} }));
vi.mock("@/components/product/product-image", () => ({ ProductImage: () => null }));
beforeEach(() => {
  window.localStorage.clear(); mocks.replace.mockReset(); mocks.refresh.mockReset(); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, operation: () => unknown) => operation() } });
  window.localStorage.setItem(cartStorageKey("live"), JSON.stringify({ ...emptyCart("live"), lines: [cartLine] }));
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks();
  const reference = readAttempt().reference;
  if (reference) await clearAttempt(reference);
  vi.unstubAllGlobals(); window.localStorage.clear();
});

function fillContact() {
  const fields = { "Recipient name": orderRequest.contact.name, "Email": orderRequest.contact.email, "Bangladesh mobile number": orderRequest.contact.phone, "Street and house": orderRequest.deliveryAddress.street, "Area": orderRequest.deliveryAddress.area, "City or town": orderRequest.deliveryAddress.city, "District": orderRequest.deliveryAddress.district, "Postcode (optional)": "1207", "Delivery notes (optional)": orderRequest.notes! };
  for (const [label, value] of Object.entries(fields)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function reviewQuote() {
  await waitFor(() => expect((screen.getByRole("button", { name: "Check price and availability" }) as HTMLButtonElement).disabled).toBe(false));
  fillContact(); fireEvent.click(screen.getByRole("button", { name: "Check price and availability" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /I reviewed this quote/ }));
}

describe("authoritative quote and uncertain order recovery", () => {
  it("places an ordinary order with neutral quote acknowledgment, required email and no messenger request or redirect", async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.endsWith("csrf")) return Response.json({ token: "fresh_csrf", ownerKind: "guest" });
      if (url.endsWith("quote")) return Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() });
      if (url === "/api/bff/Order") return Response.json(order);
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<CartProvider source="live"><CheckoutForm initialAccount={null} /></CartProvider>);
    await reviewQuote();
    expect(screen.getByRole("checkbox", { name: /I reviewed this quote/ }).closest("label")?.textContent).toBe(`I reviewed this quote and agree to the items, delivery charge and order total of ${formatBDT(quote.money.total)}.`);
    expect((screen.getByLabelText("Email") as HTMLInputElement).required).toBe(true);
    expect(screen.getByText(/No payment is taken online\. We will contact you to confirm the order and payment\./)).toBeTruthy();
    expect(screen.getByText("Quoted total")).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/\bCOD\b|cash on delivery|Telegram|WhatsApp/i);
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/orders/${order.id}`));
    const accepted = fetch.mock.calls.filter(([url]) => url === "/api/bff/Order");
    expect(accepted).toHaveLength(1);
    expect(JSON.parse(accepted[0][1]!.body as string)).toEqual(orderRequest);
    expect(fetch.mock.calls.every(([url]) => url.startsWith("/api/bff/"))).toBe(true);
    expect(mocks.replace.mock.calls).toEqual([[`/orders/${order.id}`]]);
  });
  it("requires quote acknowledgment, preserves only a safe attempt after lost response, and recovers receipt without a second Order POST", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("csrf")) return Response.json({ token: "fresh_csrf", ownerKind: "guest" });
      if (url.endsWith("quote")) return Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() });
      if (url === "/api/bff/Order") throw new Error("Lost response");
      if (url.includes("/Order/attempt/")) return Response.json(order);
      throw new Error("Unexpected request");
    }); vi.stubGlobal("fetch", fetch);
    render(<CartProvider source="live"><CheckoutForm initialAccount={null} /></CartProvider>);
    await waitFor(() => expect((screen.getByRole("button", { name: "Check price and availability" }) as HTMLButtonElement).disabled).toBe(false));
    fillContact(); fireEvent.click(screen.getByRole("button", { name: "Check price and availability" }));
    const acknowledgment = await screen.findByRole("checkbox", { name: /I reviewed this quote/ });
    expect((screen.getByRole("button", { name: "Place order" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(acknowledgment); fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByRole("button", { name: "Check for receipt" });
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(1));
    const persisted = window.localStorage.getItem(ATTEMPT_STORAGE_KEY)!;
    expect(persisted).not.toMatch(/Test Customer|customer@example|017123|Test Street|Mohammadpur|Call on arrival/);
    const reference = JSON.parse(persisted);
    expect(reference.ownerKind).toBe("guest");
    window.localStorage.setItem(cartStorageKey("live"), JSON.stringify({ ...emptyCart("live"), lines: [{ ...cartLine, quantity: 5 }] }));
    fireEvent.click(screen.getByRole("button", { name: "Check for receipt" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/orders/${order.id}`));
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(cartStorageKey("live"))!).lines[0].quantity).toBe(3);
    expect(window.localStorage.getItem(ATTEMPT_STORAGE_KEY)).toBeNull();
  });
  it("blocks stale account checkout without attempting quote or guest fallback", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ token: "expired_csrf", ownerKind: "account", account: null, sessionExpired: true })); vi.stubGlobal("fetch", fetch);
    render(<CartProvider source="live"><CheckoutForm initialAccount={account} /></CartProvider>);
    await screen.findByText(/checkout will not switch to a guest/);
    expect((screen.getByRole("button", { name: "Check price and availability" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/bff/Security/csrf"]);
  });
  it("invalidates an acknowledged quote after cart changes and requires another explicit review", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => url.endsWith("csrf") ? Response.json({ token: "fresh_csrf", ownerKind: "guest" }) : Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() })); vi.stubGlobal("fetch", fetch);
    render(<CartProvider source="live"><CheckoutForm initialAccount={null} /></CartProvider>);
    await waitFor(() => expect((screen.getByRole("button", { name: "Check price and availability" }) as HTMLButtonElement).disabled).toBe(false));
    fillContact(); fireEvent.click(screen.getByRole("button", { name: "Check price and availability" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /I reviewed this quote/ }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    await screen.findByText("The cart changed. Request a new quote before confirming.");
    expect((screen.getByRole("button", { name: "Place order" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity" }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(cartStorageKey("live"))!).lines[0].quantity).toBe(2));
    expect(screen.queryByRole("checkbox", { name: /I reviewed this quote/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Place order" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh quote" }));
    const freshReview = await screen.findByRole("checkbox", { name: /I reviewed this quote/ }) as HTMLInputElement;
    expect(freshReview.checked).toBe(false);
    expect((screen.getByRole("button", { name: "Place order" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(freshReview);
    expect((screen.getByRole("button", { name: "Place order" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
  });
  it("invalidates quote review when away-and-back quantity updates finish in one render batch", async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith("csrf") ? Response.json({ token: "fresh_csrf", ownerKind: "guest" }) : Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() }));
    vi.stubGlobal("fetch", fetch);
    function BatchedQuantityChanges() {
      const cart = useCart();
      return <button onClick={() => { cart.setQuantity(cartLine.productId, 3); cart.setQuantity(cartLine.productId, 2); }}>Change quantity away and back</button>;
    }
    render(<CartProvider source="live"><CheckoutForm initialAccount={null} /><BatchedQuantityChanges /></CartProvider>);
    await reviewQuote();
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    const held = withStorageLock(cartStorageKey("live"), async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    fireEvent.click(screen.getByRole("button", { name: "Change quantity away and back" }));
    await act(async () => { release.resolve(); await held; });
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(cartStorageKey("live"))!).lines[0].quantity).toBe(2));
    expect(screen.queryByRole("checkbox", { name: /I reviewed this quote/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Place order" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
  });
  it.each(["unsupported", "rejected"])("refuses a new checkout with %s Web Locks without creating or overwriting an attempt", async (mode) => {
    const fetch = vi.fn(async (url: string) => url.endsWith("csrf") ? Response.json({ token: "fresh_csrf", ownerKind: "guest" }) : Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", mode === "unsupported" ? {} : { locks: { request: vi.fn().mockRejectedValue(new Error("Denied")) } });
    render(<CartProvider source="live"><CheckoutForm initialAccount={null} /></CartProvider>);
    await reviewQuote();
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByText(/A new checkout cannot be started safely/);
    expect(readAttempt().reference).toBeNull();
    expect(window.localStorage.getItem(ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
  });
  it("refuses a new checkout when the durable attempt cannot be read", async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith("csrf") ? Response.json({ token: "fresh_csrf", ownerKind: "guest" }) : Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() }));
    vi.stubGlobal("fetch", fetch);
    render(<CartProvider source="live"><CheckoutForm initialAccount={null} /></CartProvider>);
    await reviewQuote();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByText(/A new checkout cannot be started safely/);
    expect(readAttempt().reference).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
  });
  it("retains the original unsent key across a storage-denied remount and sends nothing until persistence works", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("csrf")) return Response.json({ token: "fresh_csrf", ownerKind: "guest" });
      if (url.endsWith("quote")) return Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() });
      if (url === "/api/bff/Order") return Response.json(order);
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<CartProvider source="live"><CheckoutForm key="first" initialAccount={null} /></CartProvider>);
    await reviewQuote();
    const setItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === ATTEMPT_STORAGE_KEY) throw new Error("Quota exceeded");
      setItem.call(this, key, value);
    });
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByText(/No order was sent because its recovery reference could not be saved/);
    const reference = readAttempt().reference!;
    expect(reference).not.toBeNull(); expect(attemptMemory(reference)?.unsubmitted).toBe(true);
    expect(window.localStorage.getItem(ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
    view.rerender(<CartProvider source="live"><CheckoutForm key="returned" initialAccount={null} /></CartProvider>);
    await screen.findByText(`Attempt: ${reference.idempotencyKey}`);
    expect(screen.queryByRole("button", { name: "Check price and availability" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry the exact original request" }));
    await screen.findByText(/No order was sent. Restore browser storage/);
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
    read.mockRestore(); write.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry the exact original request" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/orders/${order.id}`));
    const posts = fetch.mock.calls.filter(([url]) => url === "/api/bff/Order");
    expect(posts).toHaveLength(1);
    const request = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => url === "/api/bff/Order")![1] as RequestInit;
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe(reference.idempotencyKey);
    expect(window.localStorage.getItem(ATTEMPT_STORAGE_KEY)).toBeNull();
  });
  it("recovers a lost response with the original key after storage denial, SPA remount, cart edits, and quote expiry", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    let posts = 0;
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.endsWith("csrf")) return Response.json({ token: "fresh_csrf", ownerKind: "guest" });
      if (url.endsWith("quote")) return Response.json({ ...quote, expiresAt });
      if (url === "/api/bff/Order") { if (++posts === 1) throw new Error("Lost response"); return Response.json(order); }
      if (url.includes("/Order/attempt/")) return Response.json({ code: "not_found" }, { status: 404 });
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<CartProvider source="live"><CheckoutForm key="first" initialAccount={null} /></CartProvider>);
    await reviewQuote(); fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByText(/The checkout is not resolved/);
    const reference = readAttempt().reference!;
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(cartStorageKey("live"))!).lines[0].quantity).toBe(3));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Denied"); });
    vi.stubGlobal("navigator", { locks: { request: vi.fn().mockRejectedValue(new Error("Denied")) } });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(expiresAt) + 1);
    view.rerender(<CartProvider source="live"><CheckoutForm key="returned" initialAccount={null} /></CartProvider>);
    await screen.findByText(`Attempt: ${reference.idempotencyKey}`);
    expect(screen.queryByRole("button", { name: "Check price and availability" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check for receipt" }));
    await screen.findByRole("button", { name: "Retry the exact original request" });
    fireEvent.click(screen.getByRole("button", { name: "Retry the exact original request" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/orders/${order.id}`));
    const orders = fetch.mock.calls.filter(([url]) => url === "/api/bff/Order");
    expect(orders).toHaveLength(2);
    for (const [, init] of orders) {
      expect(new Headers(init!.headers).get("Idempotency-Key")).toBe(reference.idempotencyKey);
      expect(JSON.parse(init!.body as string)).toEqual(orderRequest);
    }
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("quote"))).toHaveLength(1);
    expect(fetch.mock.calls.some(([url]) => url === `/api/bff/Order/attempt/${reference.idempotencyKey}`)).toBe(true);
    expect(screen.getByText("Quantity:").parentElement?.textContent).toBe("Quantity: 1");
    expect(attemptMemory(reference)).toBeUndefined();
  });
  it("allows persisted original-key recovery without Web Locks but refuses changed replay details", async () => {
    const reference = await createAttempt(orderRequest, quote.lines, "guest");
    window.localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(reference));
    vi.stubGlobal("navigator", {});
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.endsWith("csrf")) return Response.json({ token: "fresh_csrf", ownerKind: "guest" });
      if (url.includes("/Order/attempt/")) return Response.json({ code: "not_found" }, { status: 404 });
      if (url === "/api/bff/Order") return Response.json(order);
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    render(<CartProvider source="live"><CheckoutForm initialAccount={null} /></CartProvider>);
    await screen.findByRole("button", { name: "Check for receipt" });
    fireEvent.click(screen.getByRole("button", { name: "Check for receipt" }));
    await screen.findByRole("button", { name: "Replay the original checkout attempt" });
    fillContact();
    fireEvent.change(screen.getByLabelText("Bangladesh mobile number"), { target: { value: "01912345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Replay the original checkout attempt" }));
    await screen.findByText(/These details do not match the original attempt/);
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Bangladesh mobile number"), { target: { value: orderRequest.contact.phone } });
    fireEvent.click(screen.getByRole("button", { name: "Replay the original checkout attempt" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/orders/${order.id}`));
    const orders = fetch.mock.calls.filter(([url]) => url === "/api/bff/Order");
    expect(orders).toHaveLength(1);
    expect(new Headers(orders[0][1]!.headers).get("Idempotency-Key")).toBe(reference.idempotencyKey);
  });
  it("serializes overlapping confirmations and never replaces a key created while awaiting the lock", async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith("csrf") ? Response.json({ token: "fresh_csrf", ownerKind: "guest" }) : Response.json({ ...quote, expiresAt: new Date(Date.now() + 900_000).toISOString() }));
    vi.stubGlobal("fetch", fetch);
    render(<CartProvider source="live"><CheckoutForm initialAccount={null} /></CartProvider>);
    await reviewQuote();
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    const held = withStorageLock(ATTEMPT_STORAGE_KEY, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    const other = await createAttempt(orderRequest, quote.lines, "guest");
    window.localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(other));
    await act(async () => { release.resolve(); await held; });
    await screen.findByText(`Attempt: ${other.idempotencyKey}`);
    expect(window.localStorage.getItem(ATTEMPT_STORAGE_KEY)).toBe(JSON.stringify(other));
    expect(fetch.mock.calls.filter(([url]) => url === "/api/bff/Order")).toHaveLength(0);
  });
});
