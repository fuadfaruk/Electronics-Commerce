/** Dedicated commerce DTOs, serialized as camelCase JSON by /api/v1. */
export type StorefrontMode = "live" | "mock";
export type OwnerKind = "account" | "guest";

export interface ProductDto {
  id: string;
  slug: string;
  name: string;
  brand: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  description: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  version: number;
  featured: boolean;
  isArchived: boolean;
  saleEligible: boolean;
  images: string[];
  specs: { label: string; value: string }[];
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  visualKey: string;
  sortOrder: number;
  isArchived: boolean;
  version: number;
  productCount: number;
}

export interface CatalogFacetsDto {
  brands: { value: string; count: number }[];
  categories: { slug: string; name: string; count: number }[];
  minPrice: number;
  maxPrice: number;
}

export interface CatalogPageDto {
  items: ProductDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  facets: CatalogFacetsDto;
}

export interface ProductDetailDto {
  product: ProductDto;
  related: ProductDto[];
}

export interface HomeDto {
  featured: ProductDto[];
  deals: ProductDto[];
  newArrivals: ProductDto[];
}

export interface AccountDto {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
}

export interface CsrfDto {
  token: string;
  ownerKind: OwnerKind;
  account?: AccountDto;
  sessionExpired?: true;
}

export interface QuoteItem {
  productId: string;
  quantity: number;
}

export interface MoneyDto {
  currency: "BDT";
  subtotal: number;
  delivery: number;
  total: number;
  policyVersion: "bdt-cod-v1";
}

export interface OrderLineDto extends QuoteItem {
  name: string;
  slug: string;
  unitPrice: number;
  lineTotal: number;
}

export interface QuoteDto {
  quoteId: string;
  expiresAt: string;
  ownerKind: OwnerKind;
  lines: (OrderLineDto & { availableStock: number })[];
  money: MoneyDto;
  problems: { productId: string; code: string; message: string }[];
}

export interface ContactDto {
  name: string;
  email: string;
  phone: string;
}

export interface DeliveryAddressDto {
  street: string;
  area: string;
  city: string;
  district: string;
  postcode?: string;
}

export interface PlaceOrderRequest {
  quoteId: string;
  contact: ContactDto;
  deliveryAddress: DeliveryAddressDto;
  notes?: string;
}

export const FULFILLMENT_STATES = [
  "Pending", "Confirmed", "Shipped", "Delivered", "Cancelled",
] as const;
export type Fulfillment = (typeof FULFILLMENT_STATES)[number];
export type Payment = "Unpaid" | "Collected";

/** Immutable acceptance receipt, without fulfillment or payment tracking. */
export interface OrderReceiptDto {
  id: string;
  number: string;
  createdAt: string;
  money: MoneyDto;
  lines: OrderLineDto[];
}

export interface OrderDto extends OrderReceiptDto {
  fulfillment: Fulfillment;
  payment: Payment;
  version: number;
  contact: ContactDto;
  deliveryAddress: DeliveryAddressDto;
  notes: string | null;
  events: {
    action: string;
    createdAt: string;
    note: string | null;
    actorId: string | null;
    version: number;
  }[];
}

export interface OrderSummaryDto {
  id: string;
  number: string;
  createdAt: string;
  fulfillment: Fulfillment;
  payment: Payment;
  total: number;
  version: number;
}

export interface PagedOrdersDto {
  items: OrderSummaryDto[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** Only fixed safe text and a validated correlation identifier cross this boundary. */
export interface ApiProblem {
  code: string;
  title: string;
  detail: string;
  status: number;
  traceId?: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; problem: ApiProblem };
