import { afterEach, describe, expect, it, vi } from "vitest";
import { withStorageLock } from "./storage-lock";

afterEach(() => vi.unstubAllGlobals());
describe("cross-tab storage serialization", () => {
  it("uses the same named exclusive Web Lock around each read/change/write", async () => {
    const request = vi.fn(async (_key: string, operation: () => unknown) => operation());
    vi.stubGlobal("navigator", { locks: { request } });
    expect(await withStorageLock("cart.live", (shared) => shared)).toBe(true);
    expect(request.mock.calls[0][0]).toBe("electromart:cart.live");
  });
  it.each(["unsupported", "rejected"])("serializes overlapping async operations in-tab when Web Locks are %s", async (mode) => {
    vi.stubGlobal("navigator", mode === "unsupported" ? {} : { locks: { request: vi.fn().mockRejectedValue(new Error("Denied")) } });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: string[] = [];
    const first = withStorageLock("cart.live", async (shared) => {
      expect(shared).toBe(false); events.push("first"); entered.resolve();
      await release.promise; events.push("finished"); return 1;
    });
    const second = withStorageLock("cart.live", (shared) => {
      expect(shared).toBe(false); events.push("second"); return 2;
    });
    await entered.promise;
    expect(events).toEqual(["first"]);
    expect(await withStorageLock("checkout.live", (shared) => shared)).toBe(false);
    release.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(events).toEqual(["first", "finished", "second"]);
  });
  it.each([true, false])("releases the tab queue after an operation fails without running it twice (shared=%s)", async (shared) => {
    vi.stubGlobal("navigator", shared ? { locks: { request: async (_key: string, operation: () => unknown) => operation() } } : {});
    const operation = vi.fn(() => { throw new Error("Operation failed"); });
    const failed = withStorageLock("cart.live", operation);
    const next = withStorageLock("cart.live", (locked) => locked);
    await expect(failed).rejects.toThrow("Operation failed");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(await next).toBe(shared);
  });
});
