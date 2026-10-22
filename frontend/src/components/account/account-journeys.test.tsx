// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "@/components/account/auth-form";
import { EmailAction } from "@/components/account/email-action";
import { LogoutButton } from "@/components/account/logout-button";
import { OrderTracking } from "@/components/orders/order-tracking";
import { ATTEMPT_STORAGE_KEY } from "@/lib/checkout/attempt";
import { safeProblem } from "@/lib/api/errors";
import { account, order, quote } from "@/test/fixtures";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks, unstable_rethrow: () => {} }));
beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, "", "/account/verify"); mocks.refresh.mockReset(); mocks.replace.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("explicit email actions and private tracking", () => {
  it("clears verify fragments before any network, never auto-consumes GET, confirms only on click", async () => {
    window.history.replaceState({}, "", `/account/verify#userId=${account.id}&token=proof_123`);
    const fetch = vi.fn().mockImplementation((url: string) => {
      expect(window.location.hash).toBe("");
      return Promise.resolve(Response.json(url.endsWith("csrf") ? { token: "csrf_123", ownerKind: "guest" } : { message: "ok" }));
    }); vi.stubGlobal("fetch", fetch);
    render(<EmailAction action="verify" mode="live" />);
    await waitFor(() => expect(window.location.hash).toBe("")); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
    await screen.findByText("Email verified. Sign in to continue.");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/bff/Security/csrf", "/api/bff/Auth/verify", "/api/bff/Security/csrf"]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ userId: account.id, token: "proof_123" });
    expect(window.localStorage.length).toBe(0);
  });
  it("requires a verified account to claim and posts only the fragment proof on explicit confirmation", async () => {
    window.history.replaceState({}, "", `/account/claim#claimId=${order.id}&proof=claim_proof`);
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token: "csrf_123", ownerKind: "account", account })).mockResolvedValueOnce(Response.json(order)).mockResolvedValueOnce(Response.json({ token: "fresh_123", ownerKind: "account", account })); vi.stubGlobal("fetch", fetch);
    render(<EmailAction action="claim" mode="live" account={account} />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm claim" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/account/orders/${order.id}`));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ claimId: order.id, proof: "claim_proof" });
    expect(window.location.hash).toBe(""); expect(window.localStorage.length).toBe(0);
  });
  it("does not enable claim confirmation for an unverified or absent account", () => {
    window.history.replaceState({}, "", `/account/claim#claimId=${order.id}&proof=claim_proof`);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<EmailAction action="claim" mode="live" account={{ ...account, emailVerified: false }} />);
    expect((screen.getByRole("button", { name: "Confirm claim" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("clears guest capability then explicitly exchanges with CSRF before private refresh", async () => {
    const capability = "a".repeat(43); window.history.replaceState({}, "", `/orders/${order.id}#capability=${capability}`);
    const fetch = vi.fn().mockImplementation((url: string) => {
      expect(window.location.hash).toBe("");
      return Promise.resolve(Response.json(url.endsWith("csrf") ? { token: "csrf_123", ownerKind: "guest" } : url.endsWith("exchange") ? { message: "ok" } : order));
    }); vi.stubGlobal("fetch", fetch);
    render(<OrderTracking orderId={order.id} initial={{ ok: false, problem: safeProblem(404) }} mode="live" />);
    await screen.findByRole("button", { name: "Unlock private order" }); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unlock private order" }));
    await screen.findByRole("heading", { name: `Order ${order.number}` });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/bff/Security/csrf", "/api/bff/Guest/exchange", "/api/bff/Security/csrf", `/api/bff/Order/${order.id}`]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ orderId: order.id, capability });
    expect(window.localStorage.length).toBe(0);
  });
  it("captures a private link arriving through hash navigation in an existing tracking tab without auto exchange", async () => {
    window.history.replaceState({}, "", `/orders/${order.id}`);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<OrderTracking orderId={order.id} initial={{ ok: false, problem: safeProblem(404) }} mode="live" />);
    window.history.replaceState({}, "", `/orders/${order.id}#capability=${"b".repeat(43)}`);
    fireEvent(window, new HashChangeEvent("hashchange"));
    await screen.findByRole("button", { name: "Unlock private order" });
    expect(window.location.hash).toBe(""); expect(fetch).not.toHaveBeenCalled();
  });
  it("captures a fresh verification proof on the same landing path without consuming it", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<EmailAction action="verify" mode="live" />);
    window.history.replaceState({}, "", `/account/verify#userId=${account.id}&token=new_proof_123`);
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Confirm verification" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    expect(window.location.hash).toBe(""); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("account mutation controls", () => {
  it("registers with generic email guidance and never logs in automatically", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token: "csrf_123", ownerKind: "guest" })).mockResolvedValueOnce(Response.json({ message: "ok" })); vi.stubGlobal("fetch", fetch);
    render(<AuthForm action="register" mode="live" />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: account.name } }); fireEvent.change(screen.getByLabelText("Email"), { target: { value: account.email } }); fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Testing123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Register and send verification" }));
    await screen.findByText(/If this address is eligible, an email will be sent/);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/bff/Security/csrf", "/api/bff/Auth/register"]); expect(mocks.replace).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
  it("blocks logout while any earlier checkout reference is unresolved", () => {
    window.localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify({ schema: 1, idempotencyKey: order.id, quoteId: quote.quoteId, payloadHash: "a".repeat(64), ownerKind: "account", items: [{ productId: quote.lines[0].productId, quantity: 2 }] }));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<LogoutButton mode="live" accountId={account.id} />); fireEvent.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    expect(screen.getByText(/Resolve the earlier checkout before signing out/)).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps every account mutation disabled in mock mode", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<AuthForm action="login" mode="mock" />);
    expect((screen.getByRole("button", { name: "Sign in" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
});
