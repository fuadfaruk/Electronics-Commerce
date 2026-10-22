"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { Field, Input, inputStyles } from "@/components/ui/input";
import { commerceMutation } from "@/lib/api/client";
import { parseProduct } from "@/lib/api/decoders";
import { ApiRequestError } from "@/lib/api/errors";
import type { ApiProblem, CategoryDto, ProductDto } from "@/types/api";
import { productInput } from "./forms";
import { MutationNotice } from "./notices";
import { textareaStyles } from "./ui";

export function ProductEditor({ product, categories, staffId }: { product?: ProductDto; categories: CategoryDto[]; staffId: string }) {
  const router = useRouter();
  const lock = useRef(false);
  const appliedRef = useRef(false);
  const [applied, setApplied] = useState(false);
  const rowId = useRef(100);
  const [images, setImages] = useState(() => (product?.images ?? []).map((value, id) => ({ id, value })));
  const [specs, setSpecs] = useState(() => (product?.specs ?? []).map((spec, id) => ({ id, ...spec })));
  const [saving, setSaving] = useState(false);
  const [navigating, startTransition] = useTransition();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const blocked = applied || uncertain || problem?.status === 409 || problem?.status === 401 || problem?.status === 403;
  const availableCategories = categories.filter((category) => !category.isArchived || category.id === product?.categoryId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || appliedRef.current || blocked) return;
    const data = new FormData(event.currentTarget);
    setProblem(null);
    setMessage(null);
    let body;
    try { body = productInput(data, categories, product); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the product fields."); return; }
    lock.current = true;
    setSaving(true);
    try {
      const saved = await commerceMutation(product ? `Admin/products/${product.id}` : "Admin/products", body, parseProduct, {
        mode: "live", method: product ? "PUT" : "POST", expectedOwner: "account", expectedAccountId: staffId,
      });
      appliedRef.current = true;
      setApplied(true);
      startTransition(() => { router.push(`/admin/products/${saved.id}`); router.refresh(); });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setProblem(error.problem);
        setUncertain(!error.problem.status || error.problem.status >= 500);
      } else setUncertain(true);
    } finally { lock.current = false; setSaving(false); }
  }

  function moveImage(index: number, direction: -1 | 1) {
    setImages((rows) => {
      const next = [...rows];
      const target = index + direction;
      if (target < 0 || target >= rows.length) return rows;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-5" aria-busy={saving || navigating}>
      <MutationNotice problem={problem} message={message} onReload={() => window.location.reload()} />
      {applied ? <p role="status" className="text-sm text-muted-foreground">Product details saved. Loading the current product version...</p> : null}
      {uncertain ? <p role="alert" className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">The save result is uncertain. Check the current product list before creating or saving again. <Link prefetch={false} href="/admin/products" className="font-semibold underline">Check products</Link></p> : null}
      {!availableCategories.length ? <p className="rounded-xl bg-warning-soft p-4 text-sm">Create an active category before adding a product. <Link href="/admin/categories/new" className="font-semibold underline">New category</Link></p> : null}
      <fieldset disabled={saving || navigating || blocked} className="min-w-0 space-y-6">
        <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          <Field htmlFor="product-name" label="Product name"><Input id="product-name" name="name" required maxLength={200} defaultValue={product?.name ?? ""} /></Field>
          <Field htmlFor="product-slug" label="Permanent URL slug" hint="Lowercase letters, numbers and hyphens. It cannot change after creation."><Input id="product-slug" name="slug" required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={!!product} defaultValue={product?.slug ?? ""} className="font-mono" /></Field>
          <Field htmlFor="product-brand" label="Brand"><Input id="product-brand" name="brand" maxLength={100} defaultValue={product?.brand ?? ""} /></Field>
          <Field htmlFor="product-category" label="Category" hint="Archived categories cannot receive new product assignments.">
            <select id="product-category" name="categoryId" required className={`${inputStyles} min-w-0`} defaultValue={product?.categoryId ?? ""}><option value="" disabled>Choose an active category</option>{availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isArchived ? " (archived, current assignment)" : ""}</option>)}</select>
          </Field>
          <Field htmlFor="product-price" label="Sale price (BDT)" hint="Positive whole taka, up to 999999999. No decimals or commas."><Input id="product-price" name="price" required inputMode="numeric" pattern="[0-9]+" maxLength={9} defaultValue={product?.price ?? ""} /></Field>
          <Field htmlFor="product-compare" label="Compare price (BDT, optional)" hint="Whole taka greater than the sale price; leave blank for none."><Input id="product-compare" name="compareAtPrice" inputMode="numeric" pattern="[0-9]+" maxLength={9} defaultValue={product?.compareAtPrice ?? ""} /></Field>
          <div className="sm:col-span-2"><Field htmlFor="product-description" label="Description" hint="Plain text, up to 5000 characters."><textarea id="product-description" name="description" maxLength={5000} className={textareaStyles} defaultValue={product?.description ?? ""} /></Field></div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium sm:col-span-2"><input type="checkbox" name="featured" defaultChecked={product?.featured ?? false} className="size-5 accent-brand" />Feature this product on the storefront</label>
        </div>
        <section className="min-w-0 space-y-4 border-t border-border pt-5" aria-labelledby="images-heading">
          <div className="space-y-1"><h3 id="images-heading" className="font-semibold">Ordered image URLs</h3><p className="text-sm text-muted-foreground">Up to 10 externally hosted HTTPS URLs. The first is the catalog cover. No uploads or server image fetching.</p></div>
          <ol className="space-y-3">{images.map((image, index) => <li key={image.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-white/60 p-3">
            <Field htmlFor={`image-url-${image.id}`} label={`Image ${index + 1}${index === 0 ? " (cover)" : ""}`}><Input id={`image-url-${image.id}`} name="image" type="url" required maxLength={2000} pattern="https://.+" placeholder="https://images.example.com/product.jpg" value={image.value} onChange={(event) => setImages((rows) => rows.map((row) => row.id === image.id ? { ...row, value: event.target.value } : row))} /></Field>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={index === 0} aria-label={`Move image ${index + 1} up`} onClick={() => moveImage(index, -1)}>Move up</Button><Button variant="secondary" disabled={index === images.length - 1} aria-label={`Move image ${index + 1} down`} onClick={() => moveImage(index, 1)}>Move down</Button><Button variant="ghost" aria-label={`Remove image ${index + 1}`} onClick={() => setImages((rows) => rows.filter((row) => row.id !== image.id))}>Remove</Button></div>
          </li>)}</ol>
          <Button variant="secondary" disabled={images.length >= 10} onClick={() => setImages((rows) => [...rows, { id: rowId.current++, value: "" }])}>Add image URL ({images.length}/10)</Button>
        </section>
        <section className="min-w-0 space-y-4 border-t border-border pt-5" aria-labelledby="specs-heading">
          <div className="space-y-1"><h3 id="specs-heading" className="font-semibold">Specifications</h3><p className="text-sm text-muted-foreground">Up to 30 label/value pairs in display order. Edit each field directly, without JSON.</p></div>
          <ol className="space-y-3">{specs.map((spec, index) => <li key={spec.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-white/60 p-3">
            <div className="grid gap-3 sm:grid-cols-2"><Field htmlFor={`spec-label-${spec.id}`} label={`Specification ${index + 1} label`}><Input id={`spec-label-${spec.id}`} name="specLabel" maxLength={100} required placeholder="e.g. Display" value={spec.label} onChange={(event) => setSpecs((rows) => rows.map((row) => row.id === spec.id ? { ...row, label: event.target.value } : row))} /></Field><Field htmlFor={`spec-value-${spec.id}`} label={`Specification ${index + 1} value`}><Input id={`spec-value-${spec.id}`} name="specValue" maxLength={500} required placeholder="e.g. 6.5 inch OLED" value={spec.value} onChange={(event) => setSpecs((rows) => rows.map((row) => row.id === spec.id ? { ...row, value: event.target.value } : row))} /></Field></div>
            <Button variant="ghost" aria-label={`Remove specification ${index + 1}`} onClick={() => setSpecs((rows) => rows.filter((row) => row.id !== spec.id))}>Remove specification</Button>
          </li>)}</ol>
          <Button variant="secondary" disabled={specs.length >= 30} onClick={() => setSpecs((rows) => [...rows, { id: rowId.current++, label: "", value: "" }])}>Add specification ({specs.length}/30)</Button>
        </section>
      </fieldset>
      <div className="space-y-3 border-t border-border pt-5">
        <p className="text-sm text-muted-foreground">{product ? "Metadata saves never overwrite stock. Use the separate versioned stock adjustment below." : "Products are created with zero stock. After creating, use the separate stock adjustment to receive inventory."}</p>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving || navigating || blocked || !availableCategories.length}>{saving || navigating ? "Saving..." : product ? "Save product details" : "Create product"}</Button><Link prefetch={false} href="/admin/products" className={buttonStyles({ variant: "secondary" })}>Back to products</Link></div>
      </div>
    </form>
  );
}
