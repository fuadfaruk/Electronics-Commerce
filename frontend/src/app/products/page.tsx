import type { Metadata } from "next";
import { EmptyState } from "@/components/catalog/empty-state";
import { ListingControls } from "@/components/catalog/listing-controls";
import { ListingResults } from "@/components/catalog/listing-results";
import { ErrorNotice } from "@/components/ui/error-notice";
import { getCategoryName } from "@/data/categories.mock";
import { getApiResult } from "@/lib/api/errors";
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

  const heading =
    filters.categories.length === 1
      ? getCategoryName(filters.categories[0])
      : filters.q
        ? `Results for “${filters.q}”`
        : "All products";

  const catalog = await getApiResult(getProducts);
  if (!catalog.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {heading}
        </h1>
        <ErrorNotice
          heading="Products could not be loaded"
          problem={catalog.problem}
        />
      </div>
    );
  }

  const results = applyFilters(catalog.data, filters);
  const facets = buildFacets(catalog.data, filters.q);

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
