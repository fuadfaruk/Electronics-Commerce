"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { CloseIcon, SlidersIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import {
  SORT_KEYS,
  SORT_LABELS,
  buildListingHref,
  clearFilters,
  countActiveFilters,
  toggleBrand,
  toggleCategory,
  type CatalogFacets,
  type CatalogFilters,
} from "@/lib/catalog/filters";
import { cn } from "@/lib/cn";
import { formatBDT } from "@/lib/money";
import { getCategoryName } from "@/data/categories.mock";

/**
 * Everything that changes the listing, in one client component.
 *
 * Filters are pushed to the URL rather than held in component state, so results
 * stay shareable and the back button behaves. Toggles apply immediately while
 * the sheet stays open, which keeps the "Show N results" count honest without
 * shipping the whole catalog to the browser.
 */
export function ListingControls({
  filters,
  facets,
  resultCount,
}: {
  filters: CatalogFilters;
  facets: CatalogFacets;
  resultCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount = countActiveFilters(filters);

  const apply = (next: CatalogFilters) => {
    startTransition(() => {
      router.push(buildListingHref(next), { scroll: false });
    });
  };

  return (
    <div className={cn("space-y-3", isPending && "opacity-60")}>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
        >
          <SlidersIcon className="size-4" />
          Filters
          {activeCount > 0 ? (
            <span className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
              {activeCount}
            </span>
          ) : null}
        </Button>

        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-muted-foreground">
            Sort
          </span>
          {/* A native select is the most thumb-friendly control on a phone. */}
          <select
            value={filters.sort}
            onChange={(event) =>
              apply({ ...filters, sort: event.target.value as CatalogFilters["sort"] })
            }
            className="h-11 rounded-xl border border-border-strong bg-surface px-3 text-sm font-medium"
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeCount > 0 ? (
        <ul className="flex flex-wrap items-center gap-2">
          {filters.q ? (
            <li>
              <Chip
                label={`Search: ${filters.q}`}
                onRemove={() => apply({ ...filters, q: "" })}
              />
            </li>
          ) : null}

          {filters.categories.map((slug) => (
            <li key={`cat-${slug}`}>
              <Chip
                label={getCategoryName(slug)}
                onRemove={() => apply(toggleCategory(filters, slug))}
              />
            </li>
          ))}

          {filters.brands.map((brand) => (
            <li key={`brand-${brand}`}>
              <Chip
                label={brand}
                onRemove={() => apply(toggleBrand(filters, brand))}
              />
            </li>
          ))}

          {filters.minPrice !== null || filters.maxPrice !== null ? (
            <li>
              <Chip
                label={priceLabel(filters)}
                onRemove={() =>
                  apply({ ...filters, minPrice: null, maxPrice: null })
                }
              />
            </li>
          ) : null}

          {filters.inStockOnly ? (
            <li>
              <Chip
                label="In stock only"
                onRemove={() => apply({ ...filters, inStockOnly: false })}
              />
            </li>
          ) : null}

          <li>
            <button
              type="button"
              onClick={() => apply(clearFilters(filters))}
              // All-side inset: a y-only inset leaves width auto, which
              // collapses the pseudo-element to zero width.
              className="relative h-10 rounded-full px-3 text-sm font-medium text-brand after:absolute after:-inset-0.5 after:content-[''] hover:bg-brand-soft"
            >
              Clear all
            </button>
          </li>
        </ul>
      ) : null}

      <Drawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters"
        description={
          resultCount === 1 ? "1 product" : `${resultCount} products`
        }
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => apply(clearFilters(filters))}
              disabled={activeCount === 0}
            >
              Clear all
            </Button>
            <Button fullWidth onClick={() => setSheetOpen(false)}>
              Show {resultCount === 1 ? "1 result" : `${resultCount} results`}
            </Button>
          </div>
        }
      >
        <div className="divide-y divide-border">
          <FilterGroup title="Category">
            {facets.categories.map((category) => (
              <CheckRow
                key={category.slug}
                label={category.name}
                count={category.count}
                checked={filters.categories.includes(category.slug)}
                onChange={() => apply(toggleCategory(filters, category.slug))}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Brand">
            <div className="max-h-72 overflow-y-auto overscroll-contain">
              {facets.brands.map((brand) => (
                <CheckRow
                  key={brand.value}
                  label={brand.value}
                  count={brand.count}
                  checked={filters.brands.includes(brand.value)}
                  onChange={() => apply(toggleBrand(filters, brand.value))}
                />
              ))}
            </div>
          </FilterGroup>

          <FilterGroup title="Price">
            {/*
              Keyed on the applied range so "Clear all" — or any other change
              from outside — resets the fields by remounting them.
            */}
            <PriceFields
              key={`${filters.minPrice ?? ""}-${filters.maxPrice ?? ""}`}
              filters={filters}
              onApply={apply}
            />
          </FilterGroup>

          <FilterGroup title="Availability">
            <CheckRow
              label="In stock only"
              checked={filters.inStockOnly}
              onChange={() =>
                apply({ ...filters, inStockOnly: !filters.inStockOnly })
              }
            />
          </FilterGroup>
        </div>
      </Drawer>
    </div>
  );
}

function priceLabel(filters: CatalogFilters): string {
  if (filters.minPrice !== null && filters.maxPrice !== null) {
    return `${formatBDT(filters.minPrice)} – ${formatBDT(filters.maxPrice)}`;
  }
  if (filters.minPrice !== null) return `From ${formatBDT(filters.minPrice)}`;
  return `Up to ${formatBDT(filters.maxPrice ?? 0)}`;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-10 items-center gap-1 rounded-full border border-border-strong bg-surface pr-0.5 pl-3 text-sm">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
        // Visually snug, 44px to the thumb.
        className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-surface-muted hover:text-foreground"
      >
        <CloseIcon className="size-3.5" />
      </button>
    </span>
  );
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 py-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-5 shrink-0 rounded accent-brand"
      />
      <span className="flex-1 text-sm">{label}</span>
      {count !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Price needs a commit point: navigating on every keystroke would fire a
 * request per digit, so it applies on blur or Enter instead. The inputs are
 * uncontrolled for that reason — there is no need to track each keystroke.
 */
function PriceFields({
  filters,
  onApply,
}: {
  filters: CatalogFilters;
  onApply: (next: CatalogFilters) => void;
}) {
  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const nextMin = parsePrice(minRef.current?.value);
    const nextMax = parsePrice(maxRef.current?.value);

    if (nextMin === filters.minPrice && nextMax === filters.maxPrice) return;
    onApply({ ...filters, minPrice: nextMin, maxPrice: nextMax });
  };

  return (
    <div className="flex items-end gap-2 pt-1">
      <label className="flex-1">
        <span className="mb-1 block text-xs text-muted-foreground">Min (৳)</span>
        <Input
          ref={minRef}
          inputMode="numeric"
          defaultValue={filters.minPrice?.toString() ?? ""}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          placeholder="0"
        />
      </label>
      <label className="flex-1">
        <span className="mb-1 block text-xs text-muted-foreground">Max (৳)</span>
        <Input
          ref={maxRef}
          inputMode="numeric"
          defaultValue={filters.maxPrice?.toString() ?? ""}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          placeholder="Any"
        />
      </label>
    </div>
  );
}

/** Tolerates pasted spaces and separators; anything unusable becomes null. */
function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}
