/**
 * Wire shapes: a 1:1 mirror of the ASP.NET entities the storefront talks to.
 *
 * Source of truth: `backend/src/ElectroApi.Core/Entities/*` and
 * `backend/src/ElectroApi.Core/Enums/OrderStatus.cs`. The `backend/` folder is
 * read-only for this project — nothing here changes it.
 *
 * Remaining gaps in the current API (documented in detail in the README):
 *   - Product prices are `decimal?`, so a product can have no price.
 *   - There is no product-by-slug endpoint, so the catalog fetches the list
 *     once per request, resolves slugs from it, and fetches details by GUID.
 *   - `Order.ProductIds` is a list while the order entity has `Products` too.
 *   - `Order.Address` is a `List<string>`, not a structured address.
 */

/** `electroapi.core.Entities.ProductImage` */
export interface ApiProductImage {
  id: string;
  url: string;
  order: number;
}

/** `electroapi.core.Entities.ProductSpecification` */
export interface ApiProductSpecification {
  productSpecificationId: string;
  productSpecificationKey: string;
  productSpecificationValue: string;
}

/** `electroapi.core.Entities.Product` as serialised by System.Text.Json. */
export interface ApiProduct {
  productId: string;
  productSlug: string;
  productName: string;
  brandName?: string | null;
  productCategorySlug?: string | null;
  productDescription?: string | null;
  /** Decimal on the server; whole taka in practice. */
  productPrice?: number | null;
  productComparePrice?: number | null;
  productStockQuantity?: number | null;
  productImages?: ApiProductImage[] | null;
  productSpecifications?: ApiProductSpecification[] | null;
  featured?: boolean;
}

/** Public error details that can be rendered in development and production. */
export interface ApiProblem {
  title: string;
  detail: string;
  status?: number;
  method?: string;
  url?: string;
  type?: string;
  traceId?: string;
  cause?: string;
  errors?: Record<string, string[]>;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; problem: ApiProblem };

/** `electroapi.core.Entities.User` — note: no password, no roles. */
export interface ApiUser {
  id: string;
  name: string;
  email: string;
}

/** `electroapi.core.Enums.OrderStatus` */
export const ApiOrderStatus = {
  Pending: 0,
  Paid: 1,
  Shipped: 2,
  Cancelled: 3,
} as const;

export type ApiOrderStatus =
  (typeof ApiOrderStatus)[keyof typeof ApiOrderStatus];

export const API_ORDER_STATUS_LABELS: Record<ApiOrderStatus, string> = {
  [ApiOrderStatus.Pending]: "Pending",
  [ApiOrderStatus.Paid]: "Paid",
  [ApiOrderStatus.Shipped]: "Shipped",
  [ApiOrderStatus.Cancelled]: "Cancelled",
};

/** `electroapi.core.Entities.Order` as serialised by System.Text.Json. */
export interface ApiOrder {
  id: string;
  userId: string;
  user: ApiUser;
  /** A single `Guid` on the server, despite `products` being a list. */
  productIds: string;
  products: ApiProduct[];
  /** ISO-8601 string. */
  orderDate: string;
  address: string[];
  orderStatus: ApiOrderStatus;
}

/** `POST /api/Order` currently accepts the entity directly. */
export type CreateOrderRequest = ApiOrder;

export const API_ROUTES = {
  products: "/api/v1/Product",
  orders: "/api/Order",
} as const;

/** Configured in `.env.local`. Trailing slashes are dropped by the client. */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5249"
).replace(/\/+$/, "");

/**
 * While true the storefront reads `src/data/products.mock.ts` and performs no
 * network request. Set `NEXT_PUBLIC_USE_MOCK_DATA=false` to read the catalog
 * from `GET /api/v1/Product` instead.
 */
export const USE_MOCK_DATA =
  (process.env.NEXT_PUBLIC_USE_MOCK_DATA ?? "true") !== "false";
