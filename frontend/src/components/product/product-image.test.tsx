// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { ProductImage } from "@/components/product/product-image";

vi.mock("next/image", () => ({ default: (props: React.ComponentProps<"img">) => createElement("img", { src: props.src, alt: props.alt, referrerPolicy: props.referrerPolicy, onError: props.onError }) }));
afterEach(cleanup);
describe("product image safety", () => {
  it("uses local fallback for empty/unsafe URLs and broken HTTPS images", () => {
    const view = render(<ProductImage src="javascript:alert(1)" alt="Product" sizes="100px" />);
    expect(screen.getByAltText("Product").getAttribute("src")).toBe("/placeholders/uncategorized.svg");
    view.rerender(<ProductImage src="https://images.example.test/product.jpg" alt="Product" sizes="100px" />);
    expect(screen.getByAltText("Product").getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(screen.getByAltText("Product"));
    expect(screen.getByAltText("Product").getAttribute("src")).toBe("/placeholders/uncategorized.svg");
    view.rerender(<ProductImage src="https://images.example.test/new.jpg" alt="Product" sizes="100px" />);
    expect(screen.getByAltText("Product").getAttribute("src")).toBe("https://images.example.test/new.jpg");
  });
});
