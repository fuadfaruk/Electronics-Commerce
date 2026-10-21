import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_PRODUCTS } from "@/data/products.mock";
import { PRODUCTS_URL } from "@/lib/api/products";
import {
  getCategoryCounts,
  getDealProducts,
  getFeaturedProducts,
  getProductBySlug,
  getProducts,
  getRelatedProducts,
} from "@/lib/catalog/queries";
import type { ApiProduct } from "@/types/api";

/**
 * The mock is the default source, so these cover the seam without a running
 * backend. The live source tests below also exercise the GUID detail request.
 */
describe("catalog queries (mock source)", () => {
  it("serves the full mock catalog", async () => {
    await expect(getProducts()).resolves.toHaveLength(MOCK_PRODUCTS.length);
  });

  it("resolves a product by slug and returns null for an unknown one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const first = MOCK_PRODUCTS[0];
    try {
      await expect(getProductBySlug(first.slug)).resolves.toBe(first);
      await expect(getProductBySlug("does-not-exist")).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("catalog queries (API source)", () => {
  const summary: ApiProduct = {
    productId: "00000000-0000-4000-8000-000000000007",
    productSlug: "selected-product",
    productName: "Selected product",
    productCategorySlug: "laptops",
    productImages: [{ id: "cover", url: "/cover.jpg", order: 1 }],
    productSpecifications: [],
  };
  const otherProduct: ApiProduct = {
    ...summary,
    productId: "00000000-0000-4000-8000-000000000008",
    productSlug: "other-product",
    productName: "Other product",
  };
  const details: ApiProduct = {
    ...summary,
    productDescription: "Full product details.",
    productImages: [
      ...summary.productImages!,
      { id: "detail", url: "/detail.jpg", order: 2 },
    ],
    productSpecifications: [
      {
        productSpecificationId: "cpu",
        productSpecificationKey: "CPU",
        productSpecificationValue: "Ryzen 7",
      },
    ],
  };
  let queries: typeof import("@/lib/catalog/queries");

  function stubProductRequests(detailResponse = Response.json(details)) {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === PRODUCTS_URL
        ? Response.json([otherProduct, summary])
        : detailResponse,
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_MOCK_DATA", "false");
    vi.resetModules();
    queries = await import("@/lib/catalog/queries");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves the slug to its GUID and returns the fetched details, not the summary", async () => {
    const fetchMock = stubProductRequests();

    await expect(
      queries.getProductBySlug(summary.productSlug),
    ).resolves.toMatchObject({
      id: summary.productId,
      description: details.productDescription,
      images: ["/cover.jpg", "/detail.jpg"],
      specs: [{ label: "CPU", value: "Ryzen 7" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, PRODUCTS_URL, expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${PRODUCTS_URL}/${summary.productId}`,
      expect.any(Object),
    );
  });

  it("does not fetch details for catalog listings", async () => {
    const fetchMock = stubProductRequests();

    const products = await queries.getProducts();

    expect(products).toHaveLength(2);
    expect(products[1].images).toEqual(["/cover.jpg"]);
    expect(products[1].specs).toEqual([]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      PRODUCTS_URL,
      expect.any(Object),
    );
  });

  it("does not fetch details for related-product recommendations", async () => {
    const fetchMock = stubProductRequests();

    const related = await queries.getRelatedProducts({
      ...MOCK_PRODUCTS[0],
      id: summary.productId,
      categorySlug: "laptops",
    });

    expect(related.map((product) => product.id)).toEqual([otherProduct.productId]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      PRODUCTS_URL,
      expect.any(Object),
    );
  });

  it("returns null for an unknown slug without requesting a detail endpoint", async () => {
    const fetchMock = stubProductRequests();

    await expect(queries.getProductBySlug("does-not-exist")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      PRODUCTS_URL,
      expect.any(Object),
    );
  });

  it("returns null if the selected product is deleted after the catalog lookup", async () => {
    stubProductRequests(new Response(null, { status: 404 }));

    await expect(
      queries.getProductBySlug(summary.productSlug),
    ).resolves.toBeNull();
  });

  it("propagates detail failures instead of falling back to limited catalog data", async () => {
    stubProductRequests(new Response(null, { status: 503 }));

    await expect(
      queries.getProductBySlug(summary.productSlug),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      problem: { status: 503, url: `${PRODUCTS_URL}/${summary.productId}` },
    });
  });
});
