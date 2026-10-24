import Link from "next/link";
import { CashIcon, CheckIcon, TruckIcon } from "@/components/ui/icons";
import { getApiResult } from "@/lib/api/errors";
import { getCategories } from "@/lib/catalog/queries";
import { formatBDT } from "@/lib/money";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import type { StorefrontMode } from "@/types/api";

export async function SiteFooter({ mode }: { mode: StorefrontMode }) {
  const categories = await getApiResult(getCategories);

  return (
    <footer className="mx-auto mt-2 w-full max-w-6xl px-3 pb-4 sm:px-4 sm:pb-6">
      <div className="deck">
        <div className="grid gap-6 p-4 sm:grid-cols-2 sm:p-7 lg:grid-cols-[1.1fr_1.25fr_1fr] lg:gap-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-3 rounded-lg"
            >
              <span className="illuminated-node shrink-0" aria-hidden="true">
                &bull;
              </span>
              <span className="app-title">{SITE_NAME.toUpperCase()}</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {SITE_TAGLINE}
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold">Shop by category</h2>
            {categories.ok ? (
              <nav aria-label="Categories" className="mt-2">
                <ul className="grid grid-cols-2 gap-x-4 text-sm">
                  {categories.data.map((category) => (
                    <li key={category.id} className="min-w-0">
                      <Link
                        href={`/products?category=${encodeURIComponent(category.slug)}`}
                        className="inline-flex min-h-11 w-full items-center rounded-lg py-2 leading-5 text-muted-foreground transition-colors hover:text-brand-strong"
                      >
                        {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Category navigation is temporarily unavailable.
              </p>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold">Ordering &amp; delivery</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2.5">
                <CashIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                <span>Cash on delivery only</span>
              </li>
              <li className="flex items-start gap-2.5">
                <TruckIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                <span>
                  Free delivery from {formatBDT(FREE_DELIVERY_THRESHOLD)}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                <span>Prices include VAT</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {mode === "mock"
              ? "Explicit sample catalog. Accounts and checkout are disabled."
              : "Live catalog. Order totals are confirmed in a server-issued quote."}
          </p>
          <span className="bench-strip inline-flex shrink-0 self-start rounded-full border border-border bg-surface-muted px-3 py-1.5 sm:self-auto">
            {mode === "mock" ? "Mode: sample browsing" : "Mode: live"}
          </span>
        </div>
      </div>
    </footer>
  );
}
