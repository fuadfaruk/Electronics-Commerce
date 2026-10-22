import { GUID_PATTERN, SLUG_PATTERN } from "@/lib/api/decoders";
import { FALLBACK_IMAGE, isHttpsImage, isLocalArtwork } from "@/lib/catalog/visuals";
import type { QuoteItem, StorefrontMode } from "@/types/api";
import type { CartLine } from "@/types/domain";

export const LEGACY_CART_KEY = "electro.cart.v1";
export const MAX_CART_LINES = 50;
export const MAX_QUANTITY = 99;
export const cartStorageKey = (source: StorefrontMode) => `electro.cart.v2.${source}`;

export interface StoredCart {
  schema: 2;
  source: StorefrontMode;
  lines: CartLine[];
  appliedOrders: string[];
}

export const emptyCart = (source: StorefrontMode): StoredCart => ({ schema: 2, source, lines: [], appliedOrders: [] });

function boundedText(value: unknown, max: number, blank = false): value is string {
  return typeof value === "string" && value.length <= max && (blank || Boolean(value.trim())) && !/[\u0000-\u001f]/.test(value);
}

export function validCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const l = value as Record<string, unknown>;
  return boundedText(l.productId, 36) && GUID_PATTERN.test(l.productId) &&
    boundedText(l.slug, 160) && SLUG_PATTERN.test(l.slug) &&
    boundedText(l.name, 200) && boundedText(l.brand, 120, true) &&
    typeof l.unitPrice === "number" && Number.isSafeInteger(l.unitPrice) && l.unitPrice >= 1 && l.unitPrice <= 999_999_999 &&
    typeof l.quantity === "number" && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= MAX_QUANTITY &&
    typeof l.stock === "number" && Number.isInteger(l.stock) && l.stock >= 0 && l.stock <= 2_147_483_647 &&
    boundedText(l.image, 2048, true) && (!l.image || isHttpsImage(l.image) || isLocalArtwork(l.image));
}

export function dedupeLines(lines: CartLine[]): CartLine[] {
  const items = new Map<string, CartLine>();
  for (const line of lines) {
    if (!validCartLine(line)) continue;
    const id = line.productId.toLowerCase();
    const previous = items.get(id);
    if (!previous && items.size >= MAX_CART_LINES) continue;
    items.set(id, {
      ...line, productId: id, image: line.image || FALLBACK_IMAGE,
      quantity: Math.min(MAX_QUANTITY, (previous?.quantity ?? 0) + line.quantity),
    });
  }
  return Array.from(items.values());
}

export function parseStoredCart(raw: string | null, source: StorefrontMode): { cart: StoredCart; invalid: boolean } {
  if (!raw) return { cart: emptyCart(source), invalid: false };
  if (raw.length > 150_000) return { cart: emptyCart(source), invalid: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const p = parsed as Record<string, unknown>;
    if (p.schema !== 2 || p.source !== source || !Array.isArray(p.lines) || p.lines.length > MAX_CART_LINES * 2 ||
      !Array.isArray(p.appliedOrders) || p.appliedOrders.length > 100 || p.appliedOrders.some((id) => typeof id !== "string" || !GUID_PATTERN.test(id))) throw new Error();
    const lines = dedupeLines(p.lines);
    return {
      cart: { schema: 2, source, lines, appliedOrders: [...new Set(p.appliedOrders as string[])] },
      invalid: p.lines.some((line) => !validCartLine(line)) || lines.length !== p.lines.length,
    };
  } catch {
    return { cart: emptyCart(source), invalid: true };
  }
}

export function confirmedCart(cart: StoredCart, orderId: string, purchased: QuoteItem[]): StoredCart {
  if (!GUID_PATTERN.test(orderId) || cart.appliedOrders.includes(orderId)) return cart;
  const quantities = new Map(purchased.filter((l) => GUID_PATTERN.test(l.productId) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= MAX_QUANTITY)
    .map((l) => [l.productId.toLowerCase(), l.quantity]));
  return {
    ...cart,
    lines: cart.lines.map((line) => ({ ...line, quantity: line.quantity - (quantities.get(line.productId) ?? 0) })).filter((line) => line.quantity > 0),
    appliedOrders: [...cart.appliedOrders, orderId].slice(-100),
  };
}
