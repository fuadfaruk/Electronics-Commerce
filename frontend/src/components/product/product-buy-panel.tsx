"use client";

import { useState } from "react";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { QuantityStepper } from "@/components/product/quantity-stepper";
import { StickyBuyBar } from "@/components/product/sticky-buy-bar";
import type { Product } from "@/types/domain";

const ANCHOR_ID = "primary-buy-panel";

/**
 * Owns the chosen quantity for the detail page.
 *
 * The sticky bar is rendered from here rather than from the page so that both
 * add-to-cart surfaces always agree on how many units are being added.
 */
export function ProductBuyPanel({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);

  const soldOut = product.stock <= 0;

  return (
    <div className="space-y-3">
      <div id={ANCHOR_ID} className="flex flex-wrap items-center gap-3">
        <QuantityStepper
          value={quantity}
          stock={product.stock}
          onChange={setQuantity}
        />
        <AddToCartButton
          product={product}
          quantity={quantity}
          className="min-w-[9rem] flex-1"
        />
      </div>

      {!soldOut && product.stock <= 5 ? (
        <p className="text-xs text-warning">
          Only {product.stock} left in stock — the cart is capped at what we
          have.
        </p>
      ) : null}

      <StickyBuyBar
        product={product}
        quantity={quantity}
        anchorId={ANCHOR_ID}
      />
    </div>
  );
}
