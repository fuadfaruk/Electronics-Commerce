// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryDto, ProductDto } from "@/types/api";
import { RecordLifecycle } from "./record-lifecycle";
import { StockAdjustment } from "./stock-adjustment";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }), unstable_rethrow: () => {} }));

const staff = { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Staff", email: "staff@example.com", emailVerified: true, isAdmin: true };
const category: CategoryDto = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", slug: "audio", name: "Audio", description: "", visualKey: "audio", sortOrder: 1, isArchived: true, version: 4, productCount: 0 };
const product: ProductDto = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", slug: "headphones", name: "Headphones", brand: "", categoryId: category.id, categoryName: "Audio", categorySlug: "audio", description: "", price: 4000, compareAtPrice: null, stock: 7, version: 9, featured: false, isArchived: false, saleEligible: true, images: [], specs: [] };

beforeEach(() => { mocks.refresh.mockReset(); mocks.push.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("admin browser BFF boundary", () => {
  it("refreshes CSRF for the original stock command and its exact idempotent retry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: "fresh-token-1", ownerKind: "account", account: staff }))
      .mockResolvedValueOnce(Response.json({ code: "temporarily_unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ token: "fresh-token-2", ownerKind: "account", account: staff }))
      .mockResolvedValueOnce(Response.json({ productId: product.id, stock: 9, version: 10 }));
    vi.stubGlobal("fetch", fetch);
    render(<StockAdjustment product={product} staffId={staff.id} />);
    fireEvent.change(screen.getByLabelText("Quantity to adjust"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Reason for adjustment"), { target: { value: "Supplier receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply stock adjustment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry original adjustment safely" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/bff/Security/csrf", `/api/bff/Admin/products/${product.id}/stock`,
      "/api/bff/Security/csrf", `/api/bff/Admin/products/${product.id}/stock`,
    ]);
    const first = fetch.mock.calls[1][1] as RequestInit;
    const retry = fetch.mock.calls[3][1] as RequestInit;
    expect(new Headers(first.headers).get("X-CSRF-Token")).toBe("fresh-token-1");
    expect(new Headers(retry.headers).get("X-CSRF-Token")).toBe("fresh-token-2");
    expect(new Headers(first.headers).get("Idempotency-Key")).toBe(new Headers(retry.headers).get("Idempotency-Key"));
    expect(retry.body).toBe(first.body);
    expect(JSON.parse(String(first.body))).toEqual({ delta: 2, expectedVersion: 9, reason: "Supplier receipt" });
    expect(first).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
  });

  it("deletes only through the BFF after fresh CSRF, with version query and no entity body", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: "fresh-delete-token", ownerKind: "account", account: staff }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    render(<RecordLifecycle kind="categories" record={category} staffId={staff.id} />);
    fireEvent.click(screen.getByLabelText(/Permanently delete Audio/));
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][0]).toBe("/api/bff/Security/csrf");
    expect(fetch.mock.calls[1][0]).toBe(`/api/bff/Admin/categories/${category.id}?expectedVersion=4`);
    const request = fetch.mock.calls[1][1] as RequestInit;
    expect(request.method).toBe("DELETE");
    expect(request.body).toBeUndefined();
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("fresh-delete-token");
  });

  it("does not send a staff command if fresh CSRF belongs to another account", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ token: "different-account-token", ownerKind: "account", account: { ...staff, id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" } }));
    vi.stubGlobal("fetch", fetch);
    render(<StockAdjustment product={product} staffId={staff.id} />);
    fireEvent.change(screen.getByLabelText("Quantity to adjust"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Reason for adjustment"), { target: { value: "Supplier receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply stock adjustment" }));
    await screen.findByText(/record changed.*409/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/bff/Security/csrf");
  });
});
