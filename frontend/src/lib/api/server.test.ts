import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serverGet } from "@/lib/api/server";
import { parseAccount, parseOrder } from "@/lib/api/decoders";
import { account, order } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
beforeEach(() => { vi.stubEnv("STOREFRONT_MODE", "live"); vi.stubEnv("STOREFRONT_GUEST_ONLY", "true"); vi.stubEnv("API_BASE_URL", "http://localhost:5249"); vi.stubEnv("STOREFRONT_URL", "http://localhost:3000"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("private RSC transport", () => {
  it("reads async cookies afresh for every direct request, no private shared cache or cookie writes", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValueOnce({ getAll: () => [{ name: "ElectroMart.Auth", value: "first" }, { name: "Other", value: "secret" }], set })
      .mockResolvedValueOnce({ getAll: () => [{ name: "ElectroMart.Auth", value: "second" }], set });
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(account))); vi.stubGlobal("fetch", fetch);
    await serverGet("Auth/me", parseAccount); await serverGet("Auth/me", parseAccount);
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Cookie")).toBe("ElectroMart.Auth=first");
    expect(new Headers(fetch.mock.calls[1][1].headers).get("Cookie")).toBe("ElectroMart.Auth=second");
    expect(fetch.mock.calls[0][0]).toBe("http://localhost:5249/api/v1/Auth/me");
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "manual" });
    expect(set).not.toHaveBeenCalled();
  });
  it("does not downgrade private401 to guest or sample", async () => {
    mocks.cookies.mockResolvedValue({ getAll: () => [] });
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 })); vi.stubGlobal("fetch", fetch);
    await expect(serverGet("Auth/me", parseAccount)).rejects.toMatchObject({ problem: { status: 401 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refuses customer tracking before cookies or network, but retains opt-in reads", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(order)); vi.stubGlobal("fetch", fetch);
    await expect(serverGet(`Order/${order.id}`, parseOrder)).rejects.toMatchObject({ problem: { status: 404 } });
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("STOREFRONT_GUEST_ONLY", "false");
    mocks.cookies.mockResolvedValue({ getAll: () => [] });
    expect(await serverGet(`Order/${order.id}`, parseOrder)).toEqual(order);
  });
});
