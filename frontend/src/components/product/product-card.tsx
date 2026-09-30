import Link from "next/link";
import { QuickAddButton } from "@/components/product/add-to-cart-button";
import { PriceTag } from "@/components/product/price-tag";
import { ProductImage } from "@/components/product/product-image";
import { StockBadge } from "@/components/product/stock-badge";
import { cn } from "@/lib/cn";
import type { Product } from "@/types/domain";

/**
 * Catalog card: image, brand, name, price, stock, add.
 *
 * There is exactly one link per card. A stretched pseudo-element covers the
 * card, and the add button is lifted above it, so the card is clickable without
 * nesting a button inside an anchor.
 */
export function ProductCard({
  product,
  priority = false,
  className,
}: {
  product: Product;
  priority?: boolean;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface",
        "focus-within:ring-2 focus-within:ring-brand",
        className,
      )}
    >
      <div className="relative aspect-square bg-surface-muted">
        <ProductImage
          src={product.images[0] ?? ""}
          alt={product.name}
          priority={priority}
          sizes="(min-width: 1280px) 300px, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"
          className="transition-transform duration-200 group-hover:scale-[1.02]"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {product.brand}
        </p>

        <h3 className="text-sm leading-snug font-medium">
          <Link
            href={`/products/${product.slug}`}
            className="line-clamp-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>

        <PriceTag
          price={product.price}
          compareAtPrice={product.compareAtPrice}
          size="sm"
        />

        <div className="mt-auto flex items-center gap-2 pt-1">
          <StockBadge stock={product.stock} />
        </div>

        <QuickAddButton product={product} />
      </div>
    </article>
  );
}
