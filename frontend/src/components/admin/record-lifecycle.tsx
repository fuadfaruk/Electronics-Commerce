"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { commerceMutation } from "@/lib/api/client";
import { parseCategory, parseProduct } from "@/lib/api/decoders";
import { ApiRequestError } from "@/lib/api/errors";
import type { ApiProblem } from "@/types/api";
import { parseDeleted } from "./decoders";
import { commandNote } from "./forms";
import { MutationNotice } from "./notices";
import { AdminPanel, textareaStyles } from "./ui";

export function RecordLifecycle({ kind, record, staffId }: { kind: "categories" | "products"; record: { id: string; name: string; version: number; isArchived: boolean; productCount?: number }; staffId: string }) {
  const router = useRouter();
  const lock = useRef(false);
  const appliedRef = useRef(false);
  const [applied, setApplied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [navigating, startTransition] = useTransition();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const blocked = applied || uncertain || problem?.status === 409 || problem?.status === 401 || problem?.status === 403;
  const isCategory = kind === "categories";
  const canDelete = isCategory && record.productCount === 0;

  async function submit(event: FormEvent<HTMLFormElement>, action: "archive" | "delete") {
    event.preventDefault();
    if (lock.current || appliedRef.current || blocked || (action === "delete" && !canDelete) || (action === "archive" && record.isArchived)) return;
    const data = new FormData(event.currentTarget);
    if (data.get("confirm") !== "on") { setMessage("Confirm the change before continuing."); return; }
    setProblem(null);
    setMessage(null);
    let note;
    try { note = commandNote(data); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the note."); return; }
    lock.current = true;
    setSaving(true);
    try {
      const options = { mode: "live" as const, expectedOwner: "account" as const, expectedAccountId: staffId };
      if (action === "delete") {
        await commerceMutation(`Admin/categories/${record.id}`, undefined, parseDeleted, { ...options, method: "DELETE", query: new URLSearchParams({ expectedVersion: String(record.version) }) });
        startTransition(() => { router.push("/admin/categories"); router.refresh(); });
      } else {
        const body = { expectedVersion: record.version, note };
        if (isCategory) await commerceMutation(`Admin/categories/${record.id}/archive`, body, parseCategory, options);
        else await commerceMutation(`Admin/products/${record.id}/archive`, body, parseProduct, options);
        startTransition(() => router.refresh());
      }
      appliedRef.current = true;
      setApplied(true);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setProblem(error.problem);
        setUncertain(!error.problem.status || error.problem.status >= 500);
      } else setUncertain(true);
    } finally { lock.current = false; setSaving(false); }
  }

  return (
    <AdminPanel title="Archive & retention" description={isCategory ? "Archiving hides navigation and prevents new assignments. Existing products and their URLs are preserved; products are not silently archived." : "Archiving removes sale eligibility. Existing order snapshots and the permanent product slug are preserved. Products are not deleted."}>
      <MutationNotice problem={problem} message={message} onReload={() => window.location.reload()} />
      {applied ? <p role="status" className="text-sm text-muted-foreground">Change confirmed. Loading the latest records...</p> : null}
      {uncertain ? <p role="alert" className="text-sm text-warning">This result is uncertain. Reload the current list to check whether the change was applied before submitting another command.</p> : null}
      {record.isArchived ? <p className="rounded-xl bg-surface-muted p-3 text-sm font-medium">This {isCategory ? "category" : "product"} is already archived.</p> : (
        <form onSubmit={(event) => submit(event, "archive")} className="space-y-4">
          <fieldset disabled={saving || navigating || blocked} className="min-w-0 space-y-4">
            <Field htmlFor="archive-note" label="Archive note (optional)" hint="Up to 500 characters. Explain why the record is leaving sale or navigation.">
              <textarea id="archive-note" name="note" maxLength={500} className={textareaStyles} />
            </Field>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="confirm" required className="size-5 shrink-0 accent-brand" />I understand that {record.name} will be archived.</label>
            <Button type="submit" variant="danger">{saving ? "Applying..." : `Archive ${isCategory ? "category" : "product"}`}</Button>
          </fieldset>
        </form>
      )}
      {isCategory ? (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="font-semibold">Delete an unreferenced category</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">Deletion is permanent and is only allowed when no products, including archived products, reference this category. The API checks the latest references and version.</p>
          {!canDelete ? <p className="text-sm font-medium text-warning">Cannot delete: {record.productCount ?? "existing"} products reference this category.</p> : (
            <form onSubmit={(event) => submit(event, "delete")}>
              <fieldset disabled={saving || navigating || blocked} className="min-w-0 space-y-3">
                <input type="hidden" name="note" value="" />
                <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="confirm" required className="size-5 shrink-0 accent-danger" />Permanently delete {record.name}. This cannot be undone.</label>
                <Button type="submit" variant="danger">{saving ? "Applying..." : "Delete category"}</Button>
              </fieldset>
            </form>
          )}
        </div>
      ) : null}
    </AdminPanel>
  );
}
