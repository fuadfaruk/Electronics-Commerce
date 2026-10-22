// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTEMPT_STORAGE_KEY, attemptMemory, clearAttempt, createAttempt, parseAttempt, payloadHash, readAttempt, rememberAttempt, saveAttempt } from "@/lib/checkout/attempt";
import { orderRequest, quote } from "@/test/fixtures";

beforeEach(() => { window.localStorage.clear(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });
describe("noncredential attempt persistence", () => {
  it("stores only key, quote, original owner kind, canonical hash and item quantities", async () => {
    const reference = await createAttempt(orderRequest, quote.lines, "account");
    rememberAttempt(reference, { payload: orderRequest, ownerKind: "account" }); saveAttempt(reference);
    const raw = window.localStorage.getItem(ATTEMPT_STORAGE_KEY)!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["idempotencyKey", "items", "ownerKind", "payloadHash", "quoteId", "schema"]);
    expect(raw).not.toMatch(/customer@example|Test Customer|017123|Test Street|Mohammadpur|Call on arrival|token|password|proof|capability/);
    expect(readAttempt().reference).toEqual(reference); expect(attemptMemory(reference)?.payload).toBe(orderRequest);
    clearAttempt(reference); expect(readAttempt().reference).toBeNull(); expect(attemptMemory(reference)).toBeUndefined();
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
});
