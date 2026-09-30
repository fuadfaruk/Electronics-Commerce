import type { Category } from "@/types/domain";

/**
 * Catalog categories.
 *
 * The backend `Product` entity has no category field yet, so this list is part
 * of the mock layer. See the README gap list.
 */
export const CATEGORIES: Category[] = [
  {
    slug: "smartphones",
    name: "Smartphones",
    blurb: "Flagship and budget phones",
    image: "/placeholders/smartphones.svg",
  },
  {
    slug: "laptops",
    name: "Laptops",
    blurb: "Everyday, gaming and creator",
    image: "/placeholders/laptops.svg",
  },
  {
    slug: "audio",
    name: "Audio",
    blurb: "Earbuds, headphones and speakers",
    image: "/placeholders/audio.svg",
  },
  {
    slug: "components",
    name: "PC Components",
    blurb: "CPU, GPU, RAM and power supplies",
    image: "/placeholders/components.svg",
  },
  {
    slug: "storage",
    name: "Storage",
    blurb: "NVMe, hard drives and portable SSDs",
    image: "/placeholders/storage.svg",
  },
  {
    slug: "accessories",
    name: "Accessories",
    blurb: "Cables, chargers, mouse and keyboards",
    image: "/placeholders/accessories.svg",
  },
  {
    slug: "wearables",
    name: "Wearables",
    blurb: "Smartwatches and fitness bands",
    image: "/placeholders/wearables.svg",
  },
  {
    slug: "networking",
    name: "Networking",
    blurb: "Routers, mesh systems and switches",
    image: "/placeholders/networking.svg",
  },
];

/**
 * Fallback bucket for products whose category could not be resolved — which is
 * every product once the real API is the source, since `Product` has no
 * category field. Held out of `CATEGORIES` so it never appears as a tile.
 */
export const UNCATEGORIZED: Category = {
  slug: "uncategorized",
  name: "Uncategorized",
  blurb: "Products without a category",
  image: "/placeholders/uncategorized.svg",
};

export const CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug);

export function getCategory(slug: string | undefined): Category {
  if (!slug) return UNCATEGORIZED;
  return CATEGORIES.find((category) => category.slug === slug) ?? UNCATEGORIZED;
}

export function getCategoryName(slug: string | undefined): string {
  return getCategory(slug).name;
}
