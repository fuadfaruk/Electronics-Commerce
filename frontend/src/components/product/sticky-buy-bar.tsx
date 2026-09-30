"use client";

import { useEffect, useState } from "react";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { formatBDT } from "@/lib/money";
import type { Product } from "@/types/domain";

/**
 * Phone-only buy bar that appears once the page's main add-to-cart button has
 * scrolled off the top.
 *
 * It waits for that instead of being permanently pinned, because the tab bar is
 * already fixed to the bottom and two stacked bars would eat a sixth of the
 * screen. Hidden from `md` up, where the inline button is easy to reach.
 */
export function StickyBuyBar({
  product,
  quantity,
  anchorId,
}: {
  product: Product;
  quantity: number;
  anchorId: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const anchor = document.getElementById(anchorId);
    if (!anchor || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Only once it has passed above the viewport, never while below it.
        setVisible(
          !entry.isIntersecting && entry.boundingClientRect.top < 0,
        );
      },
      { threshold: 0 },
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchorId]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-surface px-4 py-2 md:hidden">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {product.brand}
          </p>
          <p className="text-sm font-semibold tabular-nums">
            {formatBDT(product.price)}
          </p>
        </div>
        <AddToCartButton
          product={product}
          quantity={quantity}
          size="md"
          className="ml-auto shrink-0"
        />
      </div>
    </div>
  );
}
