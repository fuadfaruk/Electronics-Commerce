import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCatalogPage, fetchHome, fetchProductBySlug } from "@/lib/api/products";
import { DEFAULT_FILTERS } from "@/lib/catalog/filters";
import { catalogPage, product } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
beforeEach(() => {
  vi.stubEnv("STOREFRONT_MODE", "live"); vi.stubEnv("API_BASE_URL", "http://localhost:5249"); vi.stubEnv("STOREFRONT_URL", "http://localhost:3000");
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("bounded direct API reads", () => {
  it("fetches one page of12 with every active filter, never a full catalog", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(catalogPage)); vi.stubGlobal("fetch", fetch);
    await fetchCatalogPage({ ...DEFAULT_FILTERS, q: "noise audio", categories: ["audio", "laptops"], brands: ["Acme"], minPrice: 100, maxPrice: 5000, inStockOnly: true, sort: "price-desc" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const query = new URL(fetch.mock.calls[0][0]).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ q: "noise audio", category: "audio,laptops", brand: "Acme", min: "100", max: "5000", stock: "in", sort: "price-desc", page: "1", pageSize: "12" });
  });
  it("reads the slug detail and home bounded endpoints directly", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ product, related: [] })).mockResolvedValueOnce(Response.json({ featured: [product], deals: [product], newArrivals: [product] })); vi.stubGlobal("fetch", fetch);
    await fetchProductBySlug(product.slug); await fetchHome();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["http://localhost:5249/api/v1/Product/by-slug/headphones", "http://localhost:5249/api/v1/Product/home"]);
  });
  it("does not convert a network or contract failure to sample products", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret internal URL")));
    await expect(fetchCatalogPage(DEFAULT_FILTERS)).rejects.toMatchObject({ problem: { status: 503 } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{ legacyProductPrice: 100.5 }])));
    await expect(fetchCatalogPage(DEFAULT_FILTERS)).rejects.toMatchObject({ problem: { code: "INVALID_RESPONSE" } });
  });
});
