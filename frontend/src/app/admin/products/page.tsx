import Link from "next/link";
import { pageNumber } from "@/components/admin/forms";
import { AdminAccessNotice, ReloadAdmin } from "@/components/admin/notices";
import { adminGet } from "@/components/admin/server";
import { AdminHeading, AdminPagination, EmptyAdminList, VersionBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCatalogPage } from "@/lib/api/decoders";
import { formatBDT } from "@/lib/money";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; q?: string | string[] }> }) {
  const params = await searchParams;
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim().slice(0, 200) ?? "";
  const page = pageNumber(params.page);
  const query = new URLSearchParams({ page: String(page), pageSize: "12" });
  if (q) query.set("q", q);
  const result = await adminGet("Admin/products", parseCatalogPage, query);
  if (!result.ok) return <AdminAccessNotice failure={result} returnTo="/admin/products" />;
  const data = result.data;
  return (
    <div className="space-y-6">
      <AdminHeading title="Products & stock" description="Edit product details, receive inventory and archive listings. Stock is adjusted separately and is never replaced by a metadata save." action={<Link prefetch={false} href="/admin/products/new" className={buttonStyles()}>New product</Link>} />
      <form action="/admin/products" method="get" className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1 basis-48 space-y-1.5"><label htmlFor="admin-product-search" className="text-sm font-medium">Search products (including archived)</label><Input id="admin-product-search" name="q" type="search" maxLength={200} defaultValue={q} placeholder="Product name, brand or slug" /></div><Button type="submit" variant="secondary">Search</Button>{q ? <Link prefetch={false} href="/admin/products" className={buttonStyles({ variant: "ghost" })}>Clear</Link> : null}</form>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{data.totalCount} products{q ? " matching your search" : ", including archived records"}</p><ReloadAdmin label="Refresh products" /></div>
      {data.items.length ? <ul className="grid gap-3 sm:grid-cols-2">
        {data.items.map((product) => <li key={product.id} className="acrylic-module flex min-w-0 flex-col gap-4 p-4">
          <div className="space-y-2"><div className="flex flex-wrap gap-2"><Badge tone={product.isArchived ? "neutral" : product.saleEligible ? "success" : "warning"}>{product.isArchived ? "Archived" : product.saleEligible ? "Sale eligible" : "Unavailable for sale"}</Badge>{product.featured ? <Badge tone="brand">Featured</Badge> : null}<VersionBadge version={product.version} /></div><p className="mod-code break-words">{product.brand || "Unbranded"} / {product.categoryName}</p><h2 className="text-lg font-semibold break-words">{product.name}</h2><p className="font-mono text-xs break-all text-muted-foreground">/{product.slug}</p></div>
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3"><div className="space-y-1"><p className="text-lg font-bold">{formatBDT(product.price)}</p>{product.compareAtPrice !== null ? <p className="text-xs text-muted-foreground">Compare {formatBDT(product.compareAtPrice)}</p> : null}</div><p className={`text-sm font-medium ${product.stock === 0 ? "text-warning" : "text-foreground"}`}>{product.stock} available units</p></div>
          <Link prefetch={false} href={`/admin/products/${product.id}`} className={buttonStyles({ variant: "secondary", className: "mt-auto" })}>Edit details & adjust stock</Link>
        </li>)}
      </ul> : <EmptyAdminList title={q ? "No matching products" : "No products on this page"} description={q ? "Try a different name or brand, or clear the search." : "Add your first product or return to an earlier page."} />}
      <AdminPagination path="/admin/products" page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} query={q ? { q } : {}} />
    </div>
  );
}
