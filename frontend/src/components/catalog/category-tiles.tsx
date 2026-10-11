import Link from "next/link";
import { CATEGORIES } from "@/data/categories.mock";
import { ChevronRightIcon } from "@/components/ui/icons";
import { ProductImage } from "@/components/product/product-image";

/**
 * Browse-by-category entry points, styled as acrylic modules. These are the
 * main way into the catalog on a phone — a shopper picks a category far more
 * often than they search.
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
            className="acrylic-module group flex h-full flex-col p-3"
          >
            <div className="prism-stage mb-3 aspect-4/3">
              <ProductImage
                src={category.image}
                alt=""
                sizes="(min-width: 1024px) 280px, 45vw"
                className="transition-transform duration-200 group-hover:scale-[1.03]"
              />
              <span className="stage-reflection" aria-hidden="true" />
            </div>

            <span className="mod-code">{category.slug}</span>

            <div className="flex flex-1 items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="mod-title truncate">{category.name}</p>
                <p className="mod-desc truncate">
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
