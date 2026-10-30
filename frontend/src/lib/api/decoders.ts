import { ApiRequestError } from "@/lib/api/errors";
import { isHttpsImage, isLocalArtwork } from "@/lib/catalog/visuals";
import { FULFILLMENT_STATES } from "@/types/api";
import type {
  AccountDto, CategoryDto, CatalogPageDto, ContactDto, CsrfDto,
  DeliveryAddressDto, Fulfillment, HomeDto, MoneyDto, OrderDto, OrderReceiptDto,
  OrderLineDto, OrderSummaryDto, OwnerKind, PagedOrdersDto, Payment,
  ProductDetailDto, ProductDto, QuoteDto, StorefrontMode,
} from "@/types/api";

export const GUID_PATTERN = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function invalid(): never {
  throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 256, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid();
  return value;
}

export function whole(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

export function guid(value: unknown): string {
  const result = text(value, 36);
  if (!GUID_PATTERN.test(result)) invalid();
  return result.toLowerCase();
}

export function slug(value: unknown): string {
  const result = text(value, 160);
  if (!SLUG_PATTERN.test(result)) invalid();
  return result;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

export function array<T>(value: unknown, decode: (entry: unknown) => T, max = 100): T[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map(decode);
}

function date(value: unknown): string {
  const result = text(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) invalid();
  return result;
}

function owner(value: unknown): OwnerKind {
  if (value !== "account" && value !== "guest") invalid();
  return value;
}

function fulfillment(value: unknown): Fulfillment {
  if (!(FULFILLMENT_STATES as readonly unknown[]).includes(value)) invalid();
  return value as Fulfillment;
}

function payment(value: unknown): Payment {
  if (value !== "Unpaid" && value !== "Collected") invalid();
  return value;
}

export function parseProduct(value: unknown, mode: StorefrontMode = "live"): ProductDto {
  const p = record(value);
  const price = whole(p.price, 1);
  const compareAtPrice = p.compareAtPrice === null ? null : whole(p.compareAtPrice, price + 1);
  const images = array(p.images, (image) => {
    const url = text(image, 2048);
    if (!isHttpsImage(url) && !(mode === "mock" && isLocalArtwork(url))) invalid();
    return url;
  }, 12);
  const isArchived = bool(p.isArchived);
  const stock = whole(p.stock, 0, 2_147_483_647);
  const saleEligible = bool(p.saleEligible);
  if (saleEligible && isArchived) invalid();
  return {
    id: guid(p.id), slug: slug(p.slug), name: text(p.name, 200),
    brand: text(p.brand, 120, true), categoryId: guid(p.categoryId),
    categorySlug: slug(p.categorySlug), categoryName: text(p.categoryName, 120),
    description: text(p.description, 6000, true), price, compareAtPrice, stock,
    version: whole(p.version, 1), featured: bool(p.featured), isArchived, saleEligible,
    images, specs: array(p.specs, (entry) => {
      const spec = record(entry);
      return { label: text(spec.label, 120), value: text(spec.value, 1000) };
    }, 40),
  };
}

export function parseCategory(value: unknown): CategoryDto {
  const c = record(value);
  return {
    id: guid(c.id), slug: slug(c.slug), name: text(c.name, 120),
    description: text(c.description, 2000, true), visualKey: text(c.visualKey, 64),
    sortOrder: whole(c.sortOrder, 0, 100_000), isArchived: bool(c.isArchived),
    version: whole(c.version, 1), productCount: whole(c.productCount),
  };
}

export const parseCategories = (value: unknown) => array(value, parseCategory, 1000);

export function parseCatalogPage(value: unknown, mode: StorefrontMode = "live"): CatalogPageDto {
  const p = record(value);
  const pageSize = whole(p.pageSize, 1, 100);
  const items = array(p.items, (item) => parseProduct(item, mode), pageSize);
  const f = record(p.facets);
  const minPrice = whole(f.minPrice);
  const maxPrice = whole(f.maxPrice, minPrice);
  const totalCount = whole(p.totalCount, items.length);
  return {
    items, totalCount, page: whole(p.page, 1, 1_000_000), pageSize,
    facets: {
      brands: array(f.brands, (entry) => {
        const facet = record(entry);
        return { value: text(facet.value, 120), count: whole(facet.count) };
      }, 1000),
      categories: array(f.categories, (entry) => {
        const facet = record(entry);
        return { slug: slug(facet.slug), name: text(facet.name, 120), count: whole(facet.count) };
      }, 1000), minPrice, maxPrice,
    },
  };
}

export function parseProductDetail(value: unknown, mode: StorefrontMode = "live"): ProductDetailDto {
  const detail = record(value);
  return {
    product: parseProduct(detail.product, mode),
    related: array(detail.related, (p) => parseProduct(p, mode), 12),
  };
}

export function parseHome(value: unknown, mode: StorefrontMode = "live"): HomeDto {
  const home = record(value);
  const products = (v: unknown) => array(v, (p) => parseProduct(p, mode), 12);
  return { featured: products(home.featured), deals: products(home.deals), newArrivals: products(home.newArrivals) };
}

export function parseAccount(value: unknown): AccountDto {
  const a = record(value);
  return {
    id: guid(a.id), name: text(a.name, 120), email: text(a.email, 254),
    emailVerified: bool(a.emailVerified), isAdmin: bool(a.isAdmin),
  };
}

export function parseCsrf(value: unknown): CsrfDto {
  const c = record(value);
  const token = text(c.token, 4096);
  if (!/^[A-Za-z0-9_-]+$/.test(token)) invalid();
  const ownerKind = owner(c.ownerKind);
  const account = c.account == null ? undefined : parseAccount(c.account);
  const sessionExpired = c.sessionExpired === true ? true : undefined;
  if (c.sessionExpired !== undefined && c.sessionExpired !== true) invalid();
  if ((ownerKind === "guest" && (account || sessionExpired)) ||
    (ownerKind === "account" && !account && !sessionExpired) || (account && sessionExpired)) invalid();
  return { token, ownerKind, account, sessionExpired };
}

export function parseMoney(value: unknown): MoneyDto {
  const m = record(value);
  if (m.currency !== "BDT" || m.policyVersion !== "bdt-cod-v1") invalid();
  const subtotal = whole(m.subtotal);
  const delivery = whole(m.delivery);
  const total = whole(m.total);
  if (!Number.isSafeInteger(subtotal + delivery) || total !== subtotal + delivery || delivery !== (subtotal >= 5000 || subtotal === 0 ? 0 : 80)) invalid();
  return { currency: "BDT", subtotal, delivery, total, policyVersion: "bdt-cod-v1" };
}

function parseLine(value: unknown): OrderLineDto {
  const line = record(value);
  const quantity = whole(line.quantity, 1, 99);
  const unitPrice = whole(line.unitPrice, 1);
  const lineTotal = whole(line.lineTotal, 1);
  if (!Number.isSafeInteger(quantity * unitPrice) || lineTotal !== quantity * unitPrice) invalid();
  return {
    productId: guid(line.productId), name: text(line.name, 200), slug: slug(line.slug),
    quantity, unitPrice, lineTotal,
  };
}

function validateLines(lines: OrderLineDto[], money: MoneyDto) {
  if (new Set(lines.map((l) => l.productId)).size !== lines.length ||
    lines.reduce((sum, l) => sum + l.lineTotal, 0) !== money.subtotal) invalid();
}

export function parseQuote(value: unknown): QuoteDto {
  const q = record(value);
  const lines = array(q.lines, (value) => ({
    ...parseLine(value), availableStock: whole(record(value).availableStock, 0, 2_147_483_647),
  }));
  const money = parseMoney(q.money);
  validateLines(lines, money);
  return {
    quoteId: guid(q.quoteId), expiresAt: date(q.expiresAt), ownerKind: owner(q.ownerKind), lines, money,
    problems: array(q.problems, (entry) => {
      const p = record(entry);
      const code = text(p.code, 64);
      return {
        productId: guid(p.productId), code,
        message: code === "STOCK_CHANGED" ? "Requested quantity is unavailable." : "This item cannot be included. Update the cart before continuing.",
      };
    }),
  };
}

function parseContact(value: unknown): ContactDto {
  const c = record(value);
  return { name: text(c.name, 120), email: text(c.email, 254), phone: text(c.phone, 32) };
}

function parseAddress(value: unknown): DeliveryAddressDto {
  const a = record(value);
  return {
    street: text(a.street, 300), area: text(a.area, 120), city: text(a.city, 120),
    district: text(a.district, 120), postcode: a.postcode == null ? undefined : text(a.postcode, 10, true),
  };
}

export function parseOrderReceipt(value: unknown): OrderReceiptDto {
  const o = record(value);
  const lines = array(o.lines, parseLine);
  if (!lines.length) invalid();
  const money = parseMoney(o.money);
  validateLines(lines, money);
  return {
    id: guid(o.id), number: text(o.number, 64), createdAt: date(o.createdAt),
    money, lines,
  };
}

export function parseOrder(value: unknown): OrderDto {
  const o = record(value);
  return {
    ...parseOrderReceipt(o),
    fulfillment: fulfillment(o.fulfillment), payment: payment(o.payment), version: whole(o.version, 1),
    contact: parseContact(o.contact), deliveryAddress: parseAddress(o.deliveryAddress),
    notes: o.notes == null ? null : text(o.notes, 1000, true),
    events: array(o.events, (entry) => {
      const e = record(entry);
      return {
        action: text(e.action, 64), createdAt: date(e.createdAt),
        note: e.note == null ? null : text(e.note, 1000, true),
        actorId: e.actorId == null ? null : guid(e.actorId), version: whole(e.version, 1),
      };
    }, 200),
  };
}

export function parseOrderSummary(value: unknown): OrderSummaryDto {
  const o = record(value);
  return {
    id: guid(o.id), number: text(o.number, 64), createdAt: date(o.createdAt),
    fulfillment: fulfillment(o.fulfillment), payment: payment(o.payment),
    total: whole(o.total, 1), version: whole(o.version, 1),
  };
}

export function parsePagedOrders(value: unknown): PagedOrdersDto {
  const p = record(value);
  const pageSize = whole(p.pageSize, 1, 100);
  const items = array(p.items, parseOrderSummary, pageSize);
  return { items, totalCount: whole(p.totalCount, items.length), page: whole(p.page, 1, 1_000_000), pageSize };
}

export function parseMessage(value: unknown): { message: string } {
  text(record(value).message, 2000);
  return { message: "The request was completed. If an email is needed and the request is eligible, it will be sent." };
}

export function parseStock(value: unknown) {
  const s = record(value);
  return { productId: guid(s.productId), stock: whole(s.stock, 0, 2_147_483_647), version: whole(s.version, 1) };
}
