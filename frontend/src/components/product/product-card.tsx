import Link from "next/link";
import { QuickAddButton } from "@/components/product/add-to-cart-button";
import { PriceTag } from "@/components/product/price-tag";
import { ProductImage } from "@/components/product/product-image";
import { StockBadge } from "@/components/product/stock-badge";
import { cn } from "@/lib/cn";
import type { Product } from "@/types/domain";

/**
 * Catalog card, styled as an acrylic module on the light table.
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
  const tags = product.specs.slice(0, 3).map((spec) => spec.value);

  return (
    <article
      className={cn(
        "acrylic-module group relative flex h-full flex-col p-3.5",
        "focus-within:ring-2 focus-within:ring-brand",
        className,
      )}
    >
      <div className="prism-stage mb-3.5 aspect-square">
        <ProductImage
          src={product.images[0] ?? ""}
          alt={product.name}
          priority={priority}
          sizes="(min-width: 1280px) 300px, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"
          className="transition-transform duration-200 group-hover:scale-[1.03]"
        />
        <span className="stage-reflection" aria-hidden="true" />
      </div>

      <span className="mod-code">{product.brand}</span>

      <h3 className="mod-title mt-1">
        <Link
          href={`/products/${product.slug}`}
          className="line-clamp-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {product.name}
        </Link>
      </h3>

      <p className="mod-desc mt-1.5 line-clamp-2">{product.description}</p>

      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span key={tag} className="acrylic-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="tray-bottom mt-auto flex items-end justify-between gap-2 pt-3.5">
        <div className="min-w-0 space-y-1.5">
          <PriceTag
            price={product.price}
            compareAtPrice={product.compareAtPrice}
            size="sm"
          />
          <StockBadge stock={product.stock} />
        </div>

        <QuickAddButton product={product} />
      </div>
    </article>
  );
}
