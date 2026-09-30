import { CATEGORIES, getCategoryName } from "@/data/categories.mock";
import type { Product } from "@/types/domain";

/**
 * Catalog search, filtering and sorting.
 *
 * Everything here is pure: the listing page parses the URL into a
 * `CatalogFilters`, applies it, and renders the result. Keeping it out of
 * components means the boundary cases (price edges, the exact threshold, sort
 * stability) can be unit tested.
 */

export const SORT_KEYS = [
  "relevance",
  "price-asc",
  "price-desc",
  "name-asc",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Relevance",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  "name-asc": "Name: A to Z",
};

/** How many products the listing shows before "Load more". */
export const LISTING_PAGE_SIZE = 12;

export interface CatalogFilters {
  q: string;
  categories: string[];
  brands: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStockOnly: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  q: "",
  categories: [],
  brands: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  sort: "relevance",
};

type RawSearchParams = Record<string, string | string[] | undefined>;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Accepts both `?category=a,b` and `?category=a&category=b`, since either is a
 * reasonable thing for a link to produce.
 */
function toList(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : [value ?? ""];
  const parts = values.flatMap((entry) => entry.split(","));
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  return Array.from(new Set(cleaned));
}

function toPrice(value: string | string[] | undefined): number | null {
  const raw = firstValue(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function toSort(value: string | string[] | undefined): SortKey {
  const raw = firstValue(value).trim();
  return (SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as SortKey)
    : DEFAULT_FILTERS.sort;
}

export function parseCatalogFilters(params: RawSearchParams): CatalogFilters {
  const minPrice = toPrice(params.min);
  const maxPrice = toPrice(params.max);

  return {
    q: firstValue(params.q).trim(),
    categories: toList(params.category),
    brands: toList(params.brand),
    // A backwards range yields no results, which reads as a bug rather than an
    // empty catalog, so normalise it instead.
    minPrice: minPrice !== null && maxPrice !== null && minPrice > maxPrice
      ? maxPrice
      : minPrice,
    maxPrice: minPrice !== null && maxPrice !== null && minPrice > maxPrice
      ? minPrice
      : maxPrice,
    inStockOnly: firstValue(params.stock) === "in",
    sort: toSort(params.sort),
  };
}

/* -------------------------------------------------------------------------- */
/* Serialising                                                                */
/* -------------------------------------------------------------------------- */

export function toSearchParams(filters: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.categories.length) {
    params.set("category", filters.categories.join(","));
  }
  if (filters.brands.length) params.set("brand", filters.brands.join(","));
  if (filters.minPrice !== null) params.set("min", String(filters.minPrice));
  if (filters.maxPrice !== null) params.set("max", String(filters.maxPrice));
  if (filters.inStockOnly) params.set("stock", "in");
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);

  return params;
}

export function buildListingHref(filters: CatalogFilters): string {
  const query = toSearchParams(filters).toString();
  return query ? `/products?${query}` : "/products";
}

/* -------------------------------------------------------------------------- */
/* Mutation helpers (used by the filter sheet)                                */
/* -------------------------------------------------------------------------- */

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

export function toggleCategory(
  filters: CatalogFilters,
  slug: string,
): CatalogFilters {
  return { ...filters, categories: toggleValue(filters.categories, slug) };
}

export function toggleBrand(
  filters: CatalogFilters,
  brand: string,
): CatalogFilters {
  return { ...filters, brands: toggleValue(filters.brands, brand) };
}

/**
 * Clears the narrowing filters but keeps the search term and chosen sort —
 * "Clear all" in the filter sheet should not silently discard a search.
 */
export function clearFilters(filters: CatalogFilters): CatalogFilters {
  return { ...DEFAULT_FILTERS, q: filters.q, sort: filters.sort };
}

export function countActiveFilters(filters: CatalogFilters): number {
  return (
    filters.categories.length +
    filters.brands.length +
    (filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0)
  );
}

