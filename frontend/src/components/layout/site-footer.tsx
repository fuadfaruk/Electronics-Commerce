import Link from "next/link";
import { getApiResult } from "@/lib/api/errors";
import { getCategories } from "@/lib/catalog/queries";
import { formatBDT } from "@/lib/money";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import type { StorefrontMode } from "@/types/api";

export async function SiteFooter({ mode }: { mode: StorefrontMode }) {
  const categories = await getApiResult(getCategories);
  return <footer className="glass-bar mt-10 border-t">
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div><p className="app-title">{SITE_NAME}</p><p className="mt-1 text-sm text-muted-foreground">{SITE_TAGLINE}</p></div>
      {categories.ok ? <nav aria-label="Categories" className="space-y-2">
        <h2 className="bench-strip">Shop by category</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{categories.data.map((c) => <li key={c.id}><Link href={`/products?category=${encodeURIComponent(c.slug)}`} className="inline-flex min-h-11 items-center text-muted-foreground hover:text-brand">{c.name}</Link></li>)}</ul>
      </nav> : <p className="text-sm text-muted-foreground">Category navigation is temporarily unavailable.</p>}
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>Cash on delivery only</li><li>Free delivery from {formatBDT(FREE_DELIVERY_THRESHOLD)}</li><li>Prices include VAT</li>
      </ul>
      <p className="text-xs text-muted-foreground">{mode === "mock" ? "Explicit sample catalog. Accounts and checkout are disabled." : "Live catalog. Order totals are confirmed in a server-issued quote."}</p>
      <div className="bench-strip flex flex-wrap justify-between gap-2 border-t pt-4"><span>Payment: cash on delivery</span><span>{mode === "mock" ? "Mode: sample browsing" : "Mode: live"}</span></div>
    </div>
  </footer>;
}
