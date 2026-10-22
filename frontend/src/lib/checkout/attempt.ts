import { GUID_PATTERN } from "@/lib/api/decoders";
import { ApiRequestError } from "@/lib/api/errors";
import type { OwnerKind, PlaceOrderRequest, QuoteItem } from "@/types/api";

export const ATTEMPT_STORAGE_KEY = "electro.checkout.attempt.v1.live";

export interface AttemptReference {
  schema: 1;
  idempotencyKey: string;
  quoteId: string;
  payloadHash: string;
  ownerKind: OwnerKind;
  items: QuoteItem[];
}

export interface AttemptMemory {
  payload: PlaceOrderRequest;
  ownerKind: OwnerKind;
  accountId?: string;
}

const requests = new Map<string, AttemptMemory>();

export function itemSignature(items: QuoteItem[]): string {
  return JSON.stringify(items.map((l) => ({ productId: l.productId.toLowerCase(), quantity: l.quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId)));
}

export function canonicalPayload(payload: PlaceOrderRequest): string {
  return JSON.stringify({
    quoteId: payload.quoteId, contact: { name: payload.contact.name, email: payload.contact.email, phone: payload.contact.phone },
    deliveryAddress: { street: payload.deliveryAddress.street, area: payload.deliveryAddress.area, city: payload.deliveryAddress.city, district: payload.deliveryAddress.district,
      ...(payload.deliveryAddress.postcode ? { postcode: payload.deliveryAddress.postcode } : {}) },
    ...(payload.notes ? { notes: payload.notes } : {}),
  });
}

export async function payloadHash(payload: PlaceOrderRequest): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new ApiRequestError({ status: 503 });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload(payload)));
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
}

export async function createAttempt(payload: PlaceOrderRequest, items: QuoteItem[], ownerKind: OwnerKind): Promise<AttemptReference> {
  if (!globalThis.crypto?.randomUUID) throw new ApiRequestError({ status: 503 });
  return { schema: 1, idempotencyKey: crypto.randomUUID(), quoteId: payload.quoteId, payloadHash: await payloadHash(payload), ownerKind, items: JSON.parse(itemSignature(items)) };
}

export function parseAttempt(raw: string | null): AttemptReference | null {
  if (!raw || raw.length > 10_000) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const a = p as Record<string, unknown>;
    if (Object.keys(a).some((key) => !["schema", "idempotencyKey", "quoteId", "payloadHash", "ownerKind", "items"].includes(key)) || a.schema !== 1 || (a.ownerKind !== "account" && a.ownerKind !== "guest") ||
      typeof a.idempotencyKey !== "string" || !GUID_PATTERN.test(a.idempotencyKey) || typeof a.quoteId !== "string" || !GUID_PATTERN.test(a.quoteId) ||
      typeof a.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(a.payloadHash) || !Array.isArray(a.items) || !a.items.length || a.items.length > 50) return null;
    const items: QuoteItem[] = [];
    for (const item of a.items) {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !["productId", "quantity"].includes(key)) ||
        typeof item.productId !== "string" || !GUID_PATTERN.test(item.productId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) return null;
      items.push({ productId: item.productId.toLowerCase(), quantity: item.quantity });
    }
    if (new Set(items.map((i) => i.productId)).size !== items.length) return null;
    return { schema: 1, idempotencyKey: a.idempotencyKey, quoteId: a.quoteId, payloadHash: a.payloadHash, ownerKind: a.ownerKind, items };
  } catch { return null; }
}

export function readAttempt(): { reference: AttemptReference | null; unavailable: boolean; invalid: boolean } {
  try {
    const raw = window.localStorage.getItem(ATTEMPT_STORAGE_KEY);
    const reference = parseAttempt(raw);
    return { reference, unavailable: false, invalid: Boolean(raw && !reference) };
  } catch { return { reference: null, unavailable: true, invalid: false }; }
}

export function saveAttempt(reference: AttemptReference): boolean {
  try { window.localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(reference)); return true; }
  catch { return false; }
}

export function rememberAttempt(reference: AttemptReference, request: AttemptMemory): void {
  requests.set(reference.idempotencyKey, request);
}

export function attemptMemory(reference: AttemptReference): AttemptMemory | undefined {
  return requests.get(reference.idempotencyKey);
}

export function clearAttempt(reference: AttemptReference): void {
  requests.delete(reference.idempotencyKey);
  try {
    if (parseAttempt(window.localStorage.getItem(ATTEMPT_STORAGE_KEY))?.idempotencyKey === reference.idempotencyKey) window.localStorage.removeItem(ATTEMPT_STORAGE_KEY);
  } catch { /* No credentials or contact data are persisted. */ }
}
