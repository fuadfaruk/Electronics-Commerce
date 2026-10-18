import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCTS_URL, fetchProductsFromApi } from "@/lib/api/products";
import type { ApiProduct } from "@/types/api";

const apiProduct: ApiProduct = {
  productId: "00000000-0000-4000-8000-000000000007",
  productSlug: "api-product",
  productName: "API Product",
  brandName: "Acme",
  productCategorySlug: "laptops",
  productDescription: "Fetched over the network.",
  productPrice: 64000,
  productComparePrice: 70000,
  productStockQuantity: 4,
  productImages: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      url: "https://cdn.example.com/products/api-product.jpg",
      order: 0,
    },
  ],
  productSpecifications: [
    {
      productSpecificationId: "20000000-0000-4000-8000-000000000001",
      productSpecificationKey: "CPU",
      productSpecificationValue: "Ryzen 7",
    },
  ],
  featured: false,
};

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PRODUCTS_URL", () => {
  it("points at the versioned product controller", () => {
    expect(PRODUCTS_URL).toMatch(/\/api\/v1\/Product$/);
  });
});

describe("fetchProductsFromApi", () => {
  it("maps the wire payload into domain products", async () => {
    stubFetch([apiProduct]);

    const products = await fetchProductsFromApi();

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: apiProduct.productId,
      slug: "api-product",
      name: "API Product",
      brand: "Acme",
      categorySlug: "laptops",
      price: 64000,
      compareAtPrice: 70000,
      stock: 4,
    });
    expect(products[0].images).toEqual([
      "https://cdn.example.com/products/api-product.jpg",
    ]);
    expect(products[0].specs).toEqual([{ label: "CPU", value: "Ryzen 7" }]);
  });

  it("requests uncached JSON from the configured API", async () => {
    const fetchMock = stubFetch([]);

    await fetchProductsFromApi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      PRODUCTS_URL,
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("reports the URL and status when the API rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(fetchProductsFromApi()).rejects.toThrow(
      `GET ${PRODUCTS_URL} failed with 500 Internal Server Error.`,
    );
  });

  it("rejects a payload that is not an array", async () => {
    stubFetch({ message: "not a list" });

    await expect(fetchProductsFromApi()).rejects.toThrow(
      "must return a JSON array of products",
    );
  });

  it("wraps a network failure with a start-the-backend hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    await expect(fetchProductsFromApi()).rejects.toThrow(
      `Could not reach the product API at ${PRODUCTS_URL}`,
    );
  });

  it("wraps an invalid JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );

    await expect(fetchProductsFromApi()).rejects.toThrow(
      "returned a body that is not valid JSON",
    );
  });
});
