import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_PRODUCTS } from "@/data/products.mock";
import { DEFAULT_FILTERS } from "@/lib/catalog/filters";
import { getCatalogPage, getCategories, getCategoryBySlug, getHomeCollections, getProductBySlug } from "@/lib/catalog/queries";
import { category, product } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
beforeEach(() => { vi.stubEnv("STOREFRONT_MODE", "mock"); vi.stubEnv("STOREFRONT_URL", "http://localhost:3000"); mocks.cookies.mockResolvedValue({ getAll: () => [] }); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("explicit sample contracts", () => {
  it("pages sample browsing and never contacts the live API", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const first = await getCatalogPage(DEFAULT_FILTERS);
    const second = await getCatalogPage(DEFAULT_FILTERS, 2);
    expect(first.items).toHaveLength(12); expect(second.items).toHaveLength(12);
    expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(24);
    expect(first.totalCount).toBe(MOCK_PRODUCTS.length); expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves direct sample detail and bounded home data", async () => {
    const detail = await getProductBySlug(MOCK_PRODUCTS[0].slug);
    expect(detail?.product.id).toBe(MOCK_PRODUCTS[0].id);
    expect(detail!.related.length).toBeLessThanOrEqual(8);
    await expect(getProductBySlug("missing-slug")).resolves.toBeNull();
    const home = await getHomeCollections();
    expect(home.featured.length).toBeLessThanOrEqual(8); expect(home.deals.every((p) => p.compareAtPrice! > p.price)).toBe(true);
    expect(home.newArrivals.length).toBe(8);
  });
});

describe("live taxonomy and direct detail", () => {
  beforeEach(() => { vi.stubEnv("STOREFRONT_MODE", "live"); vi.stubEnv("API_BASE_URL", "http://localhost:5249"); });
  it("excludes archived categories from navigation, retaining archived slug metadata", async () => {
    const archived = { ...category, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", slug: "old-audio", isArchived: true };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([archived, category])).mockResolvedValueOnce(Response.json(archived)));
    expect((await getCategories()).map((c) => c.slug)).toEqual(["audio"]);
    expect(await getCategoryBySlug("old-audio")).toMatchObject({ isArchived: true });
  });
  it("uses one direct slug read, with404 missing and503 kept as failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ product, related: [] })).mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 503 })); vi.stubGlobal("fetch", fetch);
    expect((await getProductBySlug("headphones"))?.product).toMatchObject({ id: product.id });
    await expect(getProductBySlug("gone")).resolves.toBeNull();
    await expect(getProductBySlug("offline")).rejects.toMatchObject({ problem: { status: 503 } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toContain("/Product/by-slug/headphones");
  });
});
