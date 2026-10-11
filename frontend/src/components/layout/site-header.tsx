import Link from "next/link";
import { Suspense } from "react";
import { CartButton } from "@/components/cart/cart-button";
import {
  SearchField,
  SearchFieldSkeleton,
} from "@/components/search/search-field";
import { SITE_NAME, SITE_SUBTITLE } from "@/lib/site";

/**
 * Sticky header: illuminated wordmark, search, and the staged-modules cart.
 *
 * On phones the search sits on its own full-width row under the wordmark, which
 * is both easier to hit and closer to the thumb than a narrow inline field.
 * `useSearchParams` needs a Suspense boundary, hence the skeleton.
 */
export function SiteHeader() {
  return (
    <header className="glass-bar sticky top-0 z-40 border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="illuminated-node" aria-hidden="true">
            &bull;
          </span>
          <span className="min-w-0">
            <span className="app-title block truncate">
              {SITE_NAME.toUpperCase()}
            </span>
            <span className="app-subtitle block truncate">{SITE_SUBTITLE}</span>
          </span>
        </Link>

        <div className="hidden max-w-xl flex-1 md:block">
          <Suspense fallback={<SearchFieldSkeleton />}>
            <SearchField />
          </Suspense>
        </div>

        <nav aria-label="Primary" className="ml-auto hidden md:block">
          <Link
            href="/products"
            className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-surface-muted"
          >
            Shop
          </Link>
        </nav>

        <CartButton className="ml-auto md:ml-0" />
      </div>

      <div className="px-4 pb-3 md:hidden">
        <Suspense fallback={<SearchFieldSkeleton />}>
          <SearchField />
        </Suspense>
      </div>
    </header>
  );
}
