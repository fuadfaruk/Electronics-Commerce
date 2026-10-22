import { describe, expect, it } from "vitest";
import { parseCapabilityFragment, parseEmailFragment, safeNext } from "@/lib/account/links";
import { account, order } from "@/test/fixtures";

describe("fragment-only email proofs and redirects", () => {
  it("accepts only expected fragment pairs and rejects duplicate/unknown fields", () => {
    expect(parseEmailFragment(`#userId=${account.id}&token=abc_DEF123`, "verify")).toEqual({ userId: account.id, token: "abc_DEF123" });
    expect(parseEmailFragment(`#claimId=${order.id}&proof=abc_DEF123`, "claim")).toEqual({ claimId: order.id, proof: "abc_DEF123" });
    expect(parseEmailFragment(`#userId=${account.id}&token=x&token=y`, "reset")).toBeNull();
    expect(parseEmailFragment(`#userId=${account.id}&token=x&redirect=https://evil`, "verify")).toBeNull();
    expect(parseCapabilityFragment("#capability=" + "a".repeat(43))).toBe("a".repeat(43));
    expect(parseCapabilityFragment("#capability=x&ownerId=bad")).toBeNull();
  });
  it("restricts post-login navigation to known same-origin routes, never carries proof/query", () => {
    expect(safeNext("/admin")).toBe("/admin"); expect(safeNext(`/account/orders/${order.id}`)).toBe(`/account/orders/${order.id}`);
    for (const url of ["https://evil.test", "//evil.test", "/\\evil.test", "/account?token=secret", "/checkout#proof=secret", "/api/bff/Order", "/admin/%2f%2fevil"]) expect(safeNext(url)).toBe("/account");
  });
});
