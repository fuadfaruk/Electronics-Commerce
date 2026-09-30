import type { Metadata } from "next";
import { EmptyState } from "@/components/catalog/empty-state";
import { ListingControls } from "@/components/catalog/listing-controls";
import { ListingResults } from "@/components/catalog/listing-results";
import { getCategoryName } from "@/data/categories.mock";
import {
  applyFilters,
  buildFacets,
  parseCatalogFilters,
} from "@/lib/catalog/filters";
import { getProducts } from "@/lib/catalog/queries";

export const metadata: Metadata = {
  title: "Shop",
  description: "Browse phones, laptops, components, storage and accessories.",
};

/**
 * Listing screen, and also the destination for search.
 *
 * All state lives in the URL, so a filtered view can be shared, reloaded and
 * backed out of. The query layer is told nothing about filters — that keeps the
 * data source swappable for a real, server-paged API later.
 */
export default async function ProductsPage({
  searchParams,
}: PageProps<"/products">) {
  const filters = parseCatalogFilters(await searchParams);

  const products = await getProducts();
  const results = applyFilters(products, filters);
  const facets = buildFacets(products, filters.q);

  const heading =
    filters.categories.length === 1
      ? getCategoryName(filters.categories[0])
      : filters.q
        ? `Results for “${filters.q}”`
        : "All products";

  return (
    <div className="space-y-4">
      <header className="space-y-0.5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {heading}
        </h1>
        <p className="text-sm text-muted-foreground">
          {results.length === 1
            ? "1 product"
            : `${results.length} products`}
        </p>
      </header>

      <ListingControls
        filters={filters}
        facets={facets}
        resultCount={results.length}
      />

      {results.length > 0 ? (
        <ListingResults products={results} />
      ) : (
        <EmptyState
          title="No products match"
          message="Try a different search term, or remove a filter to see more."
          actionHref="/products"
          actionLabel="Clear filters"
        />
      )}
    </div>
  );
}
