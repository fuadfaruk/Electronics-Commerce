import type { ProductSpec } from "@/types/domain";

/**
 * Specifications as a definition list, which is what they are. Stacked on
 * phones, two columns from `sm` up.
 */
export function SpecTable({ specs }: { specs: ProductSpec[] }) {
  if (!specs.length) return null;

  return (
    <dl className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {specs.map((spec) => (
        <div
          key={spec.label}
          className="grid grid-cols-1 gap-0.5 px-4 py-3 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-4"
        >
          <dt className="text-sm text-muted-foreground">{spec.label}</dt>
          <dd className="text-sm">{spec.value}</dd>
        </div>
      ))}
    </dl>
  );
}
