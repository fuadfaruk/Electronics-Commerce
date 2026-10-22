"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { Field, Input, inputStyles } from "@/components/ui/input";
import { commerceMutation } from "@/lib/api/client";
import { parseCategory } from "@/lib/api/decoders";
import { ApiRequestError } from "@/lib/api/errors";
import type { ApiProblem, CategoryDto } from "@/types/api";
import { categoryInput, VISUAL_KEYS } from "./forms";
import { MutationNotice } from "./notices";
import { textareaStyles } from "./ui";

export function CategoryEditor({ category, staffId }: { category?: CategoryDto; staffId: string }) {
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
  const supportedVisual = !category || VISUAL_KEYS.some((key) => key === category.visualKey);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || appliedRef.current || blocked) return;
    const data = new FormData(event.currentTarget);
    setProblem(null);
    setMessage(null);
    let body;
    try { body = categoryInput(data, category); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the category fields."); return; }
    lock.current = true;
    setSaving(true);
    try {
      await commerceMutation(category ? `Admin/categories/${category.id}` : "Admin/categories", body, parseCategory, {
        mode: "live", method: category ? "PUT" : "POST", expectedOwner: "account", expectedAccountId: staffId,
      });
      appliedRef.current = true;
      setApplied(true);
      startTransition(() => { router.push("/admin/categories"); router.refresh(); });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setProblem(error.problem);
        setUncertain(!error.problem.status || error.problem.status >= 500);
      } else setUncertain(true);
    } finally { lock.current = false; setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-busy={saving || navigating}>
      <MutationNotice problem={problem} message={message} onReload={() => window.location.reload()} />
      {applied ? <p role="status" className="text-sm text-muted-foreground">Category saved. Loading current categories...</p> : null}
      {uncertain ? <p role="alert" className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">The save result is uncertain. Reload the category list and check this slug before creating or saving again. <Link prefetch={false} href="/admin/categories" className="font-semibold underline">Check current categories</Link></p> : null}
      <fieldset disabled={saving || navigating || blocked} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <Field htmlFor="category-name" label="Category name">
          <Input id="category-name" name="name" required maxLength={100} defaultValue={category?.name ?? ""} />
        </Field>
        <Field htmlFor="category-slug" label="URL slug" hint={category ? "Slugs are permanent, including after archive." : "Lowercase letters, numbers and hyphens. This cannot be changed later."}>
          <Input id="category-slug" name="slug" required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={!!category} defaultValue={category?.slug ?? ""} className={category ? "bg-surface-muted font-mono" : "font-mono"} />
        </Field>
        <Field htmlFor="category-visual" label="Local category visual" hint="Select local artwork. No custom HTML, SVG or remote visuals.">
          <select id="category-visual" name="visualKey" required className={inputStyles} defaultValue={supportedVisual ? category?.visualKey ?? "accessories" : ""}>
            {!supportedVisual ? <option value="" disabled>Choose an approved visual</option> : null}
            {VISUAL_KEYS.map((key) => <option key={key} value={key}>{key[0].toUpperCase() + key.slice(1)}</option>)}
          </select>
          {!supportedVisual ? <p className="text-xs text-warning">The current visual is outside this editor&apos;s approved set. Select a local visual explicitly before saving.</p> : null}
        </Field>
        <Field htmlFor="category-sort" label="Navigation sort order" hint="Whole number from 0 to 10000. Lower numbers appear first.">
          <Input id="category-sort" name="sortOrder" inputMode="numeric" required pattern="[0-9]+" defaultValue={category?.sortOrder ?? 0} />
        </Field>
        <div className="sm:col-span-2">
          <Field htmlFor="category-description" label="Description" hint="Up to 500 characters.">
            <textarea id="category-description" name="description" className={textareaStyles} maxLength={500} defaultValue={category?.description ?? ""} />
          </Field>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || navigating || blocked}>{saving || navigating ? "Saving..." : category ? "Save category" : "Create category"}</Button>
        <Link prefetch={false} href="/admin/categories" className={buttonStyles({ variant: "secondary" })}>Back to categories</Link>
      </div>
    </form>
  );
}
