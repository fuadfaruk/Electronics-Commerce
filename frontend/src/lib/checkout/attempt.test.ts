// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTEMPT_STORAGE_KEY, attemptMemory, clearAttempt, createAttempt, parseAttempt, payloadHash, readAttempt, rememberAttempt, saveAttempt } from "@/lib/checkout/attempt";
import { withStorageLock } from "@/lib/storage-lock";
import { orderRequest, quote } from "@/test/fixtures";

beforeEach(() => {
  window.localStorage.clear(); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, operation: () => unknown) => operation() } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  const reference = readAttempt().reference;
  if (reference) await clearAttempt(reference);
  window.localStorage.clear(); vi.unstubAllGlobals();
});
describe("noncredential attempt persistence", () => {
  it("stores only key, quote, original owner kind, canonical hash and item quantities", async () => {
    const reference = await createAttempt(orderRequest, quote.lines, "account");
    rememberAttempt(reference, { payload: orderRequest, ownerKind: "account" }); saveAttempt(reference);
    const raw = window.localStorage.getItem(ATTEMPT_STORAGE_KEY)!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["idempotencyKey", "items", "ownerKind", "payloadHash", "quoteId", "schema"]);
    expect(raw).not.toMatch(/customer@example|Test Customer|017123|Test Street|Mohammadpur|Call on arrival|token|password|proof|capability/);
    expect(readAttempt().reference).toEqual(reference); expect(attemptMemory(reference)?.payload).toBe(orderRequest);
    await clearAttempt(reference); expect(readAttempt().reference).toBeNull(); expect(attemptMemory(reference)).toBeUndefined();
  });
  it("hashes exactly the replay payload and refuses augmented persisted PII or invalid items", async () => {
    const reference = await createAttempt(orderRequest, quote.lines, "guest");
    expect(await payloadHash({ ...orderRequest, contact: { ...orderRequest.contact, phone: "01912345678" } })).not.toBe(reference.payloadHash);
    expect(parseAttempt(JSON.stringify({ ...reference, contact: orderRequest.contact }))).toBeNull();
    expect(parseAttempt(JSON.stringify({ ...reference, items: [{ productId: quote.lines[0].productId, quantity: 1.5 }] }))).toBeNull();
  });
  it("handles bad or blocked browser storage without leaking credentials", () => {
    window.localStorage.setItem(ATTEMPT_STORAGE_KEY, "bad-json"); expect(readAttempt().invalid).toBe(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error(); }); expect(readAttempt().unavailable).toBe(true);
    vi.restoreAllMocks();
  });
  it("retains one original reference and payload when storage rejects writes or later denies reads", async () => {
    const reference = await createAttempt(orderRequest, quote.lines, "account");
    const request = { payload: orderRequest, ownerKind: "account" as const, accountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", unsubmitted: true };
    rememberAttempt(reference, request);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    expect(saveAttempt(reference)).toBe(false);
    expect(readAttempt().reference).toEqual(reference);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage denied"); });
    expect(readAttempt()).toEqual({ reference, unavailable: true, invalid: false });
    expect(attemptMemory(reference)).toBe(request);
    const other = await createAttempt(orderRequest, quote.lines, "account");
    expect(() => rememberAttempt(other, request)).toThrow();
    expect(() => saveAttempt(other)).toThrow();
    await clearAttempt(other);
    expect(readAttempt().reference).toEqual(reference);
    await clearAttempt(reference);
    expect(readAttempt().reference).toBeNull();
    expect(attemptMemory(reference)).toBeUndefined();
  });
  it.each(["unsupported", "rejected"])("keeps overlapping creation on one original key even with %s locks and denied storage", async (mode) => {
    vi.stubGlobal("navigator", mode === "unsupported" ? {} : { locks: { request: vi.fn().mockRejectedValue(new Error("Denied")) } });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const create = vi.fn(async () => {
      entered.resolve(); await release.promise;
      return createAttempt(orderRequest, quote.lines, "guest");
    });
    const getOrCreate = () => withStorageLock(ATTEMPT_STORAGE_KEY, async () => {
      const existing = readAttempt().reference;
      if (existing) return existing;
      const reference = await create();
      rememberAttempt(reference, { payload: orderRequest, ownerKind: "guest" });
      expect(saveAttempt(reference)).toBe(false);
      return reference;
    });
    const first = getOrCreate(); const second = getOrCreate();
    await entered.promise; expect(create).toHaveBeenCalledTimes(1); release.resolve();
    const references = await Promise.all([first, second]);
    expect(references[1]).toEqual(references[0]); expect(create).toHaveBeenCalledTimes(1);
    await clearAttempt(references[0]);
  });
  it("does not overwrite another uncertain stored key or clear it with a stale reference", async () => {
    const original = await createAttempt(orderRequest, quote.lines, "guest");
    const other = await createAttempt(orderRequest, quote.lines, "guest");
    rememberAttempt(original, { payload: orderRequest, ownerKind: "guest" });
    window.localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(other));
    expect(saveAttempt(original)).toBe(false);
    await clearAttempt(original);
    expect(parseAttempt(window.localStorage.getItem(ATTEMPT_STORAGE_KEY))).toEqual(other);
    expect(readAttempt().reference).toEqual(other);
  });
  it("refuses shared cleanup without a Web Lock while dropping only resolved tab memory", async () => {
    const reference = await createAttempt(orderRequest, quote.lines, "guest");
    saveAttempt(reference);
    vi.stubGlobal("navigator", {});
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    await clearAttempt(reference);
    expect(remove).not.toHaveBeenCalled();
    expect(parseAttempt(window.localStorage.getItem(ATTEMPT_STORAGE_KEY))).toEqual(reference);
    expect(attemptMemory(reference)).toBeUndefined();
  });
});
