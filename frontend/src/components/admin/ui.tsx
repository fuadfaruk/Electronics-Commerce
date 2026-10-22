import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";

export const textareaStyles = "min-h-28 w-full rounded-xl border border-border-strong bg-white/90 px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground/80 focus:border-brand disabled:opacity-50";

export function AdminHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function AdminPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="acrylic-module min-w-0 space-y-4 p-4 sm:p-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function VersionBadge({ version }: { version: number }) {
  return <Badge className="font-mono">Version {version}</Badge>;
}

export function OrderBadges({ fulfillment, payment }: { fulfillment: string; payment: string }) {
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Badge tone={fulfillment === "Cancelled" ? "danger" : fulfillment === "Delivered" ? "success" : "brand"}>{fulfillment}</Badge>
      <Badge tone={payment === "Collected" ? "success" : "warning"}>{payment === "Collected" ? "Cash collected" : "Cash unpaid"}</Badge>
    </span>
  );
}

export function EmptyAdminList({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong p-6 text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function AdminPagination({ path, page, pageSize, totalCount, query = {} }: { path: string; page: number; pageSize: number; totalCount: number; query?: Record<string, string> }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  function href(next: number) {
    const params = new URLSearchParams(query);
    params.set("page", String(next));
    return `${path}?${params.toString()}`;
  }
  return (
    <nav aria-label="List pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">Page {page} of {totalPages} <span className="whitespace-nowrap">({totalCount} records)</span></p>
      <div className="flex gap-2">
        {page > 1 ? <Link prefetch={false} href={href(page - 1)} className={buttonStyles({ variant: "secondary" })}>Previous</Link> : null}
        {page < totalPages ? <Link prefetch={false} href={href(page + 1)} className={buttonStyles({ variant: "secondary" })}>Next</Link> : null}
      </div>
    </nav>
  );
}

export function AdminDate({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value}>{new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(date)} Dhaka time</time>;
}
