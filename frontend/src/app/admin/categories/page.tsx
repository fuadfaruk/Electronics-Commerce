import Link from "next/link";
import { AdminAccessNotice, ReloadAdmin } from "@/components/admin/notices";
import { adminGet } from "@/components/admin/server";
import { AdminHeading, EmptyAdminList, VersionBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { parseCategories } from "@/lib/api/decoders";

export default async function AdminCategoriesPage() {
  const result = await adminGet("Admin/categories", parseCategories);
  if (!result.ok) return <AdminAccessNotice failure={result} returnTo="/admin/categories" />;
  const categories = [...result.data].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return (
    <div className="space-y-6">
      <AdminHeading title="Categories" description="Manage navigation and taxonomy. Archived categories remain visible to staff and keep their product references." action={<Link prefetch={false} href="/admin/categories/new" className={buttonStyles()}>New category</Link>} />
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{categories.length} categories, including {categories.filter((category) => category.isArchived).length} archived</p><ReloadAdmin label="Refresh categories" /></div>
      {categories.length ? <ul className="grid gap-3 sm:grid-cols-2">
        {categories.map((category) => <li key={category.id} className="acrylic-module flex min-w-0 flex-col gap-4 p-4">
          <div className="space-y-2"><div className="flex flex-wrap gap-2"><Badge tone={category.isArchived ? "neutral" : "success"}>{category.isArchived ? "Archived" : "Active"}</Badge><VersionBadge version={category.version} /></div><h2 className="text-lg font-semibold break-words">{category.name}</h2><p className="font-mono text-xs break-all text-muted-foreground">/{category.slug}</p><p className="text-sm leading-relaxed text-muted-foreground">{category.description || "No description provided."}</p></div>
          <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm"><div><dt className="text-xs text-muted-foreground">Products</dt><dd className="mt-1 font-semibold">{category.productCount}</dd></div><div><dt className="text-xs text-muted-foreground">Sort order</dt><dd className="mt-1 font-semibold">{category.sortOrder}</dd></div><div className="min-w-0"><dt className="text-xs text-muted-foreground">Visual</dt><dd className="mt-1 break-words">{category.visualKey}</dd></div></dl>
          <Link prefetch={false} href={`/admin/categories/${category.id}`} className={buttonStyles({ variant: "secondary", className: "mt-auto" })}>Edit & manage category</Link>
        </li>)}
      </ul> : <EmptyAdminList title="No categories yet" description="Create an active category before adding products." />}
    </div>
  );
}
