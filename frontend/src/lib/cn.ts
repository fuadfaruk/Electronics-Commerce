/** Joins truthy class names. Replaces a dependency for one line of logic. */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}
