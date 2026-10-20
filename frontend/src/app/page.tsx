import { CategoryTiles } from "@/components/catalog/category-tiles";
import { ProductRail } from "@/components/product/product-rail";
import { ErrorNotice } from "@/components/ui/error-notice";
import { CashIcon, ShieldIcon, TruckIcon } from "@/components/ui/icons";
import { getApiResult } from "@/lib/api/errors";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import {
  getCategoryCounts,
  getDealProducts,
  getFeaturedProducts,
} from "@/lib/catalog/queries";
import { formatBDT } from "@/lib/money";

export default async function HomePage() {
  const mockDataSetting = process.env.NEXT_PUBLIC_USE_MOCK_DATA;
  const catalog = await getApiResult(() =>
    Promise.all([
      getFeaturedProducts(8),
      getDealProducts(8),
      getCategoryCounts(),
    ]),
  );

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-2">
          <p className="bench-strip">
            NEXT_PUBLIC_USE_MOCK_DATA is{" "}
            {mockDataSetting === undefined
              ? "not set"
              : `set to ${mockDataSetting}`}
          </p>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
            Gadgets and parts, delivered across Bangladesh
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Phones, laptops, components and accessories — cash on delivery, with
            free delivery over {formatBDT(FREE_DELIVERY_THRESHOLD)}.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <li className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-3 py-2.5">
            <CashIcon className="size-5 shrink-0 text-brand" />
            Cash on delivery
          </li>
          <li className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-3 py-2.5">
            <TruckIcon className="size-5 shrink-0 text-brand" />
            Free delivery over {formatBDT(FREE_DELIVERY_THRESHOLD)}
          </li>
          <li className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-3 py-2.5">
            <ShieldIcon className="size-5 shrink-0 text-brand" />
            bKash and Nagad accepted
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
        <CategoryTiles counts={catalog.ok ? catalog.data[2] : undefined} />
      </section>

      {catalog.ok ? (
        <>
          <ProductRail
            title="Featured"
            products={catalog.data[0]}
            href="/products"
            hrefLabel="See all"
          />
          <ProductRail title="Deals" products={catalog.data[1]} />
        </>
      ) : null}
    </div>
  );
}
