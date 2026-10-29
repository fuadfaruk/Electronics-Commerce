import Link from "next/link";
import { formatBDT } from "@/lib/money";
import type { OrderDto } from "@/types/api";

export function orderDate(value: string): string {
  return new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(value));
}

export function OrderReceipt({ order }: { order: OrderDto }) {
  return <article className="space-y-6">
    <header className="space-y-2"><p className="bench-strip">Private order receipt</p><h1 className="text-2xl font-semibold">Order {order.number}</h1><p className="text-sm text-muted-foreground">Placed {orderDate(order.createdAt)}</p>
      {order.fulfillment === "Pending" && order.payment === "Unpaid" ? <p className="text-sm">Order received. We will contact you to confirm the order and payment.</p> : null}
      <dl className="flex flex-wrap gap-4 text-sm"><div className="rounded-xl border bg-brand-soft px-3 py-2"><dt className="text-xs text-muted-foreground">Fulfillment</dt><dd className="font-semibold">{order.fulfillment}</dd></div><div className="rounded-xl border bg-surface px-3 py-2"><dt className="text-xs text-muted-foreground">Payment</dt><dd className="font-semibold">{order.payment}</dd></div></dl>
    </header>
    <section className="space-y-3"><h2 className="font-semibold">Accepted items and amounts</h2><ul className="divide-y rounded-2xl border bg-surface px-4">{order.lines.map((l) => <li key={l.productId} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><Link href={`/products/${l.slug}`} className="font-medium hover:text-brand">{l.name}</Link><p className="text-xs text-muted-foreground">{l.quantity} x {formatBDT(l.unitPrice)}</p></div><p className="font-semibold">{formatBDT(l.lineTotal)}</p></li>)}</ul>
      <dl className="ml-auto max-w-sm space-y-2 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBDT(order.money.subtotal)}</dd></div><div className="flex justify-between"><dt>Delivery</dt><dd>{formatBDT(order.money.delivery)}</dd></div><div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Order total</dt><dd>{formatBDT(order.money.total)}</dd></div></dl><p className="text-xs text-muted-foreground">These are immutable accepted amounts, not current catalog prices. Prices include VAT.</p>
    </section>
    <div className="grid gap-4 sm:grid-cols-2"><section className="space-y-2 rounded-2xl border p-4"><h2 className="font-semibold">Contact</h2><p className="text-sm">{order.contact.name}</p><p className="break-all text-sm">{order.contact.email}</p><p className="text-sm">{order.contact.phone}</p></section><section className="space-y-2 rounded-2xl border p-4"><h2 className="font-semibold">Delivery address</h2><p className="text-sm">{order.deliveryAddress.street}<br />{order.deliveryAddress.area}<br />{order.deliveryAddress.city}, {order.deliveryAddress.district}{order.deliveryAddress.postcode ? ` ${order.deliveryAddress.postcode}` : ""}</p></section></div>
    {order.notes ? <section className="space-y-2"><h2 className="font-semibold">Delivery notes</h2><p className="whitespace-pre-wrap text-sm">{order.notes}</p></section> : null}
    <section className="space-y-3"><h2 className="font-semibold">Order updates</h2><ol className="space-y-3 border-l-2 pl-4">{order.events.map((event, index) => <li key={`${event.version}-${index}`} className="space-y-1 text-sm"><p className="font-medium">{event.action}</p><p className="text-xs text-muted-foreground">{orderDate(event.createdAt)}</p>{event.note ? <p className="whitespace-pre-wrap">{event.note}</p> : null}</li>)}</ol></section>
  </article>;
}
