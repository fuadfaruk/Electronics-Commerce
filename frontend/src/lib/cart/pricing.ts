/**
 * Delivery pricing.
 *
 * Prices across the store are VAT-inclusive, so a cart total is simply the
 * line-item sum plus one delivery fee. There is no checkout yet; these
 * constants exist so the cart drawer can show an honest total today, and so a
 * future checkout has a single place to read from.
 *
 * Flat rate rather than zone-based, because without an address step there is
 * nothing to key a zone on.
 */
export const DELIVERY_FEE = 80;

/** Spend this much (before delivery) and delivery is free. */
export const FREE_DELIVERY_THRESHOLD = 5000;
