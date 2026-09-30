import { describe, expect, it } from "vitest";
import {
  CURRENCY_SYMBOL,
  discountPercent,
  formatAmount,
  formatBDT,
  savings,
} from "@/lib/money";

describe("formatBDT", () => {
  it("prefixes the taka sign and groups thousands", () => {
    expect(CURRENCY_SYMBOL).toBe("৳");
    expect(formatBDT(12500)).toBe("৳12,500");
    expect(formatBDT(1000000)).toBe("৳1,000,000");
  });

  it("shows no minor units, since backend prices are whole taka", () => {
    expect(formatBDT(0)).toBe("৳0");
    expect(formatBDT(890)).toBe("৳890");
    expect(formatBDT(1250.6)).toBe("৳1,251");
  });

  it("does not print NaN for bad input", () => {
    expect(formatBDT(Number.NaN)).toBe("৳0");
    expect(formatBDT(Number.POSITIVE_INFINITY)).toBe("৳0");
  });
});

describe("formatAmount", () => {
  it("groups without a symbol", () => {
    expect(formatAmount(5000)).toBe("5,000");
  });
});

describe("savings and discountPercent", () => {
  it("is zero when there is no compare-at price", () => {
    expect(savings({ price: 1000 })).toBe(0);
    expect(discountPercent({ price: 1000 })).toBe(0);
  });

  it("ignores a compare-at price that is not actually higher", () => {
    expect(savings({ price: 1000, compareAtPrice: 1000 })).toBe(0);
    expect(discountPercent({ price: 1000, compareAtPrice: 900 })).toBe(0);
  });

  it("computes the difference and floors the percentage", () => {
    expect(savings({ price: 189999, compareAtPrice: 199999 })).toBe(10000);
    expect(discountPercent({ price: 189999, compareAtPrice: 199999 })).toBe(5);
    expect(discountPercent({ price: 33999, compareAtPrice: 36999 })).toBe(8);
  });
});
