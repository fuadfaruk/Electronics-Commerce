"use client";

import Link from "next/link";
import { ProductImage } from "@/components/product/product-image";
import { QuantityStepper } from "@/components/product/quantity-stepper";
import { TrashIcon } from "@/components/ui/icons";
import { useCart } from "@/lib/cart/store";
import { formatBDT } from "@/lib/money";
import type { CartLine } from "@/types/domain";

/**
 * One cart line: image, name, unit price, quantity control and line total.
 *
 * Tapping the product name closes the drawer, so the shopper lands on the page
 * they expected rather than behind an open panel.
 */
export function CartLineRow({ line }: { line: CartLine }) {
  const { setQuantity, removeLine, closeCart } = useCart();

  const atStockLimit = line.quantity >= line.stock;

  return (
    <li className="flex gap-3 py-4">
      <Link
        href={`/products/${line.slug}`}
        onClick={closeCart}
        aria-hidden="true"
        tabIndex={-1}
        className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-muted"
      >
        <ProductImage src={line.image} alt="" sizes="64px" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{line.brand}</p>
            <Link
              href={`/products/${line.slug}`}
              onClick={closeCart}
              className="line-clamp-2 text-sm font-medium hover:text-brand"
            >
              {line.name}
            </Link>
          </div>

          <button
            type="button"
            onClick={() => removeLine(line.productId)}
            aria-label={`Remove ${line.name} from cart`}
            // Compact visual, 44px hit area: the pseudo-element extends the
            // tap target without pushing the row around.
            className="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-danger-soft hover:text-danger"
          >
            <TrashIcon className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <QuantityStepper
            value={line.quantity}
            stock={line.stock}
            onChange={(next) => setQuantity(line.productId, next)}
          />

          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">
              {formatBDT(line.unitPrice * line.quantity)}
            </p>
            {line.quantity > 1 ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatBDT(line.unitPrice)} each
              </p>
            ) : null}
          </div>
        </div>

        {atStockLimit ? (
          <p className="text-xs text-warning">
            That is all the stock we have right now.
          </p>
        ) : null}
      </div>
    </li>
  );
}
