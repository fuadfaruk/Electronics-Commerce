"use client";

import { useEffect, useEffectEvent, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const stack: HTMLElement[] = [];
const originals = new Map<HTMLElement, boolean>();
let initiallyLocked = false;

function updateInert() {
  const top = stack.at(-1);
  if (top) {
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (!originals.has(child)) originals.set(child, child.inert);
      child.inert = child !== top;
    }
  } else {
    for (const [child, inert] of originals) child.inert = inert;
    originals.clear();
    if (!initiallyLocked) document.body.classList.remove("scroll-locked");
  }
}

const subscribe = () => () => {};
const portalBody = () => document.body;
const serverBody = () => null;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, title, description, children, footer, className }: DrawerProps) {
  const body = useSyncExternalStore(subscribe, portalBody, serverBody);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open || !body || !rootRef.current || !panelRef.current) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!stack.length) initiallyLocked = document.body.classList.contains("scroll-locked");
    stack.push(root);
    document.body.classList.add("scroll-locked");
    updateInert();
    const observer = new MutationObserver(updateInert);
    observer.observe(document.body, { childList: true });
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) =>
      !el.closest('[inert], [hidden], [aria-hidden="true"], fieldset[disabled]') &&
      getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden",
    );
    (focusables()[0] ?? panel).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== root) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0] ?? panel;
      const last = items.at(-1) ?? panel;
      const active = document.activeElement;
      if (!items.length || (event.shiftKey && (!panel.contains(active) || active === first)) ||
        (!event.shiftKey && (!panel.contains(active) || active === last))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (stack.at(-1) === root && !panel.contains(event.target as Node)) (focusables()[0] ?? panel).focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
      stack.splice(stack.indexOf(root), 1);
      updateInert();
      if (restoreTo?.isConnected && !restoreTo.closest("[inert]")) restoreTo.focus();
    };
  }, [open, body]);

  if (!open || !body) return null;
  return createPortal(<div ref={rootRef} className="fixed inset-0 z-[70] flex justify-end">
    <button type="button" tabIndex={-1} aria-label="Close panel" onClick={onClose}
      className="drawer-backdrop absolute inset-0 bg-[#0b2130]/45 backdrop-blur-sm" />
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined} tabIndex={-1}
      className={cn("drawer-panel relative flex h-dvh w-full flex-col bg-white/95 shadow-2xl outline-none sm:max-w-md", className)}>
      <header className="flex items-start gap-3 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          {description ? <p id={descriptionId} className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-muted"><CloseIcon className="size-5" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{children}</div>
      {footer ? <div className="border-t bg-white/80 px-4 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
    </div>
  </div>, body);
}
