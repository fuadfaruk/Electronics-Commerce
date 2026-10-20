import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, getApiResult } from "@/lib/api/errors";
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
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 500,
          statusText: "Internal Server Error",
        }),
      ),
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

  it("wraps a network failure with a backend configuration hint", async () => {
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

  it("preserves the API problem body for the page instead of throwing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        title: "Database unavailable",
        detail: "The database is currently unavailable. Please try again later.",
        status: 503,
        traceId: "database-request-123",
      }, { status: 503 }),
    ));

    await expect(getApiResult(fetchProductsFromApi)).resolves.toMatchObject({
      ok: false,
      problem: {
        title: "Database unavailable",
        detail: "The database is currently unavailable. Please try again later.",
        status: 503,
        traceId: "database-request-123",
        method: "GET",
        url: PRODUCTS_URL,
      },
    });
  });

  it("exposes the connection failure without a stack trace", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5249"), {
      code: "ECONNREFUSED",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new TypeError("fetch failed", { cause }),
    ));

    const result = await getApiResult(fetchProductsFromApi);
    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: "Product API is unreachable",
        cause: "fetch failed: ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5249",
      },
    });
    expect(JSON.stringify(result)).not.toContain("\n    at");
  });

  it("returns a readable timeout error", async () => {
    const timeout = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    const controller = new AbortController();
    controller.abort(timeout);
    const timeoutMock = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

    try {
      await expect(getApiResult(fetchProductsFromApi)).resolves.toMatchObject({
        ok: false,
        problem: {
          title: "Product API request timed out",
          detail: expect.stringContaining("within 10 seconds"),
        },
      });
      expect(timeoutMock).toHaveBeenCalledWith(10_000);
    } finally {
      timeoutMock.mockRestore();
    }
  });

  it.each([
    [null, "must be a JSON object"],
    [
      { ...apiProduct, productId: null },
      "productId must be a non-empty string",
    ],
    [
      { ...apiProduct, productName: {} },
      "productName must be a non-empty string",
    ],
    [{ ...apiProduct, brandName: 123 }, "brandName must be a string or null"],
    [
      { ...apiProduct, productImages: {} },
      "productImages must be an array or null",
    ],
    [
      { ...apiProduct, productImages: [null] },
      "productImages[0] must be a JSON object",
    ],
    [
      { ...apiProduct, productImages: [{ url: "not-an-image-url" }] },
      "productImages[0].url must be an HTTP URL or start with /",
    ],
    [
      { ...apiProduct, productImages: [{ url: "/\\" }] },
      "productImages[0].url must be an HTTP URL or start with /",
    ],
    [
      {
        ...apiProduct,
        productImages: [
          { url: "/one.jpg", order: { toString: null } },
          { url: "/two.jpg", order: 2 },
        ],
      },
      "productImages[0].order must be a finite number or null",
    ],
    [
      { ...apiProduct, productSpecifications: [null] },
      "productSpecifications[0] must be a JSON object",
    ],
    [
      {
        ...apiProduct,
        productSpecifications: [{ productSpecificationKey: 123 }],
      },
      "productSpecifications[0].productSpecificationKey must be a string or null",
    ],
  ])(
    "reports malformed product data rather than crashing the adapter: %j",
    async (entry, detail) => {
      stubFetch([entry]);
      const result = await getApiResult(fetchProductsFromApi);
      expect(result).toMatchObject({
        ok: false,
        problem: {
          title: "Invalid product data",
          status: 200,
          detail: `Product at array index 0: ${detail}.`,
        },
      });
    },
  );

  it("preserves optional-field fallbacks and a successful empty catalog", async () => {
    stubFetch([
      {
        productId: apiProduct.productId,
        productName: "Partial product",
        productSlug: "",
        productImages: null,
        productSpecifications: null,
      },
    ]);
    await expect(fetchProductsFromApi()).resolves.toMatchObject([
      { name: "Partial product", brand: "Unbranded", specs: [] },
    ]);

    stubFetch([]);
    await expect(getApiResult(fetchProductsFromApi)).resolves.toEqual({
      ok: true,
      data: [],
    });
  });

  it("uses the expected error class for malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json")));
    await expect(fetchProductsFromApi()).rejects.toBeInstanceOf(ApiRequestError);
  });
});
