"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputStyles } from "@/components/ui/input";
import { parseOrder } from "@/lib/api/decoders";
import { formatBDT } from "@/lib/money";
import type { OrderDto } from "@/types/api";
import { availableOrderActions, commandNote, type OrderAction } from "./forms";
import { MutationNotice, ReloadAdmin } from "./notices";
import { AdminPanel, VersionBadge, textareaStyles } from "./ui";
import { useAdminCommand } from "./use-admin-command";

const labels: Record<OrderAction, string> = {
  Confirmed: "Confirm order",
  Shipped: "Mark shipped",
  Delivered: "Mark delivered",
  cancel: "Cancel before shipment",
  collect: "Record customer cash received",
};

export function OrderActions({ order, staffId }: { order: OrderDto; staffId: string }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const actions = availableOrderActions(order);
  const [action, setAction] = useState<OrderAction | "">(actions[0] ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const command = useAdminCommand(staffId, parseOrder);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (command.blocked || !action || !actions.includes(action)) return;
    const data = new FormData(event.currentTarget);
    if (data.get("confirm") !== "on") { setMessage("Confirm that you reviewed this action and the current order version."); return; }
    setMessage(null);
    let note;
    try { note = commandNote(data, "note", action === "cancel"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the action note."); return; }
    const body = { expectedVersion: order.version, note, ...(action === "cancel" || action === "collect" ? {} : { status: action }) };
    const endpoint = action === "cancel" || action === "collect" ? action : "fulfillment";
    const result = await command.run(`Admin/orders/${order.id}/${endpoint}`, body);
    if (result) startTransition(() => router.refresh());
  }

  async function retry() {
    const result = await command.retry();
    if (result) startTransition(() => router.refresh());
  }

  return (
    <AdminPanel title="Staff order action" description="Only the next fulfillment step is available. Cancellation is allowed before shipment; customer cash is recorded separately, after delivery.">
      <VersionBadge version={order.version} />
      <MutationNotice problem={command.problem} message={message ?? (command.uncertain && !command.problem ? "The order action result could not be confirmed." : null)} uncertain={command.uncertain} onReload={() => window.location.reload()} />
      {command.applied ? <p role="status" className="rounded-xl bg-success-soft p-3 text-sm">Order action confirmed. Loading the current snapshot and audit events...</p> : null}
      {!actions.length ? <p className="rounded-xl bg-surface-muted p-4 text-sm">{order.fulfillment === "Cancelled" ? "This order is cancelled. No further fulfillment or collection actions are available." : "This order is delivered and cash has been collected. No further actions are available."}</p> : (
        <form onSubmit={submit} className="space-y-4" aria-busy={command.pending || refreshing}>
          <fieldset disabled={command.blocked || refreshing} className="min-w-0 space-y-4">
            <Field htmlFor="order-action" label="Action"><select id="order-action" name="action" value={action} onChange={(event) => setAction(event.target.value as OrderAction)} className={`${inputStyles} min-w-0`}>{actions.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></Field>
            {action === "cancel" ? <p className="rounded-xl border border-danger/20 bg-danger-soft p-3 text-sm">Cancellation restores reserved quantities exactly once and cannot be undone. It is not available after shipment.</p> : action === "collect" ? <p className="rounded-xl border border-warning/20 bg-warning-soft p-3 text-sm">Confirm the customer paid the full immutable total of <strong>{formatBDT(order.money.total)}</strong>. This records cash received, not courier remittance. It does not change fulfillment.</p> : <p className="text-sm text-muted-foreground">Advance {order.fulfillment} to {action}. This does not mark cash as collected.</p>}
            <Field htmlFor="order-action-note" label={action === "cancel" ? "Cancellation reason" : "Staff note (optional)"} hint={action === "cancel" ? "Required, 3 to 500 characters. This reason is saved in the audit event." : "Up to 500 characters. Notes are recorded with your actor ID, time and order version."}><textarea id="order-action-note" name="note" maxLength={500} required={action === "cancel"} minLength={action === "cancel" ? 3 : undefined} className={textareaStyles} /></Field>
            <label key={action} className="flex min-h-11 items-start gap-3 py-2 text-sm"><input type="checkbox" name="confirm" required className="mt-0.5 size-5 shrink-0 accent-brand" />{action === "collect" ? "The delivered order's full customer cash payment has been received." : `I reviewed order ${order.number} at version ${order.version} and want to ${action === "cancel" ? "cancel it" : `mark it ${action.toLowerCase()}`}.`}</label>
            <Button type="submit" variant={action === "cancel" ? "danger" : "primary"}>{command.pending ? "Applying action..." : labels[action as OrderAction]}</Button>
          </fieldset>
        </form>
      )}
      {command.uncertain ? <div className="flex flex-wrap gap-2"><Button disabled={command.pending} onClick={retry}>{command.pending ? "Retrying original action..." : "Retry original action safely"}</Button><ReloadAdmin label="Reload order state" onReload={() => window.location.reload()} /></div> : null}
    </AdminPanel>
  );
}
