"use client";

import { useState } from "react";
import { ProductGrid } from "@/components/product/product-grid";
import { Button } from "@/components/ui/button";
import { LISTING_PAGE_SIZE } from "@/lib/catalog/filters";
import type { Product } from "@/types/domain";

/**
 * Renders the already-filtered products and reveals them a page at a time.
 *
 * Deliberately a button rather than infinite scroll: nothing should move under
 * the shopper's thumb while they are reading. Filtering and sorting happen on
 * the server from the URL, so this only controls how many of the results are
 * visible. With a real paged API, move this paging into the query layer.
 */
export function ListingResults({ products }: { products: Product[] }) {
  const [visibleCount, setVisibleCount] = useState(LISTING_PAGE_SIZE);

  const visible = products.slice(0, visibleCount);
  const remaining = products.length - visible.length;

  return (
    <div className="space-y-4">
      <ProductGrid products={visible} />

      {remaining > 0 ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setVisibleCount((count) => count + LISTING_PAGE_SIZE)}
          >
            Load more
          </Button>
          <p className="text-xs text-muted-foreground">
            Showing {visible.length} of {products.length}
          </p>
        </div>
      ) : null}
    </div>
  );
}
