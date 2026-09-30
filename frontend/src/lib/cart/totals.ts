import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@/lib/cart/pricing";
import type { CartLine, CartTotals } from "@/types/domain";

/**
 * Cart totals. Pure and side-effect free, so the boundary rules — especially
 * the exact free-delivery threshold — can be unit tested.
 */
export function calcTotals(lines: CartLine[]): CartTotals {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );

  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  // An empty cart owes nothing, not the delivery fee.
  const qualifiesForFreeDelivery =
    subtotal > 0 && subtotal >= FREE_DELIVERY_THRESHOLD;

  const deliveryFee =
    subtotal === 0 || qualifiesForFreeDelivery ? 0 : DELIVERY_FEE;

  return {
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    itemCount,
    freeDeliveryRemaining: qualifiesForFreeDelivery
      ? 0
      : Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal),
    qualifiesForFreeDelivery,
  };
}
