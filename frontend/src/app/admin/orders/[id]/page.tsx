import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminAccessNotice, ReloadAdmin } from "@/components/admin/notices";
import { OrderActions } from "@/components/admin/order-actions";
import { OrderSnapshot } from "@/components/admin/order-snapshot";
import { adminGet } from "@/components/admin/server";
import { AdminDate, AdminHeading, OrderBadges, VersionBadge } from "@/components/admin/ui";
import { buttonStyles } from "@/components/ui/button";
import { parseOrder } from "@/lib/api/decoders";

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await adminGet(`Admin/orders/${encodeURIComponent(id)}`, parseOrder);
  if (!result.ok) {
    if (result.problem?.status === 404) notFound();
    return <AdminAccessNotice failure={result} returnTo={`/admin/orders/${id}`} />;
  }
  const order = result.data;
  return (
    <div className="min-w-0 space-y-6" key={`${order.id}:${order.version}`}>
      <AdminHeading title={`Order ${order.number}`} description="Immutable acceptance details and versioned staff actions. Customers cannot edit or cancel an order themselves." action={<Link prefetch={false} href="/admin/orders" className={buttonStyles({ variant: "secondary" })}>Back to orders</Link>} />
      <div className="min-w-0 space-y-3 rounded-xl border border-border bg-white/60 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><OrderBadges fulfillment={order.fulfillment} payment={order.payment} /><VersionBadge version={order.version} /></div><ReloadAdmin label="Reload current order" /></div><p className="text-sm text-muted-foreground">Accepted <AdminDate value={order.createdAt} /></p><p className="font-mono text-xs break-all text-muted-foreground">Order ID: {order.id}</p></div>
      <OrderActions order={order} staffId={result.account.id} />
      <OrderSnapshot order={order} />
    </div>
  );
}
