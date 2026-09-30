import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

/** Shown when filters or a search term match nothing. */
export function EmptyState({
  title,
  message,
  actionHref,
  actionLabel,
}: {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className={buttonStyles({ variant: "secondary" })}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
