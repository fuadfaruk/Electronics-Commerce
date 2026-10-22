import { describe, expect, it } from "vitest";
import type { CategoryDto, ProductDto } from "@/types/api";
import { availableOrderActions, categoryInput, pageNumber, productInput, stockInput } from "./forms";

const category: CategoryDto = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", slug: "audio", name: "Audio",
  description: "Audio equipment", visualKey: "audio", sortOrder: 1,
  isArchived: false, version: 4, productCount: 1,
};
const product: ProductDto = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", slug: "original-headphones", name: "Headphones",
  brand: "", categoryId: category.id, categoryName: category.name, categorySlug: category.slug,
  description: "Closed-back headphones", price: 4000, compareAtPrice: null,
  stock: 7, version: 9, featured: false, isArchived: false, saleEligible: true, images: [], specs: [],
};

function productForm() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ slug: "changed-slug", name: "Updated headphones", brand: "", categoryId: category.id, description: "Updated description", price: "4500", compareAtPrice: "5000", stock: "999", expectedVersion: "999" })) data.set(key, value);
  return data;
}

describe("admin metadata inputs", () => {
  it("keeps the stored product slug/version and excludes absolute stock", () => {
    const body = productInput(productForm(), [category], product);
    expect(body.slug).toBe(product.slug);
    expect(body.expectedVersion).toBe(product.version);
    expect(body).not.toHaveProperty("stock");
    expect(body.price).toBe(4500);
    expect(body.brand).toBe("");
  });

  it.each(["1.5", "1,000", "0", "1e3", "1000000000"])("rejects non-whole or out-of-range sale price %s", (value) => {
    const data = productForm();
    data.set("price", value);
    expect(() => productInput(data, [category], product)).toThrow();
  });

  it("rejects compare prices that do not exceed the sale price", () => {
    const data = productForm();
    data.set("compareAtPrice", "4500");
    expect(() => productInput(data, [category], product)).toThrow("greater than");
  });

  it("does not newly assign an archived category but allows keeping it", () => {
    const archived = { ...category, isArchived: true };
    expect(() => productInput(productForm(), [archived])).toThrow("active category");
    expect(productInput(productForm(), [archived], product).categoryId).toBe(category.id);
  });

  it("preserves image/spec ordering and rejects unsafe image schemes and credentials", () => {
    const data = productForm();
    data.append("image", "https://images.example.com/front.jpg");
    data.append("image", "https://images.example.com/back.jpg");
    data.append("specLabel", "Display");
    data.append("specValue", "OLED");
    const body = productInput(data, [category], product);
    expect(body.images).toEqual(["https://images.example.com/front.jpg", "https://images.example.com/back.jpg"]);
    expect(body.specs).toEqual([{ label: "Display", value: "OLED" }]);
    data.set("image", "http://images.example.com/front.jpg");
    expect(() => productInput(data, [category], product)).toThrow("HTTPS");
    data.set("image", "https://user:password@images.example.com/front.jpg");
    expect(() => productInput(data, [category], product)).toThrow("credentials");
  });

  it("enforces image/spec limits and complete structured pairs", () => {
    const data = productForm();
    for (let index = 0; index < 11; index++) data.append("image", `https://images.example.com/${index}.jpg`);
    expect(() => productInput(data, [category], product)).toThrow("10");
    data.delete("image");
    data.append("specLabel", "Display");
    expect(() => productInput(data, [category], product)).toThrow("complete");
    data.append("specValue", "");
    expect(() => productInput(data, [category], product)).toThrow("value");
  });

  it("keeps the stored category slug/version and rejects a non-allowlisted visual", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ slug: "changed", name: "Speakers", description: "Home audio", visualKey: "audio", sortOrder: "3" })) data.set(key, value);
    expect(categoryInput(data, category)).toEqual({ slug: "audio", name: "Speakers", description: "Home audio", visualKey: "audio", sortOrder: 3, expectedVersion: 4 });
    data.set("visualKey", "https://example.com/arbitrary.svg");
    expect(() => categoryInput(data, category)).toThrow();
  });
});

describe("admin commands", () => {
  function adjustment(quantity: string, direction = "add", reason = "Inventory received") {
    const data = new FormData();
    data.set("quantity", quantity); data.set("direction", direction); data.set("reason", reason);
    return data;
  }

  it("submits a delta, latest rendered version and required reason, never absolute stock", () => {
    expect(stockInput(adjustment("3", "remove", "Damaged units"), product)).toEqual({ delta: -3, expectedVersion: 9, reason: "Damaged units" });
    expect(() => stockInput(adjustment("8", "remove"), product)).toThrow("non-negative");
    expect(() => stockInput(adjustment("0"), product)).toThrow();
    expect(() => stockInput(adjustment("1.5"), product)).toThrow();
    expect(() => stockInput(adjustment("1", "add", ""), product)).toThrow();
    expect(() => stockInput(adjustment("1000001"), product)).toThrow();
    expect(() => stockInput(adjustment("1000000"), product)).toThrow("non-negative");
    expect(stockInput(adjustment("999993"), product).delta).toBe(999993);
  });

  it("allows only sequential fulfillment, pre-shipment cancellation and Delivered-only collection", () => {
    expect(availableOrderActions({ fulfillment: "Pending", payment: "Unpaid" })).toEqual(["Confirmed", "cancel"]);
    expect(availableOrderActions({ fulfillment: "Confirmed", payment: "Unpaid" })).toEqual(["Shipped", "cancel"]);
    expect(availableOrderActions({ fulfillment: "Shipped", payment: "Unpaid" })).toEqual(["Delivered"]);
    expect(availableOrderActions({ fulfillment: "Delivered", payment: "Unpaid" })).toEqual(["collect"]);
    expect(availableOrderActions({ fulfillment: "Delivered", payment: "Collected" })).toEqual([]);
    expect(availableOrderActions({ fulfillment: "Cancelled", payment: "Unpaid" })).toEqual([]);
  });

  it("bounds pagination input", () => {
    expect(pageNumber("2")).toBe(2);
    expect(pageNumber(["3", "4"])).toBe(3);
    expect(pageNumber("10000000000")).toBe(1);
    expect(pageNumber("-1")).toBe(1);
  });
});
