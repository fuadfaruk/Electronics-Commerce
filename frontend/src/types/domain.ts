import type { CategoryDto, ProductDto } from "@/types/api";

export interface Category extends CategoryDto {
  /** Local artwork selected from an allowlist, never an API supplied path. */
  image: string;
}

export interface Product extends Omit<ProductDto, "compareAtPrice"> {
  compareAtPrice?: number;
}

export type ProductSpec = ProductDto["specs"][number];
export type StockLevel = "out" | "low" | "in";

/** Display snapshots are estimates only; checkout always obtains an authoritative quote. */
export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  brand: string;
  unitPrice: number;
  image: string;
  quantity: number;
  stock: number;
}

export interface CartTotals {
  subtotal: number;
  deliveryFee: number;
  total: number;
  itemCount: number;
  freeDeliveryRemaining: number;
  qualifiesForFreeDelivery: boolean;
}
