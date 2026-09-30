/**
 * Money helpers.
 *
 * `Intl.NumberFormat` with `currency: "BDT"` renders "BDT 12,500" rather than
 * the taka sign, so the symbol is composed manually around a grouped number.
 */
export const CURRENCY_SYMBOL = "৳";

export const CURRENCY_CODE = "BDT";

const groupedNumber = new Intl.NumberFormat("en-BD", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Coerces anything numeric into a whole, non-negative-safe integer. */
function toWhole(amount: number): number {
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

/** `12500` -> `"৳12,500"` */
export function formatBDT(amount: number): string {
  return `${CURRENCY_SYMBOL}${groupedNumber.format(toWhole(amount))}`;
}

/** `12500` -> `"12,500"` — for places where the symbol is already shown. */
export function formatAmount(amount: number): string {
  return groupedNumber.format(toWhole(amount));
}

/** Saving on a discounted product, or 0 when there is no discount. */
export function savings(product: {
  price: number;
  compareAtPrice?: number;
}): number {
  if (product.compareAtPrice === undefined) return 0;
  const difference = product.compareAtPrice - product.price;
  return difference > 0 ? difference : 0;
}

/** Whole-percent discount, rounded down, or 0 when there is no discount. */
export function discountPercent(product: {
  price: number;
  compareAtPrice?: number;
}): number {
  const saved = savings(product);
  if (saved === 0 || !product.compareAtPrice) return 0;
  return Math.floor((saved / product.compareAtPrice) * 100);
}
