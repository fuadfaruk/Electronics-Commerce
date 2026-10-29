"use client";

import Link from "next/link";
import { CartLineRow } from "@/components/cart/cart-line-row";
import { FreeDeliveryBar } from "@/components/cart/free-delivery-bar";
import { buttonStyles } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { CashIcon } from "@/components/ui/icons";
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { useCart } from "@/lib/cart/store";
import { formatBDT } from "@/lib/money";
import type { CartTotals } from "@/types/domain";

export function CartDrawer() {
  const { isOpen, closeCart, lines, totals, notice, dismissNotice } = useCart();

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
      {notice ? <div role="status" className="border-b bg-warning-soft p-4 text-sm">{notice}<button type="button" className="ml-2 min-h-11 font-medium underline" onClick={dismissNotice}>Dismiss</button></div> : null}
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
  const { source, closeCart } = useCart();
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
          <dt className="font-semibold">Estimated total</dt>
          <dd className="font-semibold tabular-nums">
            {formatBDT(totals.total)}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        Prices include VAT. A {formatBDT(DELIVERY_FEE)} delivery fee applies
        under {formatBDT(FREE_DELIVERY_THRESHOLD)}.
      </p>

      {source === "live" ? <Link href="/checkout" onClick={closeCart} className={buttonStyles({ size: "lg", fullWidth: true })}>Review checkout</Link>
        : <button type="button" disabled className={buttonStyles({ size: "lg", fullWidth: true })}>Checkout disabled in sample mode</button>}

      <p className="text-center text-xs text-muted-foreground">
        {source === "mock" ? "Sample browsing only. No live checkout requests are made." : "Prices and stock are checked again in your checkout quote."}
      </p>

      <p className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CashIcon className="size-4" />
          Order confirmation with you
        </span>
      </p>
    </div>
  );
}
