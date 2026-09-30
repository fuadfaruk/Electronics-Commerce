import { cn } from "@/lib/cn";

/**
 * `text-base` (16px) is deliberate: anything smaller makes iOS Safari zoom the
 * whole page when the field is focused, which is jarring on a phone.
 */
export const inputStyles =
  "h-11 w-full rounded-xl border border-border-strong bg-surface px-3 text-base text-foreground placeholder:text-muted-foreground/80 focus:border-brand focus:outline-none focus-visible:outline-none disabled:opacity-50";

export function Input({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return <input className={cn(inputStyles, className)} {...props} />;
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
