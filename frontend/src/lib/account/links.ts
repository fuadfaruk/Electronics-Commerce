import { GUID_PATTERN } from "@/lib/api/decoders";

export type EmailAction = "verify" | "reset" | "claim";
export type EmailProof = { userId: string; token: string } | { claimId: string; proof: string };

export function safeNext(value: unknown): string {
  if (typeof value !== "string" || /[\\?#\u0000-\u0020%]/.test(value)) return "/account";
  if (["/account", "/account/orders", "/checkout", "/admin"].includes(value)) return value;
  const parts = value.split("/");
  if (parts[1] === "account" && parts[2] === "orders" && parts.length === 4 && GUID_PATTERN.test(parts[3])) return value;
  if (parts[1] === "admin" && ["categories", "products", "orders"].includes(parts[2]) &&
    (parts.length === 3 || (parts.length === 4 && (GUID_PATTERN.test(parts[3]) || (parts[3] === "new" && parts[2] !== "orders"))))) return value;
  return "/account";
}

function fragmentValues(fragment: string, keys: string[]): Record<string, string> | null {
  if (fragment.length > 5000) return null;
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (Array.from(params.keys()).some((key) => !keys.includes(key)) || keys.some((key) => params.getAll(key).length !== 1)) return null;
  return Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ""]));
}

export function parseEmailFragment(fragment: string, action: EmailAction): EmailProof | null {
  const values = fragmentValues(fragment, action === "claim" ? ["claimId", "proof"] : ["userId", "token"]);
  if (!values) return null;
  const id = action === "claim" ? values.claimId : values.userId;
  const proof = action === "claim" ? values.proof : values.token;
  if (!GUID_PATTERN.test(id) || !/^[A-Za-z0-9_-]+$/.test(proof) || proof.length > (action === "claim" ? 100 : 4000)) return null;
  return action === "claim" ? { claimId: id, proof } : { userId: id, token: proof };
}

export function parseCapabilityFragment(fragment: string): string | null {
  const values = fragmentValues(fragment, ["capability"]);
  return values && /^[A-Za-z0-9_-]{20,100}$/.test(values.capability) ? values.capability : null;
}

/** Clear first, before a network call or navigation. Proofs only survive in tab memory. */
export function takeFragment(): string {
  const fragment = window.location.hash;
  if (fragment) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return fragment;
}
