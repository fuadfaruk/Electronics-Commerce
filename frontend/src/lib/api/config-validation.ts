import type { StorefrontMode } from "@/types/api";

export interface StorefrontConfig {
  mode: StorefrontMode;
  guestOnly: boolean;
  apiBaseUrl: string | null;
  storefrontOrigin: string;
}

/** Pure validation is also used by next.config; no server settings are emitted as public env. */
export function validateStorefrontConfig(env: Record<string, string | undefined>): StorefrontConfig {
  const production = env.NODE_ENV === "production";
  const mode = env.STOREFRONT_MODE ?? (production ? "" : "mock");
  if (mode !== "live" && mode !== "mock") {
    throw new Error("STOREFRONT_MODE must explicitly be live or mock. Mock is a separate read-only demo, not a live fallback.");
  }
  const guestOnly = env.STOREFRONT_GUEST_ONLY ?? "true";
  if (guestOnly !== "true" && guestOnly !== "false") {
    throw new Error("STOREFRONT_GUEST_ONLY must be true or false.");
  }

  function urlSetting(name: string, fallback?: string): URL {
    const raw = env[name] ?? fallback;
    if (!raw?.trim()) throw new Error(`${name} must be a nonempty server URL.`);
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error(`${name} must be a valid HTTP or HTTPS server URL.`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error(`${name} must be an HTTP or HTTPS URL without credentials, query, or fragment.`);
    }
    return url;
  }

  const storefront = urlSetting("STOREFRONT_URL", production ? undefined : "http://localhost:3000");
  if (storefront.pathname !== "/") throw new Error("STOREFRONT_URL must be the canonical storefront origin without a path.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(storefront.hostname);
  if (production && storefront.protocol !== "https:" && !local) {
    throw new Error("A production STOREFRONT_URL must use HTTPS.");
  }
  const api = mode === "live" ? urlSetting("API_BASE_URL") : null;
  return {
    mode,
    guestOnly: guestOnly === "true",
    apiBaseUrl: api ? api.href.replace(/\/+$/, "") : null,
    storefrontOrigin: storefront.origin,
  };
}
