"use client";

import { CartIcon } from "@/components/ui/icons";
import { useCart } from "@/lib/cart/store";
import { cn } from "@/lib/cn";

/**
 * Opens the cart drawer. The count only renders after storage has been read, so
 * the server and client markup agree on the first paint.
 */
export function CartButton({ className }: { className?: string }) {
  const { itemCount, hydrated, openCart } = useCart();

  const showCount = hydrated && itemCount > 0;

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={
        showCount ? `Open cart, ${itemCount} items` : "Open cart, empty"
      }
      className={cn(
        "relative flex size-11 items-center justify-center rounded-xl text-foreground hover:bg-surface-muted",
        className,
      )}
    >
      <CartIcon className="size-6" />
      {showCount ? (
        <span className="absolute top-0.5 right-0.5 min-w-5 rounded-full bg-brand px-1 text-center text-xs font-semibold text-white tabular-nums">
          {itemCount > 99 ? "99+" : itemCount}
        </span>
      ) : null}
    </button>
  );
}
