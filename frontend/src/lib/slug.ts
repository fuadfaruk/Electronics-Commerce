/**
 * Turns a product or category name into a URL-safe segment.
 *
 * Used by the API adapter, where products arrive with only a name — the
 * backend entity has no slug field yet.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
