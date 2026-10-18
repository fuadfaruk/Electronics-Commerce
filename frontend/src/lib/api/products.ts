import { unstable_rethrow } from "next/navigation";
import { apiProductToProduct } from "@/lib/api/adapters";
import { API_BASE_URL, API_ROUTES } from "@/types/api";
import type { ApiProduct } from "@/types/api";
import type { Product } from "@/types/domain";

/** Absolute URL of the catalog endpoint, e.g. `http://localhost:5249/api/v1/Product`. */
export const PRODUCTS_URL = `${API_BASE_URL}${API_ROUTES.products}`;

/**
 * Reads the catalog from `GET /api/v1/Product`.
 *
 * The call is server-side only (the catalog queries are used by Server
 * Components), so no CORS policy is needed on the API. `no-store` makes the
 * storefront reflect inventory and price changes immediately instead of baking
 * the catalog into a build.
 */
export async function fetchProductsFromApi(): Promise<Product[]> {
  let response: Response;

  try {
    response = await fetch(PRODUCTS_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    // Let Next.js mark the route as dynamic instead of reporting a network
    // failure while it probes whether the page can be prerendered.
    unstable_rethrow(cause);

    throw new Error(
      `Could not reach the product API at ${PRODUCTS_URL}. Start the backend or set NEXT_PUBLIC_USE_MOCK_DATA=true.`,
      { cause },
    );
  }

  if (!response.ok) {
    const status = response.statusText
      ? `${response.status} ${response.statusText}`
      : String(response.status);
    throw new Error(`GET ${PRODUCTS_URL} failed with ${status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(
      `GET ${PRODUCTS_URL} returned a body that is not valid JSON.`,
      { cause },
    );
  }

  if (!Array.isArray(payload)) {
    throw new Error(
      `GET ${PRODUCTS_URL} must return a JSON array of products.`,
    );
  }

  return payload.map((entry) => apiProductToProduct(entry as ApiProduct));
}
