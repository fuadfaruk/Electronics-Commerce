import { apiCategoryToCategory } from "@/lib/api/adapters";

/** Explicit sample taxonomy; live navigation always reads /Category. */
const seeds = [
  ["smartphones", "Smartphones", "Flagship and budget phones"],
  ["laptops", "Laptops", "Everyday, gaming and creator"],
  ["audio", "Audio", "Earbuds, headphones and speakers"],
  ["components", "PC Components", "CPU, GPU, RAM and power supplies"],
  ["storage", "Storage", "NVMe, hard drives and portable SSDs"],
  ["accessories", "Accessories", "Cables, chargers, mouse and keyboards"],
  ["wearables", "Wearables", "Smartwatches and fitness bands"],
  ["networking", "Networking", "Routers, mesh systems and switches"],
];

export const MOCK_CATEGORIES = seeds.map(([slug, name, description], index) => apiCategoryToCategory({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  slug, name, description, visualKey: slug, sortOrder: index,
  isArchived: false, version: 1, productCount: 0,
}));
