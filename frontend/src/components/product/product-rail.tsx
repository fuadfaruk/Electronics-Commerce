import Link from "next/link";
import { ProductCard } from "@/components/product/product-card";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { Product } from "@/types/domain";

/**
 * Horizontal scroll-snap rail, used on the home and detail pages.
 *
 * The negative margin lets cards bleed to the screen edge on phones, which is
 * what makes the row feel swipeable rather than clipped.
 */
export function ProductRail({
  title,
  products,
  href,
  hrefLabel = "See all",
}: {
  title: string;
  products: Product[];
  href?: string;
  hrefLabel?: string;
}) {
  if (!products.length) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-brand hover:text-brand-strong"
          >
            {hrefLabel}
            <ChevronRightIcon className="size-4" />
          </Link>
        ) : null}
      </div>

      <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {products.map((product) => (
          <li
            key={product.id}
            className="w-[62%] min-w-[11rem] shrink-0 snap-start sm:w-56"
          >
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}
