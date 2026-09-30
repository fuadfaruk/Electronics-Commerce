import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  applyFilters,
  buildFacets,
  buildListingHref,
  clearFilters,
  countActiveFilters,
  matchesQuery,
  parseCatalogFilters,
  toSearchParams,
  toggleBrand,
  toggleCategory,
  type CatalogFilters,
} from "@/lib/catalog/filters";
import type { Product } from "@/types/domain";

function product(
  overrides: Partial<Product> & { slug: string; price: number },
): Product {
  return {
    id: overrides.slug,
    name: overrides.slug,
    brand: "Generic",
    categorySlug: "smartphones",
    description: "",
    stock: 10,
    images: [],
    specs: [],
    ...overrides,
  };
}

const catalog: Product[] = [
  product({
    slug: "alpha",
    name: "Alpha Phone",
    brand: "Sony",
    categorySlug: "smartphones",
    price: 1000,
    stock: 0,
    description: "old ssd bracket",
  }),
  product({
    slug: "bravo",
    name: "Bravo Laptop",
    brand: "Asus",
    categorySlug: "laptops",
    price: 2000,
    stock: 5,
    featured: true,
  }),
  product({
    slug: "charlie",
    name: "Charlie Buds",
    brand: "Sony",
    categorySlug: "audio",
    price: 3000,
    stock: 20,
    description: "noise cancelling",
  }),
  product({
    slug: "delta",
    name: "Delta SSD",
    brand: "WD",
    categorySlug: "storage",
    price: 4000,
    stock: 0,
  }),
];

const slugs = (products: Product[]) => products.map((item) => item.slug);

const withFilters = (overrides: Partial<CatalogFilters>): CatalogFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});

describe("parseCatalogFilters", () => {
  it("returns defaults for an empty query string", () => {
    expect(parseCatalogFilters({})).toEqual(DEFAULT_FILTERS);
  });

  it("trims the search term", () => {
    expect(parseCatalogFilters({ q: "  phone  " }).q).toBe("phone");
  });

  it("reads comma separated and repeated list params", () => {
    expect(parseCatalogFilters({ category: "laptops,audio" }).categories).toEqual(
      ["laptops", "audio"],
    );
    expect(
      parseCatalogFilters({ brand: ["Sony", "Asus"] }).brands,
    ).toEqual(["Sony", "Asus"]);
  });

  it("drops duplicate and empty list entries", () => {
    expect(parseCatalogFilters({ brand: "Sony,,Sony" }).brands).toEqual(["Sony"]);
  });

  it("ignores invalid sort values", () => {
    expect(parseCatalogFilters({ sort: "cheapest" }).sort).toBe("relevance");
    expect(parseCatalogFilters({ sort: "price-desc" }).sort).toBe("price-desc");
  });

  it("ignores unparseable and negative prices", () => {
    expect(parseCatalogFilters({ min: "abc" }).minPrice).toBeNull();
    expect(parseCatalogFilters({ min: "-5" }).minPrice).toBeNull();
    expect(parseCatalogFilters({ max: "" }).maxPrice).toBeNull();
    expect(parseCatalogFilters({ min: "1500" }).minPrice).toBe(1500);
  });

  it("normalises a backwards price range instead of returning nothing", () => {
    const filters = parseCatalogFilters({ min: "500", max: "100" });
    expect(filters.minPrice).toBe(100);
    expect(filters.maxPrice).toBe(500);
  });

  it("only treats stock=in as the in-stock filter", () => {
    expect(parseCatalogFilters({ stock: "in" }).inStockOnly).toBe(true);
    expect(parseCatalogFilters({ stock: "maybe" }).inStockOnly).toBe(false);
  });
});

describe("buildListingHref", () => {
  it("omits defaults entirely", () => {
    expect(buildListingHref(DEFAULT_FILTERS)).toBe("/products");
  });

  it("round-trips through the URL", () => {
    const filters = withFilters({
      q: "noise cancelling",
      categories: ["audio", "laptops"],
      brands: ["Sony"],
      minPrice: 1000,
      maxPrice: 5000,
      inStockOnly: true,
      sort: "price-desc",
    });

    const href = buildListingHref(filters);
    expect(href.startsWith("/products?")).toBe(true);

    const params = Object.fromEntries(
      new URLSearchParams(href.split("?")[1]),
    );
    expect(parseCatalogFilters(params)).toEqual(filters);
  });

  it("keeps the query string free of defaults", () => {
    const params = toSearchParams(withFilters({ inStockOnly: false }));
    expect(params.toString()).toBe("");
  });
});

describe("matchesQuery", () => {
  it("matches everything for an empty query", () => {
    expect(matchesQuery(catalog[0], "")).toBe(true);
    expect(matchesQuery(catalog[0], "   ")).toBe(true);
  });

  it("matches case-insensitively across name, brand and description", () => {
    expect(matchesQuery(catalog[0], "ALPHA")).toBe(true);
    expect(matchesQuery(catalog[0], "sony")).toBe(true);
    expect(matchesQuery(catalog[2], "cancelling")).toBe(true);
  });

  it("narrows with every additional token", () => {
    expect(matchesQuery(catalog[0], "alpha phone")).toBe(true);
    expect(matchesQuery(catalog[0], "alpha laptop")).toBe(false);
  });
});

