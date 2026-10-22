import "server-only";
import { cache } from "react";
import { apiCategoryToCategory, apiProductToProduct } from "@/lib/api/adapters";
import { getStorefrontConfig } from "@/lib/api/config";
import { parseCategories, parseCategory, parseCatalogPage, parseHome, parseProductDetail } from "@/lib/api/decoders";
import { ApiRequestError } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";
import { mockCommerceRead } from "@/lib/catalog/mock";
import { toSearchParams, type CatalogFilters } from "@/lib/catalog/filters";

async function read<T>(path: string, decode: (value: unknown) => T, query = new URLSearchParams()): Promise<T> {
  if (getStorefrontConfig().mode === "mock") return decode(mockCommerceRead(path, query));
  return serverGet(path, decode, query);
}

// React cache only deduplicates a render pass; no persistent or shared user cache.
export const getCategories = cache(async () =>
  (await read("Category", parseCategories)).filter((c) => !c.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map(apiCategoryToCategory),
);

export async function getCategoryBySlug(slug: string) {
  try { return apiCategoryToCategory(await read(`Category/by-slug/${slug}`, parseCategory)); }
  catch (error) {
    if (error instanceof ApiRequestError && error.problem.status === 404) return null;
    throw error;
  }
}

export async function getCatalogPage(filters: CatalogFilters, page = 1, pageSize = 12) {
  const query = toSearchParams(filters);
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  const mode = getStorefrontConfig().mode;
  return read("Product", (v) => parseCatalogPage(v, mode), query);
}

export const getProductBySlug = cache(async (slug: string) => {
  const mode = getStorefrontConfig().mode;
  try {
    const detail = await read(`Product/by-slug/${slug}`, (v) => parseProductDetail(v, mode));
    return { product: apiProductToProduct(detail.product), related: detail.related.map(apiProductToProduct) };
  } catch (error) {
    if (error instanceof ApiRequestError && error.problem.status === 404) return null;
    throw error;
  }
});

export const getHomeCollections = cache(async () => {
  const mode = getStorefrontConfig().mode;
  const home = await read("Product/home", (v) => parseHome(v, mode));
  return {
    featured: home.featured.map(apiProductToProduct), deals: home.deals.map(apiProductToProduct),
    newArrivals: home.newArrivals.map(apiProductToProduct),
  };
});
