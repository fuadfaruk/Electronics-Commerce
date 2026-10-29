import { CategoryTiles } from "@/components/catalog/category-tiles";
import { ProductRail } from "@/components/product/product-rail";
import { ErrorNotice } from "@/components/ui/error-notice";
import { CashIcon, TruckIcon } from "@/components/ui/icons";
import { getStorefrontConfig } from "@/lib/api/config";
import { getApiResult } from "@/lib/api/errors";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import {
  getCategories,
  getHomeCollections,
} from "@/lib/catalog/queries";
import { formatBDT } from "@/lib/money";

export default async function HomePage() {
  const { mode } = getStorefrontConfig();
  const catalog = await getApiResult(() =>
    Promise.all([
      getHomeCollections(),
      getCategories(),
    ]),
  );

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-2">
          <p className="bench-strip">
            {mode === "mock" ? "Sample catalog / checkout disabled" : "Live catalog / private order tracking"}
          </p>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
            Gadgets and parts, delivered across Bangladesh
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Phones, laptops, components and accessories, with free delivery from
            {formatBDT(FREE_DELIVERY_THRESHOLD)}. We will contact you to confirm the order and payment.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <li className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-3 py-2.5">
            <CashIcon className="size-5 shrink-0 text-brand" />
            Order confirmation with you
          </li>
          <li className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-3 py-2.5">
            <TruckIcon className="size-5 shrink-0 text-brand" />
            Free delivery from {formatBDT(FREE_DELIVERY_THRESHOLD)}
          </li>
        </ul>
      </section>

      {!catalog.ok ? (
        <ErrorNotice
          heading="Catalog could not be loaded"
          problem={catalog.problem}
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold sm:text-lg">
          Shop by category
        </h2>
        {catalog.ok ? <CategoryTiles categories={catalog.data[1]} /> : null}
      </section>

      {catalog.ok ? (
        <>
          <ProductRail
            title="Featured"
            products={catalog.data[0].featured}
            href="/products"
            hrefLabel="See all"
          />
          <ProductRail title="Deals" products={catalog.data[0].deals} />
          <ProductRail title="New arrivals" products={catalog.data[0].newArrivals} />
        </>
      ) : null}
    </div>
  );
}
