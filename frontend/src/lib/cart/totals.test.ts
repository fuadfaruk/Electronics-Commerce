import { describe, expect, it } from "vitest";
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { calcTotals } from "@/lib/cart/totals";
import type { CartLine } from "@/types/domain";

function line(
  overrides: Partial<CartLine> & { unitPrice: number; quantity: number },
): CartLine {
  return {
    productId: "p1",
    slug: "test-product",
    name: "Test product",
    brand: "Test",
    image: "/placeholders/uncategorized.svg",
    stock: 99,
    ...overrides,
  };
}

describe("calcTotals", () => {
  it("owes nothing for an empty cart — not the delivery fee", () => {
    const totals = calcTotals([]);
    expect(totals.subtotal).toBe(0);
    expect(totals.deliveryFee).toBe(0);
    expect(totals.total).toBe(0);
    expect(totals.itemCount).toBe(0);
    expect(totals.qualifiesForFreeDelivery).toBe(false);
    expect(totals.freeDeliveryRemaining).toBe(FREE_DELIVERY_THRESHOLD);
  });

  it("adds the delivery fee below the threshold", () => {
    const totals = calcTotals([line({ unitPrice: 1000, quantity: 4 })]);
    expect(totals.subtotal).toBe(4000);
    expect(totals.deliveryFee).toBe(DELIVERY_FEE);
    expect(totals.total).toBe(4080);
    expect(totals.freeDeliveryRemaining).toBe(1000);
    expect(totals.qualifiesForFreeDelivery).toBe(false);
  });

  it("charges the fee one taka below the threshold", () => {
    const totals = calcTotals([line({ unitPrice: 4999, quantity: 1 })]);
    expect(totals.deliveryFee).toBe(DELIVERY_FEE);
    expect(totals.freeDeliveryRemaining).toBe(1);
  });

  it("drops the fee at exactly the threshold", () => {
    const totals = calcTotals([line({ unitPrice: 2500, quantity: 2 })]);
    expect(totals.subtotal).toBe(FREE_DELIVERY_THRESHOLD);
    expect(totals.qualifiesForFreeDelivery).toBe(true);
    expect(totals.deliveryFee).toBe(0);
    expect(totals.total).toBe(5000);
    expect(totals.freeDeliveryRemaining).toBe(0);
  });

  it("sums across lines when deciding eligibility", () => {
    const totals = calcTotals([
      line({ productId: "a", unitPrice: 2000, quantity: 1 }),
      line({ productId: "b", unitPrice: 3000, quantity: 1 }),
    ]);
    expect(totals.subtotal).toBe(5000);
    expect(totals.qualifiesForFreeDelivery).toBe(true);
  });

  it("counts units rather than lines", () => {
    const totals = calcTotals([
      line({ productId: "a", unitPrice: 100, quantity: 3 }),
      line({ productId: "b", unitPrice: 100, quantity: 2 }),
    ]);
    expect(totals.itemCount).toBe(5);
  });

  it("stays free above the threshold", () => {
    const totals = calcTotals([line({ unitPrice: 60000, quantity: 1 })]);
    expect(totals.deliveryFee).toBe(0);
    expect(totals.total).toBe(60000);
  });
});
