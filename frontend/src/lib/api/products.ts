import { unstable_rethrow } from "next/navigation";
import { apiProductToProduct } from "@/lib/api/adapters";
import { ApiRequestError, describeError, readApiProblem } from "@/lib/api/errors";
import { API_BASE_URL, API_ROUTES } from "@/types/api";
import type { ApiProduct } from "@/types/api";
import type { Product } from "@/types/domain";

/** Absolute URL of the catalog endpoint, e.g. `http://localhost:5249/api/v1/Product`. */
export const PRODUCTS_URL = `${API_BASE_URL}${API_ROUTES.products}`;

const REQUEST_TIMEOUT_MS = 10_000;

function connectionError(
  cause: unknown,
  timedOut: boolean,
  url: string,
): ApiRequestError {
  unstable_rethrow(cause);
  return new ApiRequestError(
    {
      title: timedOut
        ? "Product API request timed out"
        : "Product API is unreachable",
      detail: timedOut
        ? "The product API did not respond within 10 seconds. Please try again."
        : `Could not reach the product API at ${url}. Check that the backend is running and NEXT_PUBLIC_API_BASE_URL is correct.`,
      method: "GET",
      url,
      cause: describeError(cause),
    },
    { cause },
  );
}

function invalidProductField(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "must be a JSON object";
  }
  const product = entry as Record<string, unknown>;

  for (const field of ["productId", "productName"]) {
    if (typeof product[field] !== "string" || !product[field].trim()) {
      return `${field} must be a non-empty string`;
    }
  }

  for (const field of [
    "productSlug",
    "brandName",
    "productCategorySlug",
    "productDescription",
  ]) {
    if (product[field] != null && typeof product[field] !== "string") {
      return `${field} must be a string or null`;
    }
  }

  for (const field of ["productImages", "productSpecifications"]) {
    if (product[field] != null && !Array.isArray(product[field])) {
      return `${field} must be an array or null`;
    }
  }

  if (Array.isArray(product.productImages)) {
    for (const [index, image] of product.productImages.entries()) {
      if (!image || typeof image !== "object" || Array.isArray(image)) {
        return `productImages[${index}] must be a JSON object`;
      }
      if (image.url != null && typeof image.url !== "string") {
        return `productImages[${index}].url must be a string or null`;
      }
      if (
        image.order != null &&
        (typeof image.order !== "number" || !Number.isFinite(image.order))
      ) {
        return `productImages[${index}].order must be a finite number or null`;
      }
      if (typeof image.url === "string" && image.url.trim()) {
        const url = image.url.trim();
        const rootRelative = /^\/(?![\/\\])/.test(url);
        try {
          const parsed = new URL(url, rootRelative ? PRODUCTS_URL : undefined);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            return `productImages[${index}].url must be an HTTP URL or start with /`;
          }
        } catch {
          return `productImages[${index}].url must be an HTTP URL or start with /`;
        }
      }
    }
  }

  if (Array.isArray(product.productSpecifications)) {
    for (const [index, spec] of product.productSpecifications.entries()) {
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
        return `productSpecifications[${index}] must be a JSON object`;
      }
      for (const field of [
        "productSpecificationKey",
        "productSpecificationValue",
      ]) {
        if (spec[field] != null && typeof spec[field] !== "string") {
          return `productSpecifications[${index}].${field} must be a string or null`;
        }
      }
    }
  }

  return undefined;
}

async function fetchProductPayload(
  url: string,
): Promise<{ payload: unknown; status: number }> {
  let response: Response;
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (cause) {
    // Let Next.js mark the route as dynamic instead of reporting a network
    // failure while it probes whether the page can be prerendered.
    throw connectionError(cause, signal.aborted, url);
  }

  if (!response.ok) {
    throw new ApiRequestError(await readApiProblem(response, url));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    unstable_rethrow(cause);
    if (signal.aborted) throw connectionError(cause, true, url);
    throw new ApiRequestError(
      {
        title: "Invalid API response",
        detail: `GET ${url} returned a body that is not valid JSON.`,
        status: response.status,
        method: "GET",
        url,
        cause: describeError(cause),
      },
      { cause },
    );
  }

  return { payload, status: response.status };
}

/**
 * Reads the catalog from `GET /api/v1/Product`.
 *
 * The call is server-side only (the catalog queries are used by Server
 * Components), so no CORS policy is needed on the API. `no-store` makes the
 * storefront reflect inventory and price changes immediately instead of baking
 * the catalog into a build.
 */
export async function fetchProductsFromApi(): Promise<Product[]> {
  const { payload, status } = await fetchProductPayload(PRODUCTS_URL);

  if (!Array.isArray(payload)) {
    throw new ApiRequestError({
      title: "Invalid API response",
      detail: `GET ${PRODUCTS_URL} must return a JSON array of products.`,
      status,
      method: "GET",
      url: PRODUCTS_URL,
    });
  }

  return payload.map((entry, index) => {
    const invalidField = invalidProductField(entry);
    if (invalidField) {
      throw new ApiRequestError({
        title: "Invalid product data",
        detail: `Product at array index ${index}: ${invalidField}.`,
        status,
        method: "GET",
        url: PRODUCTS_URL,
      });
    }
    return apiProductToProduct(entry as ApiProduct);
  });
}

/** Reads a full product by GUID, or null when the backend returns 404. */
export async function fetchProductByIdFromApi(
  productId: string,
): Promise<Product | null> {
  const url = `${PRODUCTS_URL}/${encodeURIComponent(productId)}`;

  try {
    const { payload, status } = await fetchProductPayload(url);
    const invalidField = invalidProductField(payload);
    if (invalidField) {
      throw new ApiRequestError({
        title: "Invalid product data",
        detail: `Product ${productId}: ${invalidField}.`,
        status,
        method: "GET",
        url,
      });
    }
    return apiProductToProduct(payload as ApiProduct);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiRequestError && error.problem.status === 404) {
      return null;
    }
    throw error;
  }
}
