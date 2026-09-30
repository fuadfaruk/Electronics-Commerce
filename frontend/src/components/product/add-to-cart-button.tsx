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
  const { addProduct } = useCart();
  const soldOut = product.stock <= 0;

  return (
    <Button
      size={size}
      fullWidth={fullWidth}
      variant={variant}
      className={className}
      disabled={soldOut}
      onClick={() => addProduct(product, quantity)}
    >
      <CartIcon className="size-5" />
      {soldOut ? "Out of stock" : "Add to cart"}
    </Button>
  );
}

/**
 * Compact add button for product cards. The card itself is covered by a
 * stretched link, so this sits above it in the stacking order and swallows the
 * click — no nested interactive elements.
 */
export function QuickAddButton({ product }: { product: Product }) {
  const { addProduct } = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const soldOut = product.stock <= 0;

  useEffect(() => {
    if (!justAdded) return;
    const timer = window.setTimeout(() => setJustAdded(false), 1600);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  return (
    <button
      type="button"
      disabled={soldOut}
      onClick={() => {
        addProduct(product, 1);
        setJustAdded(true);
      }}
      aria-label={
        soldOut
          ? `${product.name} is out of stock`
          : `Add ${product.name} to cart`
      }
      className={cn(
        // h-11 keeps the most-tapped control in the app at a full 44px.
        "relative z-10 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors",
        soldOut
          ? "border-border bg-surface-muted text-muted-foreground"
          : justAdded
            ? "border-success/30 bg-success-soft text-success"
            : "border-border-strong bg-surface text-foreground hover:bg-surface-muted",
      )}
    >
      {soldOut ? (
        "Out of stock"
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
