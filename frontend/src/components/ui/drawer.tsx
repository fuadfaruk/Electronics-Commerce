"use client";

import { useEffect, useId, useRef } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * Accessible slide-over panel.
 *
 * Handles the things a drawer has to get right on a phone: it locks the page
 * behind it, closes on Escape and on backdrop tap, keeps Tab inside the panel,
 * and hands focus back to whatever opened it.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional small line under the title, e.g. an item count. */
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.offsetParent !== null,
      );

    // Prefer the close button so screen readers announce the dialog title first.
    const initial = focusables()[0] ?? panel;
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel?.contains(active) ?? false;

      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const restoreTo = previouslyFocused.current;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("scroll-locked");
    return () => document.body.classList.remove("scroll-locked");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="drawer-backdrop absolute inset-0 bg-black/40"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "drawer-panel relative flex h-full w-full flex-col bg-surface shadow-xl outline-none",
          "sm:max-w-md",
          className,
        )}
      >
        <header className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <CloseIcon className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>

        {footer ? (
          <div className="border-t border-border bg-surface px-4 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
