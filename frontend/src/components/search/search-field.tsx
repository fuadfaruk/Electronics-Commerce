"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "@/components/ui/icons";
import { inputStyles } from "@/components/ui/input";
import { cn } from "@/lib/cn";

/**
 * Global search.
 *
 * Submitting runs the query against the existing listing screen rather than a
 * separate search page, which keeps one place for filters and results. A new
 * search intentionally starts from a clean slate; per-category searching is
 * what the category tiles are for.
 *
 * The input is uncontrolled and the form is keyed on the current query, so the
 * field picks up URL changes (a removed search chip, say) by remounting rather
 * than by syncing a copy of the URL into state.
 */
export function SearchField({ className }: { className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    router.push(
      query ? `/products?q=${encodeURIComponent(query)}` : "/products",
    );
  };

  return (
    <form
      key={initial}
      role="search"
      onSubmit={submit}
      className={cn("relative", className)}
      aria-label="Search products"
    >
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        name="q"
        defaultValue={initial}
        placeholder="Search phones, laptops, components…"
        aria-label="Search products"
        enterKeyHint="search"
        className={cn(inputStyles, "pl-10")}
      />
    </form>
  );
}

export function SearchFieldSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-11 rounded-xl bg-surface-muted", className)}
      aria-hidden="true"
    />
  );
}
