import { MOCK_CATEGORIES } from "@/data/categories.mock";
import { MOCK_PRODUCTS } from "@/data/products.mock";
import { productToDto } from "@/lib/api/adapters";
import { ApiRequestError } from "@/lib/api/errors";
import { applyFilters, buildFacets, parseCatalogFilters } from "@/lib/catalog/filters";

/** Mock serves the same bounded browse contracts. It never implements mutations. */
export function mockCommerceRead(path: string, params = new URLSearchParams()): unknown {
  if (path === "Category") return MOCK_CATEGORIES.map((c) => ({
    ...c, productCount: MOCK_PRODUCTS.filter((p) => p.categoryId === c.id).length,
  }));
  if (path.startsWith("Category/by-slug/")) {
    const category = MOCK_CATEGORIES.find((c) => c.slug === path.split("/")[2]);
    if (!category) throw new ApiRequestError({ status: 404 });
    return { ...category, productCount: MOCK_PRODUCTS.filter((p) => p.categoryId === category.id).length };
  }
  if (path === "Product") {
    const raw = Object.fromEntries(Array.from(new Set(params.keys()), (key) => [key, params.getAll(key)]));
    const filters = parseCatalogFilters(raw);
    const products = applyFilters(MOCK_PRODUCTS, filters);
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("pageSize") ?? 12);
    return {
      items: products.slice((page - 1) * pageSize, page * pageSize).map(productToDto),
      totalCount: products.length, page, pageSize, facets: buildFacets(MOCK_PRODUCTS, filters.q),
    };
  }
  if (path === "Product/home") return {
    featured: MOCK_PRODUCTS.filter((p) => p.featured).slice(0, 8).map(productToDto),
    deals: MOCK_PRODUCTS.filter((p) => p.compareAtPrice !== undefined && p.compareAtPrice > p.price)
      .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id)).slice(0, 8).map(productToDto),
    newArrivals: MOCK_PRODUCTS.slice(-8).reverse().map(productToDto),
  };
  if (path.startsWith("Product/")) {
    const segments = path.split("/");
    const product = MOCK_PRODUCTS.find((p) => segments[1] === "by-slug" ? p.slug === segments[2] : p.id === segments[1]);
    if (!product) throw new ApiRequestError({ status: 404 });
    return {
      product: productToDto(product),
      related: MOCK_PRODUCTS.filter((p) => p.categoryId === product.categoryId && p.id !== product.id)
        .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.price - b.price || a.id.localeCompare(b.id))
        .slice(0, 8).map(productToDto),
    };
  }
  throw new ApiRequestError({ status: 403, code: "MOCK_READ_ONLY" });
}