export function hasNarrowingFilters(filters: CatalogFilters): boolean {
  return countActiveFilters(filters) > 0;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

function haystack(product: Product): string {
  return [
    product.name,
    product.brand,
    product.categorySlug,
    getCategoryName(product.categorySlug),
    product.description,
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesQuery(product: Product, query: string): boolean {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const text = haystack(product);
  // Every token must appear somewhere, so extra words narrow rather than widen.
  return tokens.every((token) => text.includes(token));
}

export function searchScore(product: Product, query: string): number {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return 0;

  const name = product.name.toLowerCase();
  const brand = product.brand.toLowerCase();
  const category = getCategoryName(product.categorySlug).toLowerCase();
  const description = product.description.toLowerCase();

  let score = 0;
  if (name.includes(normalized)) score += 6;
  if (brand.includes(normalized)) score += 3;
  if (product.featured) score += 0.25;

  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (name.includes(token)) score += 2;
    if (brand.includes(token)) score += 2;
    if (category.includes(token)) score += 1;
    if (description.includes(token)) score += 0.5;
  }

  return score;
}

/* -------------------------------------------------------------------------- */
/* Filter + sort                                                              */
/* -------------------------------------------------------------------------- */

export function applyFilters(
  products: Product[],
  filters: CatalogFilters,
): Product[] {
  const matched = products.filter((product) => {
    if (!matchesQuery(product, filters.q)) return false;

    if (
      filters.categories.length &&
      !filters.categories.includes(product.categorySlug)
    ) {
      return false;
    }

    if (filters.brands.length && !filters.brands.includes(product.brand)) {
      return false;
    }

    if (filters.minPrice !== null && product.price < filters.minPrice) {
      return false;
    }

    if (filters.maxPrice !== null && product.price > filters.maxPrice) {
      return false;
    }

    if (filters.inStockOnly && product.stock <= 0) return false;

    return true;
  });

  return sortProducts(matched, filters);
}

/**
 * Sorts a copy. Ties always fall back to the incoming catalog order, so the
 * result is fully deterministic rather than relying on engine sort stability.
 */
export function sortProducts(
  products: Product[],
  filters: CatalogFilters,
): Product[] {
  const indexed = products.map((product, index) => ({ product, index }));

  switch (filters.sort) {
    case "price-asc":
      indexed.sort(
        (a, b) =>
          a.product.price - b.product.price || a.index - b.index,
      );
      break;

    case "price-desc":
      indexed.sort(
        (a, b) =>
          b.product.price - a.product.price || a.index - b.index,
      );
      break;

    case "name-asc":
      indexed.sort(
        (a, b) =>
          a.product.name.localeCompare(b.product.name) || a.index - b.index,
      );
      break;

    case "relevance":
    default:
      if (filters.q.trim()) {
        indexed.sort(
          (a, b) =>
            searchScore(b.product, filters.q) -
              searchScore(a.product, filters.q) || a.index - b.index,
        );
      } else {
        // No search term: surface featured items first, then catalog order.
        indexed.sort(
          (a, b) =>
            Number(Boolean(b.product.featured)) -
              Number(Boolean(a.product.featured)) || a.index - b.index,
        );
      }
      break;
  }

  return indexed.map((entry) => entry.product);
}

/* -------------------------------------------------------------------------- */
/* Facets                                                                     */
/* -------------------------------------------------------------------------- */

export interface BrandFacet {
  value: string;
  count: number;
}

export interface CategoryFacet {
  slug: string;
  name: string;
  count: number;
}

export interface CatalogFacets {
  brands: BrandFacet[];
  categories: CategoryFacet[];
  minPrice: number;
  maxPrice: number;
}

/**
 * Facet counts are computed against the search term only, so typing "sony"
 * narrows the brand list while still letting you combine filters freely.
 */
export function buildFacets(
  products: Product[],
  query = "",
): CatalogFacets {
  const visible = query.trim()
    ? products.filter((product) => matchesQuery(product, query))
    : products;

  const brandCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  let minPrice = 0;
  let maxPrice = 0;

  for (const product of visible) {
    brandCounts.set(product.brand, (brandCounts.get(product.brand) ?? 0) + 1);
    categoryCounts.set(
      product.categorySlug,
      (categoryCounts.get(product.categorySlug) ?? 0) + 1,
    );
    if (minPrice === 0 || product.price < minPrice) minPrice = product.price;
    if (product.price > maxPrice) maxPrice = product.price;
  }

  return {
    brands: Array.from(brandCounts, ([value, count]) => ({ value, count })).sort(
      (a, b) => a.value.localeCompare(b.value),
    ),
    categories: CATEGORIES.filter((category) =>
      categoryCounts.has(category.slug),
    ).map((category) => ({
      slug: category.slug,
      name: category.name,
      count: categoryCounts.get(category.slug) ?? 0,
    })),
    minPrice,
    maxPrice,
  };
}
