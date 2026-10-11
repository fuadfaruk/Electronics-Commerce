"use client";

import { CartIcon } from "@/components/ui/icons";
import { formatBDT } from "@/lib/money";
import { useCart } from "@/lib/cart/store";
import { cn } from "@/lib/cn";

/**
 * Opens the cart drawer and reports the staged modules and their running total.
 *
 * The count and total only render after storage has been read, so the server
 * and client markup agree on the first paint.
 */
export function CartButton({ className }: { className?: string }) {
  const { itemCount, totals, hydrated, openCart } = useCart();

  const showCount = hydrated && itemCount > 0;

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={
        showCount
          ? `Open cart, ${itemCount} items, ${formatBDT(totals.total)}`
          : "Open cart, empty"
      }
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white/90 px-3 text-sm shadow-[0_2px_8px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      <CartIcon className="size-5 md:hidden" />
      <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
        Staged Modules:
      </span>
      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[0.6875rem] font-bold text-white shadow-[0_0_8px_rgba(0,136,255,0.5)] tabular-nums">
        {showCount && itemCount > 99 ? "99+" : (showCount ? itemCount : 0)}
      </span>
      <span className="font-mono text-xs font-bold text-foreground tabular-nums">
        {formatBDT(hydrated ? totals.total : 0)}
      </span>
    </button>
  );
}
