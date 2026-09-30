import Link from "next/link";
import { CATEGORIES } from "@/data/categories.mock";
import { ChevronRightIcon } from "@/components/ui/icons";
import { ProductImage } from "@/components/product/product-image";

/**
 * Browse-by-category entry points. These are the main way into the catalog on a
 * phone — a shopper picks a category far more often than they search.
 */
export function CategoryTiles({
  counts,
  className,
}: {
  counts?: Record<string, number>;
  className?: string;
}) {
  return (
    <ul
      className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${className ?? ""}`}
    >
      {CATEGORIES.map((category) => (
        <li key={category.slug}>
          <Link
            href={`/products?category=${category.slug}`}
            className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-border-strong"
          >
            <div className="relative aspect-4/3 bg-surface-muted">
              <ProductImage
                src={category.image}
                alt=""
                sizes="(min-width: 1024px) 280px, 45vw"
                className="transition-transform duration-200 group-hover:scale-[1.03]"
              />
            </div>
            <div className="flex flex-1 items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{category.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {counts?.[category.slug] !== undefined
                    ? `${counts[category.slug]} items`
                    : category.blurb}
                </p>
              </div>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
