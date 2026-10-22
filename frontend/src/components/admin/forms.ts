import { FULFILLMENT_STATES, type CategoryDto, type ProductDto } from "@/types/api";

export const VISUAL_KEYS = [
  "smartphones",
  "laptops",
  "audio",
  "wearables",
  "cameras",
  "gaming",
  "accessories",
  "tablets",
  "components",
  "storage",
  "networking",
] as const;

export type CategoryInput = {
  slug: string;
  name: string;
  description: string;
  visualKey: string;
  sortOrder: number;
  expectedVersion: number;
};

export type ProductInput = {
  slug: string;
  name: string;
  brand: string;
  categoryId: string;
  description: string;
  price: number;
  compareAtPrice: number | null;
  featured: boolean;
  images: string[];
  specs: { label: string; value: string }[];
  expectedVersion: number;
};

function text(data: FormData, field: string, max: number, required = false) {
  const value = data.get(field);
  if (typeof value !== "string") throw new Error(`Enter ${field}.`);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max) {
    throw new Error(`Enter ${field}${required ? " (required)" : ""}, up to ${max} characters.`);
  }
  return trimmed;
}

export function wholeNumber(value: string, label: string, min: number, max: number) {
  if (!/^-?\d+$/.test(value)) throw new Error(`${label} must be a whole number, without commas or decimals.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function slug(value: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 160) {
    throw new Error("Use a lowercase slug with letters, numbers and single hyphens, up to 160 characters.");
  }
  return value;
}

export function categoryInput(data: FormData, category?: CategoryDto): CategoryInput {
  const visualKey = text(data, "visualKey", 30, true);
  if (!VISUAL_KEYS.some((key) => key === visualKey)) throw new Error("Choose one of the available category visuals.");
  return {
    slug: category?.slug ?? slug(text(data, "slug", 160, true)),
    name: text(data, "name", 100, true),
    description: text(data, "description", 500),
    visualKey,
    sortOrder: wholeNumber(text(data, "sortOrder", 20, true), "Sort order", 0, 10000),
    expectedVersion: category?.version ?? 0,
  };
}

export function productInput(data: FormData, categories: CategoryDto[], product?: ProductDto): ProductInput {
  const price = wholeNumber(text(data, "price", 20, true), "Price", 1, 999999999);
  const compareText = text(data, "compareAtPrice", 20);
  const compareAtPrice = compareText ? wholeNumber(compareText, "Compare price", 1, 999999999) : null;
  if (compareAtPrice !== null && compareAtPrice <= price) throw new Error("Compare price must be greater than the sale price.");
  const categoryId = text(data, "categoryId", 36, true);
  if (!categories.some((category) => category.id === categoryId && (!category.isArchived || category.id === product?.categoryId))) {
    throw new Error("Choose an active category. An existing archived category may only be kept, not newly assigned.");
  }
  const images = data.getAll("image").map((value) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 2000) throw new Error("Each image needs an HTTPS URL, up to 2000 characters.");
    const url = value.trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
    } catch {
      throw new Error("Images must use externally hosted HTTPS URLs without embedded credentials.");
    }
    return url;
  });
  if (images.length > 10) throw new Error("Use no more than 10 ordered image URLs.");
  const labels = data.getAll("specLabel");
  const values = data.getAll("specValue");
  if (labels.length > 30 || labels.length !== values.length) throw new Error("Use no more than 30 complete specifications.");
  const specs = labels.map((label, index) => {
    const value = values[index];
    if (typeof label !== "string" || typeof value !== "string" || !label.trim() || !value.trim() || label.trim().length > 100 || value.trim().length > 500) {
      throw new Error("Each specification needs a label (up to 100 characters) and a value (up to 500 characters).");
    }
    return { label: label.trim(), value: value.trim() };
  });
  return {
    slug: product?.slug ?? slug(text(data, "slug", 160, true)),
    name: text(data, "name", 200, true),
    brand: text(data, "brand", 100),
    categoryId,
    description: text(data, "description", 5000),
    price,
    compareAtPrice,
    featured: data.get("featured") === "on",
    images,
    specs,
    expectedVersion: product?.version ?? 0,
  };
}

export function commandNote(data: FormData, field = "note", required = false) {
  const note = text(data, field, 500, required);
  if (required && note.length < 3) throw new Error("Enter a reason of at least 3 characters.");
  return note || null;
}

export function stockInput(data: FormData, product: Pick<ProductDto, "stock" | "version">) {
  const quantity = wholeNumber(text(data, "quantity", 20, true), "Quantity", 1, 1000000);
  const direction = text(data, "direction", 10, true);
  if (direction !== "add" && direction !== "remove") throw new Error("Choose whether to add or remove stock.");
  const delta = direction === "remove" ? -quantity : quantity;
  if (product.stock + delta < 0 || product.stock + delta > 1000000) {
    throw new Error("The resulting stock must be non-negative and within the supported quantity range.");
  }
  return { delta, expectedVersion: product.version, reason: commandNote(data, "reason", true)! };
}

export const FULFILLMENT_STATUSES = FULFILLMENT_STATES;

export type OrderAction = "Confirmed" | "Shipped" | "Delivered" | "cancel" | "collect";

export function availableOrderActions(order: { fulfillment: string; payment: string }): OrderAction[] {
  const actions: OrderAction[] = [];
  if (order.fulfillment === "Pending") actions.push("Confirmed", "cancel");
  if (order.fulfillment === "Confirmed") actions.push("Shipped", "cancel");
  if (order.fulfillment === "Shipped") actions.push("Delivered");
  if (order.fulfillment === "Delivered" && order.payment === "Unpaid") actions.push("collect");
  return actions;
}

export function pageNumber(value: string | string[] | undefined) {
  const single = Array.isArray(value) ? value[0] : value;
  return single && /^\d+$/.test(single) && Number(single) >= 1 && Number(single) <= 100000 ? Number(single) : 1;
}
