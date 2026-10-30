import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountAccess } from "@/components/account/account-access";
import { ClaimRequest } from "@/components/account/claim-request";
import { orderDate } from "@/components/orders/order-receipt";
import { ErrorNotice } from "@/components/ui/error-notice";
import { getAccount } from "@/lib/account/server";
import { getStorefrontConfig } from "@/lib/api/config";
import { parsePagedOrders } from "@/lib/api/decoders";
import { getApiResult } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";
import { formatBDT } from "@/lib/money";

export const metadata = { title: "Order History" };
export default async function OrdersPage({ searchParams }: PageProps<"/account/orders">) {
  if (getStorefrontConfig().guestOnly) notFound();
  const account = await getAccount();
  if (!account || !account.ok) return <AccountAccess mock={!account} problem={account && !account.ok ? account.problem : undefined} next="/account/orders" />;
  if (!account.data.emailVerified) return <AccountAccess unverified />;
  const rawPage = (await searchParams).page;
  const page = typeof rawPage === "string" && /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1;
  const orders = await getApiResult(() => serverGet("Account/orders", parsePagedOrders, new URLSearchParams({ page: String(page), pageSize: "12" })));
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Your orders</h1>
    {!orders.ok ? <ErrorNotice problem={orders.problem} /> : <section className="space-y-4">
      {!orders.data.items.length ? <p className="text-sm text-muted-foreground">No orders on this page. Guest orders require an explicit email-proof claim.</p> : <ul className="space-y-3">{orders.data.items.map((o) => <li key={o.id}><Link href={`/account/orders/${o.id}`} prefetch={false} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface p-4"><div><p className="font-semibold">{o.number}</p><p className="text-xs text-muted-foreground">{orderDate(o.createdAt)}</p><p className="mt-1 text-sm">{o.fulfillment} / payment {o.payment}</p></div><p className="font-mono font-semibold">{formatBDT(o.total)}</p></Link></li>)}</ul>}
      <nav aria-label="Order history pages" className="flex justify-between text-sm font-medium text-brand">{page > 1 ? <Link href={`/account/orders?page=${page - 1}`} prefetch={false} className="inline-flex min-h-11 items-center">Previous page</Link> : <span />}{page * 12 < orders.data.totalCount ? <Link href={`/account/orders?page=${page + 1}`} prefetch={false} className="inline-flex min-h-11 items-center">Next page</Link> : null}</nav>
    </section>}
    <ClaimRequest account={account.data} mode="live" />
  </div>;
}
