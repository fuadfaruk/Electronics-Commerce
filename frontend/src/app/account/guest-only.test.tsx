import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/account/page";
import ClaimPage from "@/app/account/claim/page";
import ForgotPage from "@/app/account/forgot/page";
import LoginPage from "@/app/account/login/page";
import AccountOrderPage from "@/app/account/orders/[id]/page";
import OrdersPage from "@/app/account/orders/page";
import RegisterPage from "@/app/account/register/page";
import ResendPage from "@/app/account/resend/page";
import ResetPage from "@/app/account/reset/page";
import VerifyPage from "@/app/account/verify/page";
import OrderPage from "@/app/orders/[id]/page";
import { order } from "@/test/fixtures";

beforeEach(() => {
  vi.stubEnv("STOREFRONT_MODE", "mock");
  vi.stubEnv("STOREFRONT_GUEST_ONLY", "true");
  vi.stubEnv("STOREFRONT_URL", "http://localhost:3000");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const emptyProps = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };
const orderProps = { params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) };

describe("disabled customer pages", () => {
  it.each([
    { path: "/account", run: () => AccountPage() },
    { path: "/account/claim", run: () => ClaimPage() },
    { path: "/account/forgot", run: () => ForgotPage() },
    { path: "/account/orders", run: () => OrdersPage(emptyProps) },
    { path: "/account/orders/id", run: () => AccountOrderPage(orderProps) },
    { path: "/account/register", run: () => RegisterPage() },
    { path: "/account/resend", run: () => ResendPage() },
    { path: "/account/reset", run: () => ResetPage() },
    { path: "/account/verify", run: () => VerifyPage() },
    { path: "/orders/id", run: () => OrderPage(orderProps) },
  ])("returns not-found for $path before any customer API call", async ({ run }) => {
    await expect(Promise.resolve().then(run)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps staff login accessible without turning customer features back on", async () => {
    const page = await LoginPage(emptyProps);
    expect(page.props.staffOnly).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains the original registration page for explicit re-enablement", () => {
    vi.stubEnv("STOREFRONT_GUEST_ONLY", "false");
    expect(RegisterPage().props.action).toBe("register");
  });
});
