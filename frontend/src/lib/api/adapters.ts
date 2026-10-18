import { UNCATEGORIZED, getCategory } from "@/data/categories.mock";
import { slugify } from "@/lib/slug";
import { ApiOrderStatus } from "@/types/api";
import type {
  ApiOrder,
  ApiProduct,
  ApiProductImage,
  ApiProductSpecification,
  CreateOrderRequest,
} from "@/types/api";
import type {
  CartLine,
  DeliveryAddress,
  PaymentMethodId,
  Product,
  ProductSpec,
} from "@/types/domain";

/**
 * Adapters between the frontend domain and the ASP.NET wire shapes.
 *
 * The current `Product` entity carries a slug, brand, category, images and
 * specifications, so the catalogue screens can show real data. Optional fields
 * still receive stable fallbacks so a partially filled row never breaks a page.
 */

/** `Guid.Empty` — used where a non-nullable Guid has no meaningful value yet. */
export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** Whole taka, rounded; anything missing or non-finite becomes zero. */
function toTaka(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : 0;
}

/** Non-negative whole units; anything missing or non-finite becomes zero. */
function toStock(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

/**
 * Builds a URL-safe, collision-resistant slug from a product name.
 *
 * The entity has `ProductSlug`, so it is used when present. Older rows (or a
 * future endpoint that omits it) fall back to the name plus the id tail.
 */
export function productSlugFor(api: ApiProduct): string {
  const slug = api.productSlug?.trim();
  if (slug) return slug;

  const suffix = api.productId.replace(/-/g, "").slice(-8);
  return `${slugify(api.productName)}-${suffix}`;
}

/** Uploaded imagery in display order, or the category placeholder. */
export function productImagesFor(
  api: Pick<ApiProduct, "productImages" | "productCategorySlug">,
): string[] {
  const images = [...(api.productImages ?? [])]
    .filter(
      (image: ApiProductImage) =>
        typeof image?.url === "string" && image.url.trim().length > 0,
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((image) => image.url.trim());

  if (images.length > 0) return images;

  return [getCategory(api.productCategorySlug ?? undefined).image];
}

/** Wire specifications as UI spec rows, dropping blank keys or values. */
export function productSpecsFor(
  api: Pick<ApiProduct, "productSpecifications">,
): ProductSpec[] {
  return (api.productSpecifications ?? [])
    .map((spec: ApiProductSpecification) => ({
      label: spec.productSpecificationKey?.trim() ?? "",
      value: spec.productSpecificationValue?.trim() ?? "",
    }))
    .filter((spec) => spec.label.length > 0 && spec.value.length > 0);
}

/** Maps a wire product into the shape the UI expects. */
export function apiProductToProduct(api: ApiProduct): Product {
  const categorySlug =
    api.productCategorySlug?.trim() || UNCATEGORIZED.slug;
  const price = toTaka(api.productPrice);
  const compareAtPrice = toTaka(api.productComparePrice);

  return {
    id: api.productId,
    slug: productSlugFor(api),
    name: api.productName,
    brand: api.brandName?.trim() || "Unbranded",
    categorySlug,
    description: api.productDescription ?? "",
    price,
    compareAtPrice: compareAtPrice > price ? compareAtPrice : undefined,
    stock: toStock(api.productStockQuantity),
    images: productImagesFor(api),
    specs: productSpecsFor(api),
    featured: api.featured === true,
  };
}

/** The inverse: the scalar fields the entity can accept. */
export function productToApiProduct(product: Product): ApiProduct {
  return {
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    brandName: product.brand,
    productCategorySlug: product.categorySlug,
    productDescription: product.description,
    productPrice: product.price,
    productComparePrice: product.compareAtPrice ?? null,
    productStockQuantity: product.stock,
    featured: product.featured ?? false,
  };
}

/**
 * A cart line flattened to a wire product. The description is not known at
 * cart time (the line only carries what the card needed), so it is sent empty.
 */
export function cartLineToApiProduct(line: CartLine): ApiProduct {
  return {
    productId: line.productId,
    productSlug: line.slug,
    productName: line.name,
    brandName: line.brand,
    productDescription: "",
    productPrice: line.unitPrice,
    productStockQuantity: line.quantity,
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
