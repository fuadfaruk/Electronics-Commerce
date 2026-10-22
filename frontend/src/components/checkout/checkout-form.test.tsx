// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { CartProvider } from "@/lib/cart/store";
import { cartStorageKey, emptyCart } from "@/lib/cart/storage";
import { ATTEMPT_STORAGE_KEY } from "@/lib/checkout/attempt";
import { account, cartLine, order, orderRequest, quote } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks, unstable_rethrow: () => {} }));
vi.mock("@/components/product/product-image", () => ({ ProductImage: () => null }));
beforeEach(() => { window.localStorage.clear(); mocks.replace.mockReset(); mocks.refresh.mockReset(); vi.stubGlobal("crypto", webcrypto); window.localStorage.setItem(cartStorageKey("live"), JSON.stringify({ ...emptyCart("live"), lines: [cartLine] })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

function fillContact() {
  const fields = { "Recipient name": orderRequest.contact.name, "Email": orderRequest.contact.email, "Bangladesh mobile number": orderRequest.contact.phone, "Street and house": orderRequest.deliveryAddress.street, "Area": orderRequest.deliveryAddress.area, "City or town": orderRequest.deliveryAddress.city, "District": orderRequest.deliveryAddress.district, "Postcode (optional)": "1207", "Delivery notes (optional)": orderRequest.notes! };
  for (const [label, value] of Object.entries(fields)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("authoritative quote and uncertain COD recovery", () => {
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
    expect((screen.getByRole("button", { name: "Place COD order" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(acknowledgment); fireEvent.click(screen.getByRole("button", { name: "Place COD order" }));
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
});