describe("applyFilters", () => {
  it("returns everything, featured first, with no filters", () => {
    expect(slugs(applyFilters(catalog, DEFAULT_FILTERS))).toEqual([
      "bravo",
      "alpha",
      "charlie",
      "delta",
    ]);
  });

  it("filters by category", () => {
    expect(
      slugs(applyFilters(catalog, withFilters({ categories: ["smartphones"] }))),
    ).toEqual(["alpha"]);
  });

  it("treats multiple brands as an OR", () => {
    expect(
      slugs(applyFilters(catalog, withFilters({ brands: ["Sony", "WD"] }))),
    ).toEqual(["alpha", "charlie", "delta"]);
  });

  it("includes products exactly on the price edges", () => {
    expect(
      slugs(applyFilters(catalog, withFilters({ minPrice: 2000 }))),
    ).toEqual(["bravo", "charlie", "delta"]);
    expect(
      slugs(applyFilters(catalog, withFilters({ maxPrice: 2000 }))),
    ).toEqual(["bravo", "alpha"]);
    expect(
      slugs(
        applyFilters(catalog, withFilters({ minPrice: 2000, maxPrice: 3000 })),
      ),
    ).toEqual(["bravo", "charlie"]);
  });

  it("filters out sold-out products", () => {
    expect(
      slugs(applyFilters(catalog, withFilters({ inStockOnly: true }))),
    ).toEqual(["bravo", "charlie"]);
  });

  it("combines search with filters", () => {
    expect(
      slugs(
        applyFilters(
          catalog,
          withFilters({ q: "sony", inStockOnly: true }),
        ),
      ),
    ).toEqual(["charlie"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(applyFilters(catalog, withFilters({ q: "zzz" }))).toEqual([]);
  });
});

describe("sorting", () => {
  it("sorts by price in both directions", () => {
    expect(
      slugs(applyFilters(catalog, withFilters({ sort: "price-asc" }))),
    ).toEqual(["alpha", "bravo", "charlie", "delta"]);
    expect(
      slugs(applyFilters(catalog, withFilters({ sort: "price-desc" }))),
    ).toEqual(["delta", "charlie", "bravo", "alpha"]);
  });

  it("sorts by name", () => {
    const names = applyFilters(
      catalog,
      withFilters({ sort: "name-asc" }),
    ).map((item) => item.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("ranks a name match above a description match", () => {
    expect(
      slugs(applyFilters(catalog, withFilters({ q: "ssd" }))),
    ).toEqual(["delta", "alpha"]);
  });

  it("breaks ties by catalog order, so results are deterministic", () => {
    // Both match only on brand, so neither should jump ahead of the other.
    expect(
      slugs(applyFilters(catalog, withFilters({ q: "sony" }))),
    ).toEqual(["alpha", "charlie"]);
  });
});

describe("filter helpers", () => {
  it("toggles list filters on and off", () => {
    const added = toggleCategory(DEFAULT_FILTERS, "audio");
    expect(added.categories).toEqual(["audio"]);
    expect(toggleCategory(added, "audio").categories).toEqual([]);

    expect(toggleBrand(DEFAULT_FILTERS, "Sony").brands).toEqual(["Sony"]);
  });

  it("keeps the search term and sort when clearing", () => {
    const filters = withFilters({
      q: "phone",
      sort: "price-asc",
      categories: ["audio"],
      brands: ["Sony"],
      minPrice: 100,
      maxPrice: 200,
      inStockOnly: true,
    });

    expect(clearFilters(filters)).toEqual(withFilters({ q: "phone", sort: "price-asc" }));
  });

  it("counts every active selection, which is what the button badge shows", () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);

    // Two categories + one brand + one price range + in-stock.
    expect(
      countActiveFilters(
        withFilters({
          categories: ["audio", "laptops"],
          brands: ["Sony"],
          minPrice: 100,
          maxPrice: 200,
          inStockOnly: true,
        }),
      ),
    ).toBe(5);
  });

  it("treats a price range as a single filter", () => {
    expect(countActiveFilters(withFilters({ minPrice: 100 }))).toBe(1);
    expect(
      countActiveFilters(withFilters({ minPrice: 100, maxPrice: 200 })),
    ).toBe(1);
  });
});

describe("buildFacets", () => {
  it("counts brands and categories", () => {
    const facets = buildFacets(catalog);

    expect(facets.brands).toEqual([
      { value: "Asus", count: 1 },
      { value: "Sony", count: 2 },
      { value: "WD", count: 1 },
    ]);
    expect(facets.categories.map((entry) => entry.slug)).toEqual([
      "smartphones",
      "laptops",
      "audio",
      "storage",
    ]);
    expect(facets.minPrice).toBe(1000);
    expect(facets.maxPrice).toBe(4000);
  });

  it("narrows facets to the search term so the sheet stays usable", () => {
    const facets = buildFacets(catalog, "sony");
    expect(facets.brands).toEqual([{ value: "Sony", count: 2 }]);
    expect(facets.categories.map((entry) => entry.slug)).toEqual([
      "smartphones",
      "audio",
    ]);
    expect(facets.minPrice).toBe(1000);
    expect(facets.maxPrice).toBe(3000);
  });

  it("returns an empty facet set when nothing matches", () => {
    const facets = buildFacets(catalog, "zzz");
    expect(facets.brands).toEqual([]);
    expect(facets.categories).toEqual([]);
    expect(facets.minPrice).toBe(0);
  });
});
