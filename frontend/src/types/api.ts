/**
 * Wire shapes: a 1:1 mirror of the ASP.NET entities the storefront will talk to
 * once the backend exposes a catalog.
 *
 * Source of truth: `backend/src/electroapi.core/Entities/*` and
 * `backend/src/electroapi.core/Enums/OrderStatus.cs`. The `backend/` folder is
 * read-only for this project — nothing here changes it.
 *
 * Known gaps in the current API (documented in detail in the README):
 *   - `Product` has no image, category, brand or slug.
 *   - `ProductPrice` is an `int`, so there are no minor units.
 *   - There is no product endpoint, and `ApplicationDbContext` has no
 *     `DbSet<Product>`, so nothing can list a catalog yet.
 *   - `Order.ProductIds` is a single `Guid` while `Products` is a list.
 *   - `Order.Address` is a `List<string>`, not a structured address.
 */

/** `electroapi.core.Entities.Product` */
export interface ApiProduct {
  id: string;
  productName: string;
  productDescription: string;
  /** Whole currency units — an `int` on the server. */
  productPrice: number;
  productQuantity: number;
}

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
  orders: "/api/Order",
} as const;

/** Configured in `.env.local`; unused while the mock is in charge. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5249";

/** While true the storefront never performs a network request. */
export const USE_MOCK_DATA =
  (process.env.NEXT_PUBLIC_USE_MOCK_DATA ?? "true") !== "false";
