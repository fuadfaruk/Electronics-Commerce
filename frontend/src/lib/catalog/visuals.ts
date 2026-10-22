const VISUALS = [
  "smartphones", "laptops", "audio", "components", "storage",
  "accessories", "wearables", "networking", "uncategorized",
] as const;

export const FALLBACK_IMAGE = "/placeholders/uncategorized.svg";

export function categoryImage(key: string): string {
  return (VISUALS as readonly string[]).includes(key)
    ? `/placeholders/${key}.svg`
    : FALLBACK_IMAGE;
}

export function isLocalArtwork(value: string): boolean {
  return VISUALS.some((key) =>
    value === `/placeholders/${key}.svg` ||
    value === `/placeholders/${key}-detail.svg`,
  );
}

export function isHttpsImage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.hash && !/[\u0000-\u0020\\]/.test(value);
  } catch {
    return false;
  }
}
