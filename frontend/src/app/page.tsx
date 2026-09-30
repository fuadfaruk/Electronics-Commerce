import { CategoryTiles } from "@/components/catalog/category-tiles";
import { ProductRail } from "@/components/product/product-rail";
import { CashIcon, ShieldIcon, TruckIcon } from "@/components/ui/icons";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import {
  getCategoryCounts,
  getDealProducts,
  getFeaturedProducts,
} from "@/lib/catalog/queries";
import { formatBDT } from "@/lib/money";

export default async function HomePage() {
  const [featured, deals, counts] = await Promise.all([
    getFeaturedProducts(8),
    getDealProducts(8),
    getCategoryCounts(),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
            Gadgets and parts, delivered across Bangladesh
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Phones, laptops, components and accessories — cash on delivery, with
            free delivery over {formatBDT(FREE_DELIVERY_THRESHOLD)}.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <li className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5">
            <CashIcon className="size-5 shrink-0 text-brand" />
            Cash on delivery
          </li>
          <li className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5">
            <TruckIcon className="size-5 shrink-0 text-brand" />
            Free delivery over {formatBDT(FREE_DELIVERY_THRESHOLD)}
          </li>
          <li className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5">
            <ShieldIcon className="size-5 shrink-0 text-brand" />
            bKash and Nagad accepted
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold sm:text-lg">
          Shop by category
        </h2>
        <CategoryTiles counts={counts} />
      </section>

      <ProductRail
        title="Featured"
        products={featured}
        href="/products"
        hrefLabel="See all"
      />

      <ProductRail title="Deals" products={deals} />
    </div>
  );
}
