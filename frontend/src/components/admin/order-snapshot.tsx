import { formatBDT } from "@/lib/money";
import type { OrderDto } from "@/types/api";
import { AdminDate, AdminPanel } from "./ui";

export function OrderSnapshot({ order }: { order: OrderDto }) {
  return (
    <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <AdminPanel title="Contact snapshot" description="Captured when this order was accepted. Account or catalog changes do not alter these details.">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-muted-foreground">Recipient</dt><dd className="mt-1 font-medium break-words">{order.contact.name}</dd></div>
            <div><dt className="text-muted-foreground">Email</dt><dd className="mt-1 break-all">{order.contact.email}</dd></div>
            <div><dt className="text-muted-foreground">Phone</dt><dd className="mt-1 font-mono break-words">{order.contact.phone}</dd></div>
          </dl>
        </AdminPanel>
        <AdminPanel title="Delivery address snapshot">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-muted-foreground">Street / building</dt><dd className="mt-1 break-words">{order.deliveryAddress.street}</dd></div>
            <div><dt className="text-muted-foreground">Area</dt><dd className="mt-1 break-words">{order.deliveryAddress.area}</dd></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><dt className="text-muted-foreground">City</dt><dd className="mt-1 break-words">{order.deliveryAddress.city}</dd></div><div><dt className="text-muted-foreground">District</dt><dd className="mt-1 break-words">{order.deliveryAddress.district}</dd></div></div>
            <div><dt className="text-muted-foreground">Postcode</dt><dd className="mt-1">{order.deliveryAddress.postcode || "Not provided"}</dd></div>
          </dl>
        </AdminPanel>
      </div>
      <AdminPanel title="Accepted order lines" description="Immutable product names, slugs, quantities and prices. These are not replaced by today's catalog details.">
        <ul className="space-y-3">
          {order.lines.map((line, index) => (
            <li key={`${line.productId}:${index}`} className="min-w-0 rounded-xl border border-border bg-white/70 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1"><h3 className="font-semibold break-words">{line.name}</h3><p className="font-mono text-xs break-all text-muted-foreground">/{line.slug}</p></div><p className="font-bold">{formatBDT(line.lineTotal)}</p></div>
              <dl className="mt-3 grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Accepted quantity / unit price</dt><dd className="mt-1">{line.quantity} units at {formatBDT(line.unitPrice)} each</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Product reference</dt><dd className="mt-1 font-mono text-xs break-all">{line.productId}</dd></div></dl>
            </li>
          ))}
        </ul>
      </AdminPanel>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <AdminPanel title="Money snapshot" description="The accepted amount is authoritative. It is never recalculated from the current catalog or delivery policy.">
          <dl className="space-y-3 text-sm"><div className="flex justify-between gap-3"><dt>Merchandise subtotal</dt><dd className="font-medium">{formatBDT(order.money.subtotal)}</dd></div><div className="flex justify-between gap-3"><dt>Delivery</dt><dd className="font-medium">{formatBDT(order.money.delivery)}</dd></div><div className="flex justify-between gap-3 border-t border-border pt-3 text-base"><dt className="font-semibold">Accepted total</dt><dd className="font-bold">{formatBDT(order.money.total)}</dd></div><div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2"><div><dt className="text-muted-foreground">Currency</dt><dd className="mt-1 font-mono">{order.money.currency}</dd></div><div><dt className="text-muted-foreground">Policy version</dt><dd className="mt-1 font-mono break-words">{order.money.policyVersion}</dd></div></div></dl>
        </AdminPanel>
        <AdminPanel title="Customer delivery notes"><p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{order.notes || "No delivery notes were provided."}</p></AdminPanel>
      </div>
      <AdminPanel title="Audit events" description="Recorded action, actor, time, note and resulting version. Times below use Asia/Dhaka.">
        {order.events.length ? <ol className="space-y-3">{order.events.map((event, index) => <li key={`${event.version}:${event.action}:${index}`} className="min-w-0 space-y-3 rounded-xl border border-border bg-white/70 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold break-words">{event.action}</h3><span className="acrylic-tag">Version {event.version}</span></div>
          <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Recorded at</dt><dd className="mt-1"><AdminDate value={event.createdAt} /></dd></div><div className="min-w-0"><dt className="text-xs text-muted-foreground">Actor ID</dt><dd className="mt-1 font-mono text-xs break-all">{event.actorId || "System / guest (no staff actor)"}</dd></div></dl>
          <div className="border-t border-border pt-3"><p className="text-xs text-muted-foreground">Event note</p><p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap">{event.note || "No note recorded."}</p></div>
        </li>)}</ol> : <p className="text-sm text-muted-foreground">No audit events were returned for this order.</p>}
      </AdminPanel>
    </div>
  );
}
