import { describe, expect, it } from "vitest";
import { validateStorefrontConfig } from "@/lib/api/config-validation";

describe("server-only live/mock configuration", () => {
  const production = { NODE_ENV: "production", STOREFRONT_URL: "https://shop.example.test" };
  it.each([undefined, "", "demo", "fallback"])("rejects absent or invalid production mode %s", (STOREFRONT_MODE) => { expect(() => validateStorefrontConfig({ ...production, STOREFRONT_MODE })).toThrow(); });
  it("permits an explicit separate production mock build without API fallback", () => { expect(validateStorefrontConfig({ ...production, STOREFRONT_MODE: "mock" })).toEqual({ mode: "mock", guestOnly: true, apiBaseUrl: null, storefrontOrigin: "https://shop.example.test" }); });
  it("defaults to guest-only and requires an explicit opt-in for customer features", () => {
    expect(validateStorefrontConfig({ ...production, STOREFRONT_MODE: "mock" }).guestOnly).toBe(true);
    expect(validateStorefrontConfig({ ...production, STOREFRONT_MODE: "mock", STOREFRONT_GUEST_ONLY: "false" }).guestOnly).toBe(false);
  });
  it.each(["", "1", "yes", "False"])("rejects ambiguous guest-only setting %s", (STOREFRONT_GUEST_ONLY) => {
    expect(() => validateStorefrontConfig({ ...production, STOREFRONT_MODE: "mock", STOREFRONT_GUEST_ONLY })).toThrow("STOREFRONT_GUEST_ONLY");
  });
  it("uses API_BASE_URL and rejects a public-only configuration", () => {
    expect(validateStorefrontConfig({ ...production, STOREFRONT_MODE: "live", API_BASE_URL: "https://api.example.test/" }).apiBaseUrl).toBe("https://api.example.test");
    expect(() => validateStorefrontConfig({ ...production, STOREFRONT_MODE: "live", NEXT_PUBLIC_API_BASE_URL: "https://api.example.test" })).toThrow();
  });
  it.each(["", "not-url", "ftp://api.example", "https://user:secret@api.example", "https://api.example?q=1", "https://api.example#proof"])("rejects invalid live URL %s", (API_BASE_URL) => { expect(() => validateStorefrontConfig({ ...production, STOREFRONT_MODE: "live", API_BASE_URL })).toThrow(); });
  it("requires a canonical origin and HTTPS outside localhost", () => {
    expect(() => validateStorefrontConfig({ ...production, STOREFRONT_MODE: "mock", STOREFRONT_URL: "https://shop.example.test/path" })).toThrow();
    expect(() => validateStorefrontConfig({ ...production, STOREFRONT_MODE: "mock", STOREFRONT_URL: "http://shop.example.test" })).toThrow();
    expect(validateStorefrontConfig({ ...production, STOREFRONT_MODE: "mock", STOREFRONT_URL: "http://localhost:3000" }).storefrontOrigin).toBe("http://localhost:3000");
  });
});
