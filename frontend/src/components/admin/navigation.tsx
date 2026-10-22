"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldIcon } from "@/components/ui/icons";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/products", label: "Products & stock" },
  { href: "/admin/orders", label: "Orders" },
];

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <div className="space-y-3 border-b border-border pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><ShieldIcon className="size-5 text-brand-strong" />Staff workspace</p>
        <span className="app-subtitle">ElectroMart operations</span>
      </div>
      <nav aria-label="Staff navigation" className="flex flex-wrap gap-2">
        {links.map((link) => {
          const active = link.href === "/admin" ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link key={link.href} prefetch={false} href={link.href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-medium transition-colors sm:px-4 ${active ? "border-brand/30 bg-brand-soft text-brand-strong" : "border-border bg-white/70 text-muted-foreground hover:bg-white hover:text-foreground"}`}>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
