"use client";

import Link from "next/link";
import { CartLineRow } from "@/components/cart/cart-line-row";
import { FreeDeliveryBar } from "@/components/cart/free-delivery-bar";
import { buttonStyles } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { CashIcon, WalletIcon } from "@/components/ui/icons";
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { useCart } from "@/lib/cart/store";
import { formatBDT } from "@/lib/money";
import type { CartTotals } from "@/types/domain";

/**
 * The cart, as a drawer available from every screen.
 *
 * There is no checkout route yet, so the checkout action is presented honestly
 * as unavailable rather than as a button that leads nowhere. The totals below
 * it are computed for real.
 */
export function CartDrawer() {
  const { isOpen, closeCart, lines, totals } = useCart();

  return (
    <Drawer
      open={isOpen}
      onClose={closeCart}
      title="Your cart"
      description={
        totals.itemCount === 0
          ? "Nothing added yet"
          : `${totals.itemCount} ${totals.itemCount === 1 ? "item" : "items"}`
      }
      footer={
        lines.length > 0 ? <CartFooter totals={totals} /> : undefined
      }
    >
      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Your cart is empty. Browse the catalog and add something to it.
          </p>
          <Link
            href="/products"
            onClick={closeCart}
            className={buttonStyles({ variant: "secondary" })}
          >
            Browse products
          </Link>
        </div>
      ) : (
        <div className="px-4">
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <CartLineRow key={line.productId} line={line} />
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

function CartFooter({ totals }: { totals: CartTotals }) {
  return (
    <div className="space-y-3">
      <FreeDeliveryBar totals={totals} />

      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="font-medium tabular-nums">
            {formatBDT(totals.subtotal)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Delivery</dt>
          <dd className="font-medium tabular-nums">
            {totals.deliveryFee === 0 ? "Free" : formatBDT(totals.deliveryFee)}
          </dd>
        </div>
        <div className="flex justify-between border-t border-border pt-1.5 text-base">
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold tabular-nums">
            {formatBDT(totals.total)}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        Prices include VAT. A {formatBDT(DELIVERY_FEE)} delivery fee applies
        under {formatBDT(FREE_DELIVERY_THRESHOLD)}.
      </p>

      <button
        type="button"
        disabled
        aria-disabled="true"
        className={buttonStyles({ size: "lg", fullWidth: true })}
      >
        Checkout
      </button>

      <p className="text-center text-xs text-muted-foreground">
        Checkout is not built yet — this storefront runs on mock data.
      </p>

      <p className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CashIcon className="size-4" />
          Cash on delivery
        </span>
        <span className="inline-flex items-center gap-1">
          <WalletIcon className="size-4" />
          bKash &amp; Nagad
        </span>
      </p>
    </div>
  );
}
