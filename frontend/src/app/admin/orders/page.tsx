import Link from "next/link";
import { FULFILLMENT_STATUSES, pageNumber } from "@/components/admin/forms";
import { AdminAccessNotice, ReloadAdmin } from "@/components/admin/notices";
import { adminGet } from "@/components/admin/server";
import { AdminDate, AdminHeading, AdminPagination, EmptyAdminList, OrderBadges, VersionBadge } from "@/components/admin/ui";
import { Button, buttonStyles } from "@/components/ui/button";
import { inputStyles } from "@/components/ui/input";
import { parsePagedOrders } from "@/lib/api/decoders";
import { formatBDT } from "@/lib/money";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; status?: string | string[] }> }) {
  const params = await searchParams;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = FULFILLMENT_STATUSES.find((item) => item === rawStatus) ?? "";
  const query = new URLSearchParams({ page: String(pageNumber(params.page)), pageSize: "12" });
  if (status) query.set("status", status);
  const result = await adminGet("Admin/orders", parsePagedOrders, query);
  if (!result.ok) return <AdminAccessNotice failure={result} returnTo="/admin/orders" />;
  const data = result.data;
  return (
    <div className="space-y-6">
      <AdminHeading title="Orders" description="Review immutable order snapshots, progress fulfillment and record customer cash after delivery. Payment and fulfillment are independent." />
      <form action="/admin/orders" method="get" className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1 basis-48 space-y-1.5"><label htmlFor="admin-order-status" className="text-sm font-medium">Fulfillment status</label><select id="admin-order-status" name="status" defaultValue={status} className={inputStyles}><option value="">All fulfillment statuses</option>{FULFILLMENT_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><Button type="submit" variant="secondary">Apply filter</Button><ReloadAdmin label="Refresh orders" /></form>
      {data.items.length ? <ul className="space-y-3">
        {data.items.map((order) => <li key={order.id} className="acrylic-module min-w-0 space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1"><h2 className="text-lg font-semibold break-words">Order {order.number}</h2><p className="text-xs text-muted-foreground"><AdminDate value={order.createdAt} /></p></div><p className="text-lg font-bold">{formatBDT(order.total)}</p></div>
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><OrderBadges fulfillment={order.fulfillment} payment={order.payment} /><VersionBadge version={order.version} /></div><Link prefetch={false} href={`/admin/orders/${order.id}`} className={buttonStyles({ variant: "secondary" })}>Open order & actions</Link></div>
        </li>)}
      </ul> : <EmptyAdminList title="No orders on this page" description={status ? "No orders currently match this fulfillment status. Choose another status or view all orders." : "Accepted orders will appear here for staff fulfillment."} />}
      <AdminPagination path="/admin/orders" page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} query={status ? { status } : {}} />
    </div>
  );
}
