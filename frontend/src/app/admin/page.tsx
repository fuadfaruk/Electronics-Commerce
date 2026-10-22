import Link from "next/link";
import { AdminAccessNotice } from "@/components/admin/notices";
import { adminGet } from "@/components/admin/server";
import { AdminHeading, AdminPanel } from "@/components/admin/ui";
import { buttonStyles } from "@/components/ui/button";
import { GridIcon, ShieldIcon, SlidersIcon, TruckIcon } from "@/components/ui/icons";
import { parseCategories, parseCatalogPage, parsePagedOrders } from "@/lib/api/decoders";

export default async function AdminOverviewPage() {
  const [categories, products, pendingOrders] = await Promise.all([
    adminGet("Admin/categories", parseCategories),
    adminGet("Admin/products", parseCatalogPage, new URLSearchParams({ page: "1", pageSize: "1" })),
    adminGet("Admin/orders", parsePagedOrders, new URLSearchParams({ page: "1", pageSize: "1", status: "Pending" })),
  ]);
  if (!categories.ok) return <AdminAccessNotice failure={categories} />;
  if (!products.ok) return <AdminAccessNotice failure={products} />;
  if (!pendingOrders.ok) return <AdminAccessNotice failure={pendingOrders} />;
  return (
    <div className="space-y-6">
      <AdminHeading title="Store operations" description={`Signed in as ${categories.account.name}. Manage the live catalog and COD orders with version-checked, auditable commands.`} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/admin/categories" prefetch={false} className="acrylic-module space-y-3 p-4"><GridIcon className="size-6 text-brand-strong" /><p className="text-3xl font-bold">{categories.data.length}</p><h2 className="text-sm font-semibold">Categories</h2><p className="text-xs text-muted-foreground">{categories.data.filter((category) => category.isArchived).length} archived, references preserved</p></Link>
        <Link href="/admin/products" prefetch={false} className="acrylic-module space-y-3 p-4"><SlidersIcon className="size-6 text-brand-strong" /><p className="text-3xl font-bold">{products.data.totalCount}</p><h2 className="text-sm font-semibold">Product records</h2><p className="text-xs text-muted-foreground">Including archived inventory</p></Link>
        <Link href="/admin/orders?status=Pending" prefetch={false} className="acrylic-module space-y-3 p-4"><TruckIcon className="size-6 text-brand-strong" /><p className="text-3xl font-bold">{pendingOrders.data.totalCount}</p><h2 className="text-sm font-semibold">Pending orders</h2><p className="text-xs text-muted-foreground">Review acceptance snapshots and confirm</p></Link>
      </div>
      <AdminPanel title="Daily workflow">
        <ol className="space-y-4 text-sm leading-relaxed"><li><strong>1. Prepare the catalog.</strong> Create active categories, then products with permanent slugs, ordered HTTPS images and whole-BDT pricing.</li><li><strong>2. Receive inventory.</strong> Use a stock delta with a reason. Metadata edits never replace absolute stock or undo checkout changes.</li><li><strong>3. Fulfill accepted orders.</strong> Review the immutable contact, money and line snapshots, then advance Pending to Confirmed to Shipped to Delivered.</li><li><strong>4. Record cash received.</strong> Mark the full customer payment Collected only after delivery. Delivery alone does not mean cash collection.</li></ol>
        <div className="flex flex-wrap gap-2"><Link prefetch={false} href="/admin/orders" className={buttonStyles()}>Review orders</Link><Link prefetch={false} href="/admin/products/new" className={buttonStyles({ variant: "secondary" })}>Add product</Link></div>
      </AdminPanel>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-4"><ShieldIcon className="mt-0.5 size-5 shrink-0 text-brand-strong" /><p className="text-sm leading-relaxed text-muted-foreground">Staff access is checked by the API on every protected read and mutation. If a record changes, reload its version before acting. Staff provisioning and roles are operator-only and are not managed here.</p></div>
    </div>
  );
}
