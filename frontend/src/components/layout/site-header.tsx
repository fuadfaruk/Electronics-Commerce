import Link from "next/link";
import { Suspense } from "react";
import { CartButton } from "@/components/cart/cart-button";
import {
  SearchField,
  SearchFieldSkeleton,
} from "@/components/search/search-field";
import { SITE_NAME } from "@/lib/site";

/**
 * Sticky header: wordmark, search, and the cart.
 *
 * On phones the search sits on its own full-width row under the wordmark, which
 * is both easier to hit and closer to the thumb than a narrow inline field.
 * `useSearchParams` needs a Suspense boundary, hence the skeleton.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16">
        <Link
          href="/"
          className="shrink-0 text-lg font-semibold tracking-tight"
        >
          {SITE_NAME}
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
