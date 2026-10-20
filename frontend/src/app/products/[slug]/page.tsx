import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductBuyPanel } from "@/components/product/product-buy-panel";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductRail } from "@/components/product/product-rail";
import { PriceTag } from "@/components/product/price-tag";
import { SpecTable } from "@/components/product/spec-table";
import { StockBadge } from "@/components/product/stock-badge";
import { ErrorNotice } from "@/components/ui/error-notice";
import { CashIcon, TruckIcon } from "@/components/ui/icons";
import { getCategory } from "@/data/categories.mock";
import { getApiResult } from "@/lib/api/errors";
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { getProductBySlug, getRelatedProducts } from "@/lib/catalog/queries";
import { formatBDT } from "@/lib/money";

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getApiResult(() => getProductBySlug(slug));
  if (!result.ok) return { title: "Product unavailable" };
  const product = result.data;

  if (!product) return { title: "Product not found" };

  return { title: product.name, description: product.description };
}

export default async function ProductPage({
  params,
}: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const result = await getApiResult(() => getProductBySlug(slug));
  if (!result.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Product details unavailable
        </h1>
        <ErrorNotice
          heading="Product could not be loaded"
          problem={result.problem}
        />
      </div>
    );
  }
  const product = result.data;

  if (!product) notFound();

  const category = getCategory(product.categorySlug);
  const related = await getApiResult(() => getRelatedProducts(product));

  return (
    <div className="space-y-8 pb-16 md:pb-0">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:text-brand">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/products?category=${category.slug}`}
              className="hover:text-brand"
            >
              {category.name}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="min-w-0 truncate text-foreground">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        <ProductGallery images={product.images} name={product.name} />

        <div className="space-y-5">
          <div className="space-y-2">
            <Link
              href={`/products?brand=${encodeURIComponent(product.brand)}`}
              className="inline-block text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-brand"
            >
              {product.brand}
            </Link>

            <h1 className="text-xl leading-tight font-semibold sm:text-2xl">
              {product.name}
            </h1>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <PriceTag
                price={product.price}
                compareAtPrice={product.compareAtPrice}
                size="lg"
                showDiscountBadge
              />
              <StockBadge stock={product.stock} />
            </div>

            <p className="text-xs text-muted-foreground">
              Price includes VAT. Whole taka only — no hidden charges.
            </p>
          </div>

          <ProductBuyPanel product={product} />

          <dl className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface text-sm">
            <div className="flex items-start gap-3 px-4 py-3">
              <TruckIcon className="mt-0.5 size-5 shrink-0 text-brand" />
              <div>
                <dt className="font-medium">Delivery</dt>
                <dd className="text-muted-foreground">
                  {formatBDT(DELIVERY_FEE)} flat, free on orders over{" "}
                  {formatBDT(FREE_DELIVERY_THRESHOLD)}.
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-3 px-4 py-3">
              <CashIcon className="mt-0.5 size-5 shrink-0 text-brand" />
              <div>
                <dt className="font-medium">Payment</dt>
                <dd className="text-muted-foreground">
                  Cash on delivery, bKash or Nagad.
                </dd>
              </div>
            </div>
          </dl>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">About this product</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Specifications</h2>
            <SpecTable specs={product.specs} />
          </section>
        </div>
      </div>

      {related.ok ? (
        <ProductRail
          title={`More in ${category.name}`}
          products={related.data}
          href={`/products?category=${category.slug}`}
        />
      ) : (
        <ErrorNotice
          heading="Related products could not be loaded"
          problem={related.problem}
        />
      )}
    </div>
  );
}
