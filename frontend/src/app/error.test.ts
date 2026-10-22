import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";

describe.each([["page", ErrorPage], ["global", GlobalError]])("%s error boundary", (_, Component) => {
  it.each([null, undefined, 123, {}, "secret email@example.test", new Error("secret stack or PII"), { message: "<script>secret</script>", digest: "email@example.test" }])("never renders arbitrary thrown data %j", (error) => {
    const html = renderToStaticMarkup(createElement(Component, { error, retry: () => {} }));
    expect(html).toContain("Store temporarily unavailable");
    expect(html).toContain("Try again");
    expect(html).not.toMatch(/secret|email@example|<script>/);
  });
});
