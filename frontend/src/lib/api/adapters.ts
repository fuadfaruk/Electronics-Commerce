import { UNCATEGORIZED } from "@/data/categories.mock";
import { slugify } from "@/lib/slug";
import { ApiOrderStatus } from "@/types/api";
import type { ApiOrder, ApiProduct, CreateOrderRequest } from "@/types/api";
import type {
  CartLine,
  DeliveryAddress,
  PaymentMethodId,
  Product,
} from "@/types/domain";

/**
 * Adapters between the frontend domain and the ASP.NET wire shapes.
 *
 * This is the file that documents, in code, exactly what the current backend
 * cannot express. Everything marked "synthesised" has no server field today.
 */

/** `Guid.Empty` — used where a non-nullable Guid has no meaningful value yet. */
export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/**
 * Builds a URL-safe, collision-resistant slug from a product name.
 * Synthesised: `Product` has no slug field, so it is derived from the name and
 * disambiguated with the tail of the id.
 */
export function productSlugFor(api: ApiProduct): string {
  const suffix = api.id.replace(/-/g, "").slice(-8);
  return `${slugify(api.productName)}-${suffix}`;
}

/**
 * Maps a wire product into the shape the UI expects.
 *
 * `brand`, `categorySlug`, `images` and `specs` are synthesised because the
 * entity carries none of them; a real integration would need those fields
 * before the listing and detail screens could show anything but placeholders.
 */
export function apiProductToProduct(api: ApiProduct): Product {
  return {
    id: api.id,
    slug: productSlugFor(api),
    name: api.productName,
    brand: "Unbranded",
    categorySlug: UNCATEGORIZED.slug,
    description: api.productDescription,
    price: api.productPrice,
    stock: api.productQuantity,
    images: [UNCATEGORIZED.image],
    specs: [],
  };
}

/** The inverse: only fields the entity actually has are carried over. */
export function productToApiProduct(product: Product): ApiProduct {
  return {
    id: product.id,
    productName: product.name,
    productDescription: product.description,
    productPrice: product.price,
    productQuantity: product.stock,
  };
}

/**
 * A cart line flattened to a wire product. The description is not known at
 * cart time (the line only carries what the card needed), so it is sent empty.
 */
export function cartLineToApiProduct(line: CartLine): ApiProduct {
  return {
    id: line.productId,
    productName: line.name,
    productDescription: "",
    productPrice: line.unitPrice,
    productQuantity: line.quantity,
  };
}

/**
 * `Order.Address` is a `List<string>`, not a structured address, so the form
 * fields are flattened into ordered lines. The order is meaningful: name,
 * phone, street, area, city, then any delivery note.
 */
export function deliveryAddressToLines(address: DeliveryAddress): string[] {
  const city = [address.city, address.postcode].filter(Boolean).join(" - ");
  return [
    address.fullName,
    address.phone,
    address.street,
    address.area,
    city,
    address.notes ?? "",
  ]
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Cash on delivery stays pending until the courier collects; the mobile
 * wallets are treated as paid once the payment is confirmed.
 */
export function orderStatusForPayment(
  method: PaymentMethodId,
): ApiOrderStatus {
  return method === "cod" ? ApiOrderStatus.Pending : ApiOrderStatus.Paid;
}

export interface BuildOrderPayloadInput {
  lines: CartLine[];
  address: DeliveryAddress;
  paymentMethod: PaymentMethodId;
  /** Optional so tests can pin the values. */
  id?: string;
  orderDate?: Date;
  /** Guest checkout has no account, so this stays `Guid.Empty` for now. */
  userId?: string;
}

/**
 * Builds the `POST /api/Order` body.
 *
 * Note `productIds`: the entity declares a single `Guid` alongside a list of
 * products, which cannot both be right. We send the first line's id there so
 * the field is populated, and the full list in `products`.
 */
export function buildOrderPayload({
  lines,
  address,
  paymentMethod,
  id,
  orderDate,
  userId,
}: BuildOrderPayloadInput): CreateOrderRequest {
  const resolvedUserId = userId ?? EMPTY_GUID;

  const payload: ApiOrder = {
    id: id ?? createId(),
    userId: resolvedUserId,
    user: {
      id: resolvedUserId,
      name: address.fullName,
      email: address.email,
    },
    productIds: lines[0]?.productId ?? EMPTY_GUID,
    products: lines.map(cartLineToApiProduct),
    orderDate: (orderDate ?? new Date()).toISOString(),
    address: deliveryAddressToLines(address),
    orderStatus: orderStatusForPayment(paymentMethod),
  };

  return payload;
}

/** `crypto.randomUUID` where available, with a non-cryptographic fallback. */
export function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
