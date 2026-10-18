/**
 * Turns a product or category name into a URL-safe segment.
 *
 * Used by the API adapter as a fallback for rows that arrive without a slug.
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
