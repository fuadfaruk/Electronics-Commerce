"use client";

import { createContext, useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import { cartStorageKey, confirmedCart, dedupeLines, emptyCart, LEGACY_CART_KEY, MAX_CART_LINES, MAX_QUANTITY, parseStoredCart, type StoredCart } from "@/lib/cart/storage";
import { calcTotals } from "@/lib/cart/totals";
import { withStorageLock } from "@/lib/storage-lock";
import type { QuoteDto, QuoteItem, StorefrontMode } from "@/types/api";
import type { CartLine, CartTotals, Product } from "@/types/domain";

export interface CartContextValue {
  lines: CartLine[];
  totals: CartTotals;
  itemCount: number;
  hydrated: boolean;
  isOpen: boolean;
  source: StorefrontMode;
  notice: string | null;
  addProduct: (product: Product, quantity?: number) => Promise<void>;
  removeLine: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  reconcileQuote: (quote: QuoteDto) => void;
  confirmPurchase: (orderId: string, purchased: QuoteItem[]) => Promise<void>;
  dismissNotice: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children, source }: { children: React.ReactNode; source: StorefrontMode }) {
  const [cart, setCart] = useState(() => emptyCart(source));
  const current = useRef(cart);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const storageAvailable = useRef(true);
  const key = cartStorageKey(source);

  const accept = (next: StoredCart) => { current.current = next; setCart(next); };
  const restore = useEffectEvent(() => {
    if (!storageAvailable.current) { setHydrated(true); return; }
    try {
      const legacy = window.localStorage.getItem(LEGACY_CART_KEY);
      if (legacy !== null) {
        window.localStorage.removeItem(LEGACY_CART_KEY);
        setNotice("The old cart could not be safely restored. Please add its items again; no order was placed.");
      }
      const result = parseStoredCart(window.localStorage.getItem(key), source);
      accept(result.cart);
      if (result.invalid) setNotice("Some saved cart data was invalid and has been removed. Review your items before checkout.");
      storageAvailable.current = true;
    } catch {
      storageAvailable.current = false;
      setNotice("Cart storage is unavailable. This tab still works, but its cart and checkout recovery may not survive a reload.");
    }
    setHydrated(true);
  });

  useEffect(() => {
    let active = true;
    // Browser storage hydration happens after the server snapshot, not during rendering.
    queueMicrotask(() => { if (active) restore(); });
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) restore();
    };
    window.addEventListener("storage", onStorage);
    return () => { active = false; window.removeEventListener("storage", onStorage); };
  }, [key, source]);

  const update = async (change: (freshest: StoredCart) => StoredCart) => {
    await withStorageLock(key, (shared) => {
      let freshest = current.current;
      if (!shared) {
        storageAvailable.current = false;
        setNotice("Cross-tab cart synchronization is unavailable. Changes stay in this tab only and will not survive a reload. New checkout is disabled; original attempts can still be resolved.");
      }
      if (storageAvailable.current) {
        try {
          const raw = window.localStorage.getItem(key);
          freshest = parseStoredCart(raw, source).cart;
        } catch {
          storageAvailable.current = false;
          setNotice("Cart storage is unavailable. Changes stay in this tab only. Keep it open until checkout is resolved.");
        }
      }
      const next = change(freshest);
      if (storageAvailable.current) {
        try { window.localStorage.setItem(key, JSON.stringify(next)); }
        catch {
          storageAvailable.current = false;
          setNotice("Cart storage is unavailable. Changes stay in this tab only. Keep it open until checkout is resolved.");
        }
      }
      accept(next);
    });
  };

  const addProduct = async (product: Product, quantity = 1) => {
    if (!product.saleEligible || product.stock <= 0 || !Number.isInteger(quantity) || quantity < 1) return;
    await update((fresh) => {
      const previous = fresh.lines.find((l) => l.productId === product.id);
      if (!previous && fresh.lines.length >= MAX_CART_LINES) {
        setNotice("The cart can hold up to 50 different products. Remove an item before adding another.");
        return fresh;
      }
      const incoming: CartLine = {
        productId: product.id, slug: product.slug, name: product.name, brand: product.brand,
        unitPrice: product.price, image: product.images[0] ?? "", stock: product.stock,
        quantity: Math.min(MAX_QUANTITY, product.stock, (previous?.quantity ?? 0) + quantity),
      };
      return { ...fresh, lines: dedupeLines([...fresh.lines.filter((l) => l.productId !== product.id), incoming]) };
    });
    setOpen(true);
  };
  const totals = calcTotals(cart.lines);
  return <CartContext.Provider value={{
    lines: cart.lines, totals, itemCount: totals.itemCount, hydrated, isOpen, source, notice, addProduct,
    removeLine: (id) => update((fresh) => ({ ...fresh, lines: fresh.lines.filter((l) => l.productId !== id) })),
    setQuantity: (id, quantity) => {
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) return;
      update((fresh) => ({ ...fresh, lines: fresh.lines.map((l) => l.productId === id ? { ...l, quantity } : l).filter((l) => l.quantity > 0) }));
    },
    clearCart: () => update((fresh) => ({ ...fresh, lines: [] })),
    openCart: () => setOpen(true), closeCart: () => setOpen(false), dismissNotice: () => setNotice(null),
    reconcileQuote: (quote) => update((fresh) => ({
      ...fresh,
      lines: fresh.lines.map((line) => {
        const authoritative = quote.lines.find((l) => l.productId === line.productId);
        return authoritative ? {
          ...line, name: authoritative.name, slug: authoritative.slug,
          unitPrice: authoritative.unitPrice, stock: authoritative.availableStock,
        } : line;
      }),
    })),
    confirmPurchase: (orderId, purchased) => update((fresh) => confirmedCart(fresh, orderId, purchased)),
  }}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside a CartProvider.");
  return context;
}
