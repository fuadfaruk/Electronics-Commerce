import { cache } from "react";
import { MOCK_PRODUCTS } from "@/data/products.mock";
import { fetchProductsFromApi } from "@/lib/api/products";
import { isInStock } from "@/lib/catalog/stock";
import { USE_MOCK_DATA } from "@/types/api";
import type { Product } from "@/types/domain";

/**
 * Data access seam.
 *
 * Every screen reads the catalog through these functions and nothing else.
 * `NEXT_PUBLIC_USE_MOCK_DATA` picks the source: the local mock by default, or
 * `GET /api/v1/Product` through `fetchProductsFromApi` when set to `false`.
 *
 * The functions are async in both modes so callers are already written for the
 * network, and filters still run over the full catalog on the server.
 */

// Share the timed API request across the page and its metadata, not across visitors.
export const getProducts = cache(async (): Promise<Product[]> => {
  if (USE_MOCK_DATA) return MOCK_PRODUCTS;
  return fetchProductsFromApi();
});

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const products = await getProducts();
  return products.find((product) => product.slug === slug) ?? null;
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  const products = await getProducts();
  return products.filter((product) => product.featured).slice(0, limit);
}

export async function getDealProducts(limit = 8): Promise<Product[]> {
  const products = await getProducts();
  return products
    .filter(
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
  const products = await getProducts();
  return products
    .filter(
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
  const products = await getProducts();
  return products.reduce<Record<string, number>>((counts, product) => {
    counts[product.categorySlug] = (counts[product.categorySlug] ?? 0) + 1;
    return counts;
  }, {});
}
