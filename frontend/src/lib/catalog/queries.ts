import { MOCK_PRODUCTS } from "@/data/products.mock";
import { isInStock } from "@/lib/catalog/stock";
import type { Product } from "@/types/domain";

/**
 * Data access seam.
 *
 * Every screen reads the catalog through these functions and nothing else, so
 * swapping the mock for the real API is a change to this file alone. Once the
 * backend exposes a product endpoint (see the README gap list) each body
 * becomes a `fetch` against `${API_BASE_URL}/api/Product` and the result is run
 * through `apiProductToProduct`.
 *
 * The functions are async even though the mock is synchronous, so that callers
 * are already written for the network.
 */

export async function getProducts(): Promise<Product[]> {
  return MOCK_PRODUCTS;
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  return MOCK_PRODUCTS.find((product) => product.slug === slug) ?? null;
}

export async function getAllProductSlugs(): Promise<string[]> {
  return MOCK_PRODUCTS.map((product) => product.slug);
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  return MOCK_PRODUCTS.filter((product) => product.featured).slice(0, limit);
}

export async function getDealProducts(limit = 8): Promise<Product[]> {
  return MOCK_PRODUCTS.filter(
    (product) =>
      product.compareAtPrice !== undefined &&
      product.compareAtPrice > product.price,
  )
    .sort((a, b) => a.price - b.price)
    .slice(0, limit);
}

/**
 * Same-category picks for the product detail page. In-stock items come first so
 * we are not recommending something that cannot be bought.
 */
export async function getRelatedProducts(
  product: Product,
  limit = 8,
): Promise<Product[]> {
  return MOCK_PRODUCTS.filter(
    (candidate) =>
      candidate.categorySlug === product.categorySlug &&
      candidate.id !== product.id,
  )
    .sort(
      (a, b) =>
        Number(isInStock(b)) - Number(isInStock(a)) || a.price - b.price,
    )
    .slice(0, limit);
}

/** Used by the home page for its browse-by-category tiles. */
export async function getCategoryCounts(): Promise<Record<string, number>> {
  return MOCK_PRODUCTS.reduce<Record<string, number>>((counts, product) => {
    counts[product.categorySlug] = (counts[product.categorySlug] ?? 0) + 1;
    return counts;
  }, {});
}
