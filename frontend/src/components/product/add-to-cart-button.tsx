"use client";

import { Button, type ButtonProps } from "@/components/ui/button";
import { CartIcon, CheckIcon } from "@/components/ui/icons";
import { useCart } from "@/lib/cart/store";
import { cn } from "@/lib/cn";
import type { Product } from "@/types/domain";
import { useEffect, useState } from "react";

/**
 * Adds a product to the cart. Adding opens the drawer (handled by the cart
 * store), so the shopper always sees what just happened without leaving the
 * page — which is the whole point of the drawer.
 */
export function AddToCartButton({
  product,
  quantity = 1,
  size = "lg",
  fullWidth = false,
  variant = "primary",
  className,
}: {
  product: Product;
  quantity?: number;
  size?: ButtonProps["size"];
  fullWidth?: boolean;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const { addProduct, hydrated } = useCart();
  const [pending, setPending] = useState(false);
  const soldOut = product.stock <= 0 || !product.saleEligible;

  return (
    <Button
      size={size}
      fullWidth={fullWidth}
      variant={variant}
      className={className}
      disabled={soldOut || !hydrated || pending}
      onClick={async () => {
        setPending(true);
        try { await addProduct(product, quantity); }
        finally { setPending(false); }
      }}
    >
      <CartIcon className="size-5" />
      {soldOut ? "Unavailable" : "Add to cart"}
    </Button>
  );
}

/**
 * Compact add button for product cards. The card itself is covered by a
 * stretched link, so this sits above it in the stacking order and swallows the
 * click — no nested interactive elements.
 */
export function QuickAddButton({ product }: { product: Product }) {
  const { addProduct, hydrated } = useCart();
  const [pending, setPending] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const soldOut = product.stock <= 0 || !product.saleEligible;

  useEffect(() => {
    if (!justAdded) return;
    const timer = window.setTimeout(() => setJustAdded(false), 1600);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  return (
    <button
      type="button"
      disabled={soldOut || !hydrated || pending}
      onClick={async () => {
        setPending(true);
        try { await addProduct(product, 1); setJustAdded(true); }
        finally { setPending(false); }
      }}
      aria-label={
        soldOut
          ? `${product.name} is unavailable`
          : `Add ${product.name} to cart`
      }
      className={cn(
        // h-11 keeps the most-tapped control in the app at a full 44px.
        "relative z-10 inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition-all",
        soldOut
          ? "bg-surface-muted text-muted-foreground"
          : justAdded
            ? "bg-success text-white shadow-[0_0_14px_rgba(15,164,127,0.5)]"
            : "bg-gradient-to-br from-[#0088ff] to-[#0066cc] text-white shadow-[0_4px_12px_rgba(0,136,255,0.35)] hover:shadow-[0_6px_18px_rgba(0,136,255,0.5)] active:scale-[0.97]",
      )}
    >
      {soldOut ? (
        "Unavailable"
      ) : justAdded ? (
        <>
          <CheckIcon className="size-4" />
          Added
        </>
      ) : (
        <>
          <CartIcon className="size-4" />
          Add
        </>
      )}
    </button>
  );
}
