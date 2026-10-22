"use client";

import { useEffect, useRef, useState } from "react";
import { ProductGrid } from "@/components/product/product-grid";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { apiProductToProduct } from "@/lib/api/adapters";
import { commerceGet } from "@/lib/api/client";
import { parseCatalogPage } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import { toSearchParams, type CatalogFilters } from "@/lib/catalog/filters";
import type { ApiProblem, CatalogPageDto, StorefrontMode } from "@/types/api";

export function ListingResults({ initialPage, filters, mode }: {
  initialPage: CatalogPageDto; filters: CatalogFilters; mode: StorefrontMode;
}) {
  const [items, setItems] = useState(initialPage.items);
  const [page, setPage] = useState(initialPage.page);
  const [total, setTotal] = useState(initialPage.totalCount);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const active = useRef(true);
  const loading = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const loadMore = async () => {
    if (loading.current) return;
    loading.current = true;
    setPending(true); setProblem(null);
    try {
      const query = toSearchParams(filters);
      query.set("page", String(page + 1)); query.set("pageSize", "12");
      const next = await commerceGet("Product", (v) => parseCatalogPage(v, mode), query);
      if (!active.current) return;
      if (next.page !== page + 1 || next.pageSize !== 12) throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
      setItems((previous) => {
        const ids = new Set(previous.map((p) => p.id));
        return [...previous, ...next.items.filter((p) => !ids.has(p.id) && Boolean(ids.add(p.id)))];
      });
      setPage(next.page); setTotal(next.totalCount);
    } catch (error) {
      if (active.current) setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503));
    } finally {
      loading.current = false;
      if (active.current) setPending(false);
    }
  };
  const hasMore = page * 12 < total;
  return <div className="space-y-4" aria-busy={pending}>
    <ProductGrid products={items.map(apiProductToProduct)} />
    {problem ? <ErrorNotice problem={problem} heading="More products could not be loaded" onRetry={loadMore} /> : null}
    <div className="flex flex-col items-center gap-2">
      {hasMore ? <Button variant="secondary" size="lg" disabled={pending} onClick={loadMore}>{pending ? "Loading..." : "Load more"}</Button> : null}
      <p className="text-xs text-muted-foreground" aria-live="polite">Showing {items.length} of {total}</p>
    </div>
  </div>;
}
