"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import { calcTotals } from "@/lib/cart/totals";
import type { CartLine, CartTotals, Product } from "@/types/domain";

/**
 * Cart state.
 *
 * There is no cart endpoint on the backend, so the cart lives in the browser
 * and is persisted to localStorage. Plain context + reducer keeps the
 * dependency list at zero; a store library would buy nothing at this size.
 */

export const CART_STORAGE_KEY = "electro.cart.v1";

interface CartState {
  lines: CartLine[];
  isOpen: boolean;
  /** False until localStorage has been read, so the UI can avoid a flash. */
  hydrated: boolean;
}

type CartAction =
  | { type: "hydrate"; lines: CartLine[] }
  | { type: "add"; line: CartLine }
  | { type: "remove"; productId: string }
  | { type: "setQuantity"; productId: string; quantity: number }
  | { type: "clear" }
  | { type: "open" }
  | { type: "close" };

const initialState: CartState = { lines: [], isOpen: false, hydrated: false };

/** Quantity is capped by available stock, never below one unit. */
function clampQuantity(quantity: number, stock: number): number {
  if (stock <= 0) return 0;
  return Math.max(1, Math.min(quantity, stock));
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "hydrate":
      return { ...state, lines: action.lines, hydrated: true };

    case "add": {
      const incoming = action.line;
      const existing = state.lines.find(
        (line) => line.productId === incoming.productId,
      );

      if (!existing) {
        const quantity = clampQuantity(incoming.quantity, incoming.stock);
        if (quantity === 0) return state;
        return { ...state, lines: [...state.lines, { ...incoming, quantity }] };
      }

      const quantity = clampQuantity(
        existing.quantity + incoming.quantity,
        incoming.stock,
      );
      if (quantity === 0) return state;

      return {
        ...state,
        lines: state.lines.map((line) =>
          line.productId === incoming.productId
            ? // Refresh the snapshot fields in case the catalog moved on.
              { ...line, ...incoming, quantity }
            : line,
        ),
      };
    }

    case "remove":
      return {
        ...state,
        lines: state.lines.filter(
          (line) => line.productId !== action.productId,
        ),
      };

    case "setQuantity": {
      const target = state.lines.find(
        (line) => line.productId === action.productId,
      );
      if (!target) return state;

      // Dropping to zero removes the line, which is what a stepper bound feels
      // like it should do.
      if (action.quantity <= 0) {
        return {
          ...state,
          lines: state.lines.filter(
            (line) => line.productId !== action.productId,
          ),
        };
      }

      const quantity = clampQuantity(action.quantity, target.stock);
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.productId === action.productId ? { ...line, quantity } : line,
        ),
      };
    }

    case "clear":
      return { ...state, lines: [] };

    case "open":
      return { ...state, isOpen: true };

    case "close":
      return { ...state, isOpen: false };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.productId === "string" &&
    typeof line.slug === "string" &&
    typeof line.name === "string" &&
    typeof line.brand === "string" &&
    typeof line.unitPrice === "number" &&
    typeof line.image === "string" &&
    typeof line.quantity === "number" &&
    typeof line.stock === "number" &&
    line.quantity > 0
  );
}

/** Corrupt or hand-edited storage must never crash the app. */
function readStoredCart(): CartLine[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCartLine);
  } catch {
    return [];
  }
}

function writeStoredCart(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Private browsing and full quotas both land here. The in-memory cart
    // still works, so this is not worth interrupting the shopper for.
  }
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export interface CartContextValue {
  lines: CartLine[];
  totals: CartTotals;
  itemCount: number;
  /** False on the very first render, before storage has been read. */
  hydrated: boolean;
  isOpen: boolean;
  /** Adds a product, capped at its stock, and opens the drawer. */
  addProduct: (product: Product, quantity?: number) => void;
  removeLine: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialState);
  const { hydrated, lines, isOpen } = state;

  // Read storage once, after mount, so the server and first client render agree.
  useEffect(() => {
    dispatch({ type: "hydrate", lines: readStoredCart() });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStoredCart(lines);
  }, [hydrated, lines]);

  // Keep two open tabs in step.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CART_STORAGE_KEY) return;
      dispatch({ type: "hydrate", lines: readStoredCart() });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addProduct = useCallback((product: Product, quantity = 1) => {
    dispatch({
      type: "add",
      line: {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        unitPrice: product.price,
        image: product.images[0] ?? "",
        quantity,
        stock: product.stock,
      },
    });
    dispatch({ type: "open" });
  }, []);

  const removeLine = useCallback((productId: string) => {
    dispatch({ type: "remove", productId });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    dispatch({ type: "setQuantity", productId, quantity });
  }, []);

  const clearCart = useCallback(() => dispatch({ type: "clear" }), []);
  const openCart = useCallback(() => dispatch({ type: "open" }), []);
  const closeCart = useCallback(() => dispatch({ type: "close" }), []);

  const totals = useMemo(() => calcTotals(lines), [lines]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      totals,
      itemCount: totals.itemCount,
      hydrated,
      isOpen,
      addProduct,
      removeLine,
      setQuantity,
      clearCart,
      openCart,
      closeCart,
    }),
    [
      lines,
      totals,
      hydrated,
      isOpen,
      addProduct,
      removeLine,
      setQuantity,
      clearCart,
      openCart,
      closeCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside a <CartProvider>.");
  }
  return context;
}
