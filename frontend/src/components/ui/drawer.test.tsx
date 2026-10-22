// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "@/components/ui/drawer";

afterEach(cleanup);
describe("portal drawer focus and isolation", () => {
  it("portals outside the app, inerts the background, traps both tab directions and restores focus", () => {
    const trigger = document.createElement("button"); trigger.textContent = "Outside trigger"; document.body.append(trigger); trigger.focus();
    const close = vi.fn();
    const rendered = render(<Drawer open onClose={close} title="Test drawer" footer={<button>Last action</button>}><input aria-label="First field" /></Drawer>);
    const dialog = screen.getByRole("dialog");
    expect(rendered.container.contains(dialog)).toBe(false);
    expect(rendered.container.inert).toBe(true); expect(trigger.inert).toBe(true);
    const first = screen.getByRole("button", { name: /^Close$/ }); const last = screen.getByRole("button", { name: "Last action" });
    expect(document.activeElement).toBe(first);
    last.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(document.activeElement).toBe(first);
    first.focus(); fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(1);
    rendered.unmount(); expect(trigger.inert).toBeFalsy(); expect(document.activeElement).toBe(trigger); expect(document.body.classList.contains("scroll-locked")).toBe(false);
    trigger.remove();
  });
  it("does not reset a focused field on rerender when a callback changes", () => {
    const rendered = render(<Drawer open onClose={() => {}} title="Filters"><input aria-label="Price" /></Drawer>);
    const field = screen.getByLabelText("Price"); field.focus();
    rendered.rerender(<Drawer open onClose={() => {}} title="Filters"><input aria-label="Price" /></Drawer>);
    expect(document.activeElement).toBe(field);
  });
});
