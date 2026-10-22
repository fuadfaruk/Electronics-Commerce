// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingResults } from "@/components/catalog/listing-results";
import { DEFAULT_FILTERS } from "@/lib/catalog/filters";
import { catalogPage, product } from "@/test/fixtures";
import type { Product } from "@/types/domain";

vi.mock("@/components/product/product-grid", () => ({ ProductGrid: ({ products }: { products: Product[] }) => <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("bounded append and reset catalog", () => {
  it("requests page2/12 with all filters, appends with dedupe, and resets via the filter key", async () => {
    const another = { ...product, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "Another product", slug: "another-product" };
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...catalogPage, page: 2, totalCount: 14, items: [product, another] })); vi.stubGlobal("fetch", fetch);
    const filters = { ...DEFAULT_FILTERS, categories: ["audio"], brands: ["Acme"], minPrice: 100, inStockOnly: true, sort: "price-desc" as const };
    const view = render(<ListingResults key="first" initialPage={{ ...catalogPage, totalCount: 14 }} filters={filters} mode="live" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Another product");
    expect(screen.getAllByText("Headphones")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0], "http://localhost:3000");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ page: "2", pageSize: "12", category: "audio", brand: "Acme", min: "100", stock: "in", sort: "price-desc" });
    view.rerender(<ListingResults key="new-filter" initialPage={{ ...catalogPage, items: [another] }} filters={DEFAULT_FILTERS} mode="live" />);
    expect(screen.queryByText("Headphones")).toBeNull(); expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
  it("does not append a stale completion after the filter key changes", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    const view = render(<ListingResults key="old" initialPage={{ ...catalogPage, totalCount: 14 }} filters={DEFAULT_FILTERS} mode="live" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    view.rerender(<ListingResults key="new" initialPage={{ ...catalogPage, items: [] }} filters={{ ...DEFAULT_FILTERS, q: "new" }} mode="live" />);
    resolve(Response.json({ ...catalogPage, page: 2 }));
    await waitFor(() => expect(screen.queryByText("Headphones")).toBeNull());
  });
});
