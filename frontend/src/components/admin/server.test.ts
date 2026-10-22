import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/errors";
import { adminGet } from "./server";

const mocks = vi.hoisted(() => ({ get: vi.fn(), config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ serverGet: mocks.get }));
vi.mock("@/lib/api/config", () => ({ getStorefrontConfig: mocks.config }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

const account = { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Staff", email: "staff@example.com", emailVerified: true, isAdmin: true };

beforeEach(() => { mocks.get.mockReset(); mocks.config.mockReset(); mocks.config.mockReturnValue({ mode: "live" }); });

describe("protected admin server reads", () => {
  it("checks Auth/me before every data fetch, including separate calls after role changes", async () => {
    mocks.get.mockResolvedValueOnce(account).mockResolvedValueOnce(["category"]);
    expect(await adminGet("Admin/categories", (value) => value)).toMatchObject({ ok: true, data: ["category"] });
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual(["Auth/me", "Admin/categories"]);
    mocks.get.mockResolvedValueOnce({ ...account, isAdmin: false });
    expect(await adminGet("Admin/orders", (value) => value)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual(["Auth/me", "Admin/categories", "Auth/me"]);
  });

  it("does not request management records for a non-admin or missing session", async () => {
    mocks.get.mockResolvedValueOnce({ ...account, isAdmin: false });
    expect(await adminGet("Admin/products", (value) => value)).toMatchObject({ ok: false, reason: "forbidden" });
    mocks.get.mockRejectedValueOnce(new ApiRequestError({ status: 401 }));
    expect(await adminGet("Admin/orders", (value) => value)).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(mocks.get.mock.calls.every(([path]) => path === "Auth/me")).toBe(true);
  });

  it("never invokes live staff transport in demo mode", async () => {
    mocks.config.mockReturnValue({ mode: "mock" });
    expect(await adminGet("Admin/categories", (value) => value)).toMatchObject({ ok: false, reason: "mock" });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("drops private records when the protected upstream fetch rejects the session", async () => {
    mocks.get.mockResolvedValueOnce(account).mockRejectedValueOnce(new ApiRequestError({ status: 403 }));
    expect(await adminGet("Admin/orders", (value) => value)).toMatchObject({ ok: false, reason: "forbidden" });
  });
});
