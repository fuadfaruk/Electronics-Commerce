import { describe, expect, it } from "vitest";
import { MOCK_PRODUCTS } from "@/data/products.mock";
import {
  getCategoryCounts,
  getDealProducts,
  getFeaturedProducts,
  getProductBySlug,
  getProducts,
  getRelatedProducts,
} from "@/lib/catalog/queries";

/**
 * The mock is the default source, so these cover the seam without a running
 * backend. The API path is covered separately in `lib/api/products.test.ts`.
 */
describe("catalog queries (mock source)", () => {
  it("serves the full mock catalog", async () => {
    await expect(getProducts()).resolves.toHaveLength(MOCK_PRODUCTS.length);
  });

  it("resolves a product by slug and returns null for an unknown one", async () => {
    const first = MOCK_PRODUCTS[0];
    await expect(getProductBySlug(first.slug)).resolves.toMatchObject({
      id: first.id,
      slug: first.slug,
    });
    await expect(getProductBySlug("does-not-exist")).resolves.toBeNull();
  });

  it("limits featured products", async () => {
    const featured = await getFeaturedProducts(3);
    expect(featured).toHaveLength(3);
    expect(featured.every((product) => product.featured)).toBe(true);
  });

  it("returns only genuinely discounted deals", async () => {
    const deals = await getDealProducts(8);
    expect(deals.length).toBeGreaterThan(0);
    expect(
      deals.every(
        (product) =>
          product.compareAtPrice !== undefined &&
          product.compareAtPrice > product.price,
      ),
    ).toBe(true);
  });

  it("counts every product against its category", async () => {
    const counts = await getCategoryCounts();
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(MOCK_PRODUCTS.length);
  });

  it("recommends same-category products only", async () => {
    const product = MOCK_PRODUCTS[0];
    const related = await getRelatedProducts(product, 4);

    expect(related.length).toBeGreaterThan(0);
    expect(
      related.every(
        (candidate) =>
          candidate.categorySlug === product.categorySlug &&
          candidate.id !== product.id,
      ),
    ).toBe(true);
  });
});
