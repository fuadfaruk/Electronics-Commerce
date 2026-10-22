"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, inputStyles } from "@/components/ui/input";
import { parseStock } from "@/lib/api/decoders";
import type { ProductDto } from "@/types/api";
import { stockInput } from "./forms";
import { MutationNotice, ReloadAdmin } from "./notices";
import { AdminPanel, VersionBadge, textareaStyles } from "./ui";
import { useAdminCommand } from "./use-admin-command";

export function StockAdjustment({ product, staffId }: { product: ProductDto; staffId: string }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [direction, setDirection] = useState("add");
  const [quantity, setQuantity] = useState("");
  const command = useAdminCommand(staffId, parseStock);
  const preview = /^\d+$/.test(quantity) && Number.isSafeInteger(Number(quantity)) ? product.stock + (direction === "remove" ? -Number(quantity) : Number(quantity)) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (command.blocked) return;
    setMessage(null);
    let body;
    try { body = stockInput(new FormData(event.currentTarget), product); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the stock adjustment."); return; }
    const result = await command.run(`Admin/products/${product.id}/stock`, body);
    if (result) startTransition(() => router.refresh());
  }

  async function retry() {
    const result = await command.retry();
    if (result) startTransition(() => router.refresh());
  }

  return (
    <AdminPanel title="Stock adjustment" description="Record received stock, corrections or write-offs as a delta. Checkout and cancellation can change this count; a stale version never overwrites their changes.">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted p-4"><p className="text-sm">Current available stock <strong className="ml-2 font-mono text-xl">{product.stock}</strong></p><VersionBadge version={product.version} /></div>
      <MutationNotice problem={command.problem} message={message ?? (command.uncertain && !command.problem ? "The adjustment result could not be confirmed." : null)} uncertain={command.uncertain} onReload={() => window.location.reload()} />
      {command.applied ? <p role="status" className="rounded-xl bg-success-soft p-3 text-sm text-foreground">Stock adjustment confirmed. Loading the current version...</p> : null}
      <form onSubmit={submit} className="space-y-4" aria-busy={command.pending || refreshing}>
        <fieldset disabled={command.blocked || refreshing} className="min-w-0 space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2"><Field htmlFor="stock-direction" label="Adjustment type"><select id="stock-direction" name="direction" value={direction} onChange={(event) => setDirection(event.target.value)} className={`${inputStyles} min-w-0`}><option value="add">Add received stock</option><option value="remove">Remove / write off stock</option></select></Field><Field htmlFor="stock-quantity" label="Quantity to adjust" hint="Positive whole units, not a replacement stock count."><Input id="stock-quantity" name="quantity" inputMode="numeric" required pattern="[0-9]+" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field></div>
          {preview !== null ? <p className={`text-sm ${preview < 0 ? "text-danger" : "text-muted-foreground"}`}>Preview after adjustment: <strong>{preview} units</strong>. The API validates the current count.</p> : null}
          <Field htmlFor="stock-reason" label="Reason for adjustment" hint="Required, 3 to 500 characters. Include a delivery reference or explanation."><textarea id="stock-reason" name="reason" required minLength={3} maxLength={500} className={textareaStyles} /></Field>
          <Button type="submit">{command.pending ? "Applying adjustment..." : "Apply stock adjustment"}</Button>
        </fieldset>
      </form>
      {command.uncertain ? <div className="flex flex-wrap gap-2"><Button disabled={command.pending} onClick={retry}>{command.pending ? "Retrying same adjustment..." : "Retry original adjustment safely"}</Button><ReloadAdmin label="Reload before a new adjustment" onReload={() => window.location.reload()} /></div> : null}
    </AdminPanel>
  );
}
