import { ProductCard } from "@/components/product/product-card";
import { cn } from "@/lib/cn";
import type { Product } from "@/types/domain";

/**
 * One column on phones, widening to four on large screens. Switching phones to
 * a two-up grid is a change to this one line.
 */
export function ProductGrid({
  products,
  className,
}: {
  products: Product[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {products.map((product) => (
        <li key={product.id} className="min-w-0">
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
