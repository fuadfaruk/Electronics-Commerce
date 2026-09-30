"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart/store";
import { CartIcon, GridIcon, HomeIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * Phone-only tab bar.
 *
 * Three destinations, all inside the thumb arc, and the cart opens the drawer
 * rather than navigating because there is no cart page. Hidden from `md` up,
 * where the header carries the same links.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { openCart, itemCount, hydrated } = useCart();

  const shopActive = pathname.startsWith("/products");

  // Fixed 3.5rem row so the sticky buy bar can sit exactly above it.
  const itemClass =
    "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium";

  return (
    <nav
      aria-label="Quick navigation"
      /*
        The top edge is drawn with a shadow rather than a border so the bar's
        height stays exactly 3.5rem plus the safe-area inset — the same value
        the page reserves for it. A border would add a stray pixel and clip the
        last row of content.
      */
      className="fixed inset-x-0 bottom-0 z-40 bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_0_var(--border)] md:hidden"
    >
      <div className="mx-auto flex max-w-6xl">
        <Link
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          className={cn(
            itemClass,
            pathname === "/" ? "text-brand" : "text-muted-foreground",
          )}
        >
          <HomeIcon className="size-6" />
          Home
        </Link>

        <Link
          href="/products"
          aria-current={shopActive ? "page" : undefined}
          className={cn(
            itemClass,
            shopActive ? "text-brand" : "text-muted-foreground",
          )}
        >
          <GridIcon className="size-6" />
          Shop
        </Link>

        <button
          type="button"
          onClick={openCart}
          className={cn(itemClass, "relative text-muted-foreground")}
        >
          <span className="relative">
            <CartIcon className="size-6" />
            {hydrated && itemCount > 0 ? (
              <span className="absolute -top-1 -right-2 min-w-4.5 rounded-full bg-brand px-1 text-center text-[0.625rem] leading-4 font-semibold text-white tabular-nums">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            ) : null}
          </span>
          Cart
        </button>
      </div>
    </nav>
  );
}
