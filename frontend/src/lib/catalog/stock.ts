import type { Product, StockLevel } from "@/types/domain";

/** At or below this many units we show "Only N left". */
export const LOW_STOCK_THRESHOLD = 5;

export function stockLevel(product: Pick<Product, "stock">): StockLevel {
  if (product.stock <= 0) return "out";
  if (product.stock <= LOW_STOCK_THRESHOLD) return "low";
  return "in";
}

export function isInStock(product: Pick<Product, "stock">): boolean {
  return product.stock > 0;
}
