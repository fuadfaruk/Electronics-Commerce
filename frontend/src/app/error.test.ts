import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";

describe.each([
  ["page error", ErrorPage],
  ["global error", GlobalError],
])("%s fallback", (_, Component) => {
  it.each([null, undefined, 123, {}, { message: {}, digest: {} }])(
    "handles non-Error thrown values without another crash: %j",
    (error) => {
      const html = renderToStaticMarkup(
        createElement(Component, { error, retry: () => {} }),
      );
      expect(html).toContain("An unexpected error occurred");
      expect(html).toContain("Try again");
    },
  );

  it("displays the available error message and reference, but not its stack", () => {
    const error = Object.assign(
      new Error("Could not render & display this product"),
      { digest: "error-reference-123" },
    );
    const html = renderToStaticMarkup(
      createElement(Component, { error, retry: () => {} }),
    );
    expect(html).toContain("Could not render &amp; display this product");
    expect(html).toContain("error-reference-123");
    expect(html).not.toContain("at ");
  });

  it("escapes thrown string messages rather than rendering HTML", () => {
    const html = renderToStaticMarkup(
      createElement(Component, {
        error: "<script>alert('problem')</script>",
        retry: () => {},
      }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
