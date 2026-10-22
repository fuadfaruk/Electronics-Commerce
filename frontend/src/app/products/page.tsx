import type { Metadata } from "next";
import { EmptyState } from "@/components/catalog/empty-state";
import { ListingControls } from "@/components/catalog/listing-controls";
import { ListingResults } from "@/components/catalog/listing-results";
import { ErrorNotice } from "@/components/ui/error-notice";
import { getStorefrontConfig } from "@/lib/api/config";
import { getApiResult } from "@/lib/api/errors";
import { buildListingHref, parseCatalogFilters } from "@/lib/catalog/filters";
import { getCatalogPage, getCategoryBySlug } from "@/lib/catalog/queries";

export const metadata: Metadata = {
  title: "Shop", description: "Browse phones, laptops, components, storage and accessories.",
};

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const filters = parseCatalogFilters(await searchParams);
  const catalog = await getApiResult(() => getCatalogPage(filters));
  const category = filters.categories.length === 1
    ? await getApiResult(() => getCategoryBySlug(filters.categories[0])) : null;
  const heading = category?.ok && category.data ? category.data.name
    : filters.q ? `Results for "${filters.q}"` : "All products";
  if (!catalog.ok) return <div className="space-y-4">
    <h1 className="text-xl font-semibold sm:text-2xl">{heading}</h1>
    <ErrorNotice heading="Products could not be loaded" problem={catalog.problem} />
  </div>;
  const { totalCount, facets } = catalog.data;
  return <div className="space-y-4">
    <header className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{heading}</h1>
      <p className="text-sm text-muted-foreground">{totalCount} {totalCount === 1 ? "product" : "products"}</p>
      {category?.ok && category.data?.isArchived ? <p className="text-xs text-muted-foreground">This category is archived. Existing product references are retained.</p> : null}
    </header>
    <ListingControls filters={filters} facets={facets} resultCount={totalCount} />
    {totalCount > 0 ? <ListingResults key={buildListingHref(filters)} initialPage={catalog.data} filters={filters} mode={getStorefrontConfig().mode} />
      : <EmptyState title="No products match" message="Try a different search term, or remove a filter to see more." actionHref="/products" actionLabel="Clear filters" />}
  </div>;
}
