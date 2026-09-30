/**
 * Frontend domain types.
 *
 * These are the shapes the UI talks in. They are deliberately richer than the
 * current ASP.NET entities (see `src/types/api.ts` for the wire shape and
 * `src/lib/api/adapters.ts` for the mapping and the documented gaps).
 */

export interface Category {
  /** Stable key used in URLs and filters, e.g. `smartphones`. */
  slug: string;
  name: string;
  /** One short line used on the home category tiles. */
  blurb: string;
  /** Path to the checked-in placeholder used on the tile. */
  image: string;
}

export interface ProductSpec {
  label: string;
  value: string;
}

/**
 * A sellable product.
 *
 * Prices are whole BDT taka and are VAT-inclusive, matching the `int`
 * `ProductPrice` field on the backend.
 */
export interface Product {
  id: string;
  /** URL segment for `/products/[slug]`. */
  slug: string;
  name: string;
  brand: string;
  /** Joins to `Category.slug`. Falls back to the uncategorised bucket. */
  categorySlug: string;
  description: string;
  /** Whole taka, VAT inclusive. */
  price: number;
  /** Mock-only: original price when the item is discounted. */
  compareAtPrice?: number;
  /** Mirrors `Product.ProductQuantity`. */
  stock: number;
  images: string[];
  specs: ProductSpec[];
  /** Mock-only: drives the home "Featured" rail. */
  featured?: boolean;
}

export type StockLevel = "out" | "low" | "in";

export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  brand: string;
  /** Unit price in whole taka, captured when the line was added. */
  unitPrice: number;
  image: string;
  quantity: number;
  /** Stock available at the time the line was added; caps the quantity. */
  stock: number;
}

export interface CartTotals {
  /** Sum of unit price x quantity. */
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** Total number of units in the cart. */
  itemCount: number;
  /** How much more is needed to unlock free delivery. 0 once unlocked. */
  freeDeliveryRemaining: number;
  qualifiesForFreeDelivery: boolean;
}

/** Payment options the checkout will offer later. Mock data only for now. */
export type PaymentMethodId = "cod" | "bkash" | "nagad";

export interface PaymentMethod {
  id: PaymentMethodId;
  name: string;
  description: string;
}

/** A structured delivery address, flattened to lines when sent to the API. */
export interface DeliveryAddress {
  fullName: string;
  phone: string;
  email: string;
  street: string;
  area: string;
  city: string;
  postcode?: string;
  notes?: string;
}
