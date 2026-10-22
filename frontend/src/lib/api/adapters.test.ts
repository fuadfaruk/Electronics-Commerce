import { describe, expect, it } from "vitest";
import { apiCategoryToCategory, apiProductToProduct, productToDto } from "@/lib/api/adapters";
import { category, product } from "@/test/fixtures";

describe("dedicated DTO adapters", () => {
  it("preserves authoritative IDs, category metadata, stock, version and image/spec order", () => {
    expect(apiProductToProduct(product)).toEqual(product);
    expect(productToDto(apiProductToProduct(product))).toEqual(product);
  });
  it("maps explicit null compare price only, without synthesizing slugs or rounded money", () => {
    const dto = { ...product, compareAtPrice: null, brand: "", stock: 0, saleEligible: false };
    const view = apiProductToProduct(dto);
    expect(view.compareAtPrice).toBeUndefined();
    expect(view.price).toBe(1200);
    expect(view.slug).toBe(dto.slug);
    expect(view.brand).toBe("");
    expect(productToDto(view)).toEqual(dto);
  });
  it("keeps archived category references and selects allowlisted local artwork", () => {
    expect(apiCategoryToCategory({ ...category, isArchived: true })).toMatchObject({ isArchived: true, image: "/placeholders/audio.svg" });
    expect(apiCategoryToCategory({ ...category, visualKey: "../../private" }).image).toBe("/placeholders/uncategorized.svg");
  });
});
