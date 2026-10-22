import "server-only";
import { parseCatalogPage, parseHome, parseProductDetail } from "@/lib/api/decoders";
import { serverGet } from "@/lib/api/server";
import { toSearchParams, type CatalogFilters } from "@/lib/catalog/filters";

export function fetchCatalogPage(filters: CatalogFilters, page = 1, pageSize = 12) {
  const query = toSearchParams(filters);
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  return serverGet("Product", parseCatalogPage, query);
}

export function fetchProductBySlug(slug: string) {
  return serverGet(`Product/by-slug/${slug}`, parseProductDetail);
}

export function fetchHome() {
  return serverGet("Product/home", parseHome);
}
