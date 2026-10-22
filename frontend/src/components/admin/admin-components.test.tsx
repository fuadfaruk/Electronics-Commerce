// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryDto, OrderDto, ProductDto } from "@/types/api";
import { ApiRequestError } from "@/lib/api/errors";
import { CategoryEditor } from "./category-editor";
import { OrderActions } from "./order-actions";
import { OrderSnapshot } from "./order-snapshot";
import { ProductEditor } from "./product-editor";
import { RecordLifecycle } from "./record-lifecycle";
import { StockAdjustment } from "./stock-adjustment";
import AdminError from "@/app/admin/error";
import { AdminAccessNotice } from "./notices";

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ commerceMutation: mocks.mutation }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }), unstable_rethrow: () => {} }));

const staffId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const category: CategoryDto = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", slug: "audio", name: "Audio", description: "Audio equipment", visualKey: "audio", sortOrder: 1, isArchived: false, version: 4, productCount: 1 };
const product: ProductDto = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", slug: "headphones", name: "Headphones", brand: "Example", categoryId: category.id, categoryName: "Audio", categorySlug: "audio", description: "Headphones description", price: 4000, compareAtPrice: null, stock: 7, version: 9, featured: false, isArchived: false, saleEligible: true, images: ["https://images.example.com/front.jpg", "https://images.example.com/back.jpg"], specs: [{ label: "Driver", value: "40 mm" }] };
const order: OrderDto = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd", number: "EM-20261022-0001", createdAt: "2026-10-22T10:00:00Z", fulfillment: "Pending", payment: "Unpaid", version: 3,
  contact: { name: "Original recipient", email: "recipient@example.com", phone: "01712345678" }, deliveryAddress: { street: "5 Original Street", area: "Dhanmondi", city: "Dhaka", district: "Dhaka" },
  money: { currency: "BDT", subtotal: 4000, delivery: 80, total: 4080, policyVersion: "bdt-cod-v1" }, notes: "Call on arrival",
  lines: [{ productId: product.id, name: "Original product name", slug: "original-product-slug", quantity: 1, unitPrice: 4000, lineTotal: 4000 }],
  events: [{ action: "Confirmed", createdAt: "2026-10-22T11:00:00Z", note: "Customer confirmed phone", actorId: staffId, version: 3 }],
};

beforeEach(() => { mocks.mutation.mockReset(); mocks.refresh.mockReset(); mocks.push.mockReset(); });
afterEach(cleanup);

