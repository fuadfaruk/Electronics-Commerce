import { MinusIcon, PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * Quantity control, capped at available stock so the cart can never hold more
 * units than the catalog says exist.
 */
export function QuantityStepper({
  value,
  stock,
  onChange,
  label = "Quantity",
  className,
}: {
  value: number;
  stock: number;
  onChange: (next: number) => void;
  label?: string;
  className?: string;
}) {
  const canDecrease = value > 1;
  const canIncrease = value < stock;

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-xl border border-border-strong bg-surface",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={!canDecrease}
        aria-label={`Decrease ${label.toLowerCase()}`}
        className="flex size-11 items-center justify-center rounded-l-xl text-foreground hover:bg-surface-muted disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <MinusIcon className="size-4" />
      </button>

      <span
        aria-live="polite"
        className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums"
      >
        <span className="sr-only">{label}: </span>
        {value}
      </span>

      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={!canIncrease}
        aria-label={`Increase ${label.toLowerCase()}`}
        className="flex size-11 items-center justify-center rounded-r-xl text-foreground hover:bg-surface-muted disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
