import { describe, expect, it } from "vitest";
import { checkoutPayload, strongPassword } from "@/lib/checkout/validation";
import { orderRequest, quote } from "@/test/fixtures";

function data(patch: Record<string, string | undefined> = {}) {
  const d = new FormData();
  for (const [key, value] of Object.entries({ ...orderRequest.contact, ...orderRequest.deliveryAddress, notes: orderRequest.notes!, ...patch })) if (value !== undefined) d.set(key, value);
  return d;
}
describe("structured Bangladesh checkout", () => {
  it("sends a quote reference and structured details only, not client owner/prices/status/payment", () => {
    expect(checkoutPayload(data(), quote.quoteId).payload).toEqual(orderRequest);
    expect(Object.keys(checkoutPayload(data(), quote.quoteId).payload!)).toEqual(["quoteId", "contact", "deliveryAddress", "notes"]);
  });
  it("normalizes phone and uses authoritative account email", () => {
    const result = checkoutPayload(data({ phone: "+88 (017) 1234-5678", email: "other@example.test" }), quote.quoteId, "verified@example.test");
    expect(result.payload?.contact).toMatchObject({ phone: "+8801712345678", email: "verified@example.test" });
  });
  it.each([{ phone: "1234" }, { district: "Invented" }, { postcode: "12345" }, { email: "invalid" }, { name: "a" }, { notes: "x".repeat(501) }, { street: "abc" }])("rejects invalid contact/address %j", (patch) => { expect(checkoutPayload(data(patch), quote.quoteId).error).toBeTruthy(); });
  it("matches Identity password policy", () => { expect(strongPassword("Testing123!")).toBe(true); for (const p of ["lowercaseonly", "Testing123", "TESTING123!", "short!"]) expect(strongPassword(p)).toBe(false); });
});
