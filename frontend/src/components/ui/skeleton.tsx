import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-xl bg-surface-muted", className)}
      aria-hidden="true"
    />
  );
}
