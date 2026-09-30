import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import { formatBDT } from "@/lib/money";
import type { CartTotals } from "@/types/domain";

/**
 * Tells the shopper how close they are to free delivery. Shown in the cart
 * drawer, which is the only place a total is displayed today.
 */
export function FreeDeliveryBar({ totals }: { totals: CartTotals }) {
  if (totals.itemCount === 0) return null;

  if (totals.qualifiesForFreeDelivery) {
    return (
      <p className="rounded-xl bg-success-soft px-3 py-2 text-sm font-medium text-success">
        Free delivery unlocked
      </p>
    );
  }

  const progress = Math.min(
    100,
    Math.round((totals.subtotal / FREE_DELIVERY_THRESHOLD) * 100),
  );

  return (
    <div className="space-y-2 rounded-xl bg-surface-muted px-3 py-2">
      <p className="text-sm">
        Add{" "}
        <span className="font-semibold">
          {formatBDT(totals.freeDeliveryRemaining)}
        </span>{" "}
        more for free delivery
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border-strong"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Progress toward free delivery"
      >
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
