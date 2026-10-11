import Link from "next/link";
import { CATEGORIES } from "@/data/categories.mock";
import { formatBDT } from "@/lib/money";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/** Short footer: category links, store facts we can actually stand behind. */
export function SiteFooter() {
  return (
    <footer className="glass-bar mt-10 border-t border-border">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div>
          <p className="app-title">{SITE_NAME}</p>
          <p className="mt-1 text-sm text-muted-foreground">{SITE_TAGLINE}</p>
        </div>

        <nav aria-label="Categories" className="space-y-2">
          <h2 className="bench-strip">Shop by category</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {CATEGORIES.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/products?category=${category.slug}`}
                  // Full 44px rows: footer links are still thumb targets.
                  className="inline-flex min-h-11 items-center text-muted-foreground hover:text-brand"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>Cash on delivery, bKash and Nagad</li>
          <li>Free delivery on orders over {formatBDT(FREE_DELIVERY_THRESHOLD)}</li>
          <li>Prices include VAT</li>
        </ul>

        <p className="text-xs text-muted-foreground">
          Frontend demo running on mock catalog data. Checkout is not built yet.
        </p>

        {/* Telemetry readout, in the light-table bench style. */}
        <div className="bench-strip flex flex-col gap-1 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
          <span>Substrate: cash on delivery</span>
          <span>Calibration: bKash &amp; Nagad</span>
          <span>Status: free delivery over {formatBDT(FREE_DELIVERY_THRESHOLD)}</span>
        </div>
      </div>
    </footer>
  );
}