describe("admin category/product editors", () => {
  it("uses structured product fields, immutable slug and a metadata-only PUT", async () => {
    mocks.mutation.mockResolvedValue({ ...product, version: 10 });
    render(<ProductEditor product={product} categories={[category]} staffId={staffId} />);
    expect((screen.getByLabelText("Permanent URL slug") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByLabelText(/absolute stock/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move image 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save product details" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(1));
    const [path, body, , options] = mocks.mutation.mock.calls[0];
    expect(path).toBe(`Admin/products/${product.id}`);
    expect(body.slug).toBe("headphones");
    expect(body.expectedVersion).toBe(9);
    expect(body).not.toHaveProperty("stock");
    expect(body.images[0]).toBe("https://images.example.com/back.jpg");
    expect(body.specs).toEqual([{ label: "Driver", value: "40 mm" }]);
    expect(options).toMatchObject({ method: "PUT", mode: "live", expectedOwner: "account", expectedAccountId: staffId });
  });

  it("saves a category without permitting slug edits", async () => {
    mocks.mutation.mockResolvedValue(category);
    render(<CategoryEditor category={category} staffId={staffId} />);
    expect((screen.getByLabelText("URL slug") as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Speakers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(1));
    expect(mocks.mutation.mock.calls[0][1]).toMatchObject({ name: "Speakers", slug: "audio", expectedVersion: 4 });
  });

  it("does not offer deletion for a referenced category or any product", () => {
    const view = render(<RecordLifecycle kind="categories" record={category} staffId={staffId} />);
    expect(screen.queryByRole("button", { name: "Delete category" })).toBeNull();
    expect(screen.getByText(/Cannot delete: 1 products reference/)).toBeDefined();
    view.rerender(<RecordLifecycle kind="products" record={product} staffId={staffId} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("requires confirmation and a version query for unreferenced category deletion", async () => {
    mocks.mutation.mockResolvedValue(null);
    render(<RecordLifecycle kind="categories" record={{ ...category, isArchived: true, productCount: 0 }} staffId={staffId} />);
    fireEvent.click(screen.getByLabelText(/Permanently delete Audio/));
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(1));
    expect(mocks.mutation.mock.calls[0][3].method).toBe("DELETE");
    expect(mocks.mutation.mock.calls[0][3].query.get("expectedVersion")).toBe("4");
  });
});

describe("versioned stock commands", () => {
  function fillStock() {
    fireEvent.change(screen.getByLabelText("Quantity to adjust"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Reason for adjustment"), { target: { value: "Supplier receipt 123" } });
  }

  it("sends one delta command with an idempotency key even after repeated clicks", async () => {
    let resolve!: (value: unknown) => void;
    mocks.mutation.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<StockAdjustment product={product} staffId={staffId} />);
    fillStock();
    const button = screen.getByRole("button", { name: "Apply stock adjustment" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(1));
    expect(mocks.mutation.mock.calls[0][1]).toEqual({ delta: 3, expectedVersion: 9, reason: "Supplier receipt 123" });
    expect(mocks.mutation.mock.calls[0][3].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    await act(async () => resolve({ productId: product.id, stock: 10, version: 10 }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("locks a stale version and offers reload after 409", async () => {
    mocks.mutation.mockRejectedValue(new ApiRequestError({ status: 409, code: "VERSION_CONFLICT" }));
    render(<StockAdjustment product={product} staffId={staffId} />);
    fillStock();
    fireEvent.click(screen.getByRole("button", { name: "Apply stock adjustment" }));
    await screen.findByText(/record changed.*409/);
    expect((screen.getByRole("button", { name: "Apply stock adjustment" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Reload current record" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Apply stock adjustment" }));
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
  });

  it("retries an uncertain response using the same payload and original key", async () => {
    mocks.mutation.mockRejectedValueOnce(new ApiRequestError({ status: 503 }));
    mocks.mutation.mockResolvedValueOnce({ productId: product.id, stock: 10, version: 10 });
    render(<StockAdjustment product={product} staffId={staffId} />);
    fillStock();
    fireEvent.click(screen.getByRole("button", { name: "Apply stock adjustment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry original adjustment safely" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(2));
    expect(mocks.mutation.mock.calls[1][1]).toBe(mocks.mutation.mock.calls[0][1]);
    expect(mocks.mutation.mock.calls[1][3].idempotencyKey).toBe(mocks.mutation.mock.calls[0][3].idempotencyKey);
  });
});

describe("staff order actions and snapshots", () => {
  it("shows only the next fulfillment step and pre-shipment cancellation", () => {
    const view = render(<OrderActions order={order} staffId={staffId} />);
    expect(screen.getByRole("option", { name: "Confirm order" })).toBeDefined();
    expect(screen.getByRole("option", { name: "Cancel before shipment" })).toBeDefined();
    expect(screen.queryByRole("option", { name: "Mark shipped" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Record customer cash received" })).toBeNull();
    view.rerender(<OrderActions key="shipped" order={{ ...order, fulfillment: "Shipped" }} staffId={staffId} />);
    expect(screen.getByRole("option", { name: "Mark delivered" })).toBeDefined();
    expect(screen.queryByRole("option", { name: "Cancel before shipment" })).toBeNull();
  });

  it("records full customer cash only when Delivered, with version/note/idempotency", async () => {
    const delivered = { ...order, fulfillment: "Delivered" as const };
    mocks.mutation.mockResolvedValue({ ...delivered, payment: "Collected", version: 4 });
    render(<OrderActions order={delivered} staffId={staffId} />);
    fireEvent.change(screen.getByLabelText("Staff note (optional)"), { target: { value: "Cash received at delivery" } });
    fireEvent.click(screen.getByLabelText(/full customer cash payment has been received/));
    fireEvent.click(screen.getByRole("button", { name: "Record customer cash received" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(1));
    expect(mocks.mutation.mock.calls[0][0]).toBe(`Admin/orders/${order.id}/collect`);
    expect(mocks.mutation.mock.calls[0][1]).toEqual({ expectedVersion: 3, note: "Cash received at delivery" });
    expect(mocks.mutation.mock.calls[0][3]).toMatchObject({ expectedAccountId: staffId, expectedOwner: "account" });
    expect(mocks.mutation.mock.calls[0][3].idempotencyKey).toBeTruthy();
  });

  it("requires a cancellation reason rather than exposing arbitrary statuses", async () => {
    mocks.mutation.mockResolvedValue({ ...order, fulfillment: "Cancelled", version: 4 });
    render(<OrderActions order={order} staffId={staffId} />);
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "cancel" } });
    const note = screen.getByLabelText("Cancellation reason") as HTMLTextAreaElement;
    expect(note.required).toBe(true);
    fireEvent.change(note, { target: { value: "Customer requested by phone" } });
    fireEvent.click(screen.getByLabelText(/I reviewed order/));
    fireEvent.click(screen.getByRole("button", { name: "Cancel before shipment" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(1));
    expect(mocks.mutation.mock.calls[0][0]).toBe(`Admin/orders/${order.id}/cancel`);
    expect(mocks.mutation.mock.calls[0][1]).toEqual({ expectedVersion: 3, note: "Customer requested by phone" });
  });

  it("requires fresh confirmation when the chosen order action changes", () => {
    render(<OrderActions order={order} staffId={staffId} />);
    fireEvent.click(screen.getByLabelText(/I reviewed order/));
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "cancel" } });
    expect((screen.getByLabelText(/I reviewed order/) as HTMLInputElement).checked).toBe(false);
  });

  it("renders original contact/money/line snapshots and actor/time/note/version events", () => {
    render(<OrderSnapshot order={order} />);
    expect(screen.getByText("Original recipient")).toBeDefined();
    expect(screen.getByText("recipient@example.com")).toBeDefined();
    expect(screen.getByText("Original product name")).toBeDefined();
    expect(screen.getByText("/original-product-slug")).toBeDefined();
    expect(screen.getByText("bdt-cod-v1")).toBeDefined();
    expect(screen.getByText(staffId)).toBeDefined();
    expect(screen.getByText("Customer confirmed phone")).toBeDefined();
    expect(screen.getByText("Version 3")).toBeDefined();
    expect(screen.getAllByText(/Dhaka time/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("staff access and safe route errors", () => {
  it("links to shared staff sign-in without role management", () => {
    render(<AdminAccessNotice failure={{ ok: false, reason: "unauthenticated" }} returnTo="/admin/orders" />);
    expect(screen.getByRole("link", { name: "Staff sign in" }).getAttribute("href")).toBe("/account/login?next=%2Fadmin%2Forders");
    expect(screen.queryByRole("link", { name: /sign.?up|manage roles/i })).toBeNull();
  });

  it("uses Next retry without rendering raw server errors", () => {
    const retry = vi.fn();
    render(<AdminError error={new Error("https://internal.invalid/password=secret")} retry={retry} />);
    expect(screen.queryByText(/internal.invalid/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try loading again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
