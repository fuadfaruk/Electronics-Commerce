"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { Field, Input } from "@/components/ui/input";
import { commerceMutation } from "@/lib/api/client";
import { GUID_PATTERN, parseMessage } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import type { AccountDto, ApiProblem, StorefrontMode } from "@/types/api";

export function ClaimRequest({ account, mode }: { account: AccountDto; mode: StorefrontMode }) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || mode !== "live" || !account.emailVerified) return;
    const orderId = String(new FormData(event.currentTarget).get("orderId") ?? "").trim();
    if (!GUID_PATTERN.test(orderId)) { setMessage("Enter the order ID from your private receipt link, not an email or order number."); return; }
    lock.current = true; setPending(true); setProblem(null); setMessage("");
    try {
      await commerceMutation("Account/order-claims/request", { orderId }, parseMessage, { mode, expectedOwner: "account", expectedAccountId: account.id });
      setMessage("If this guest order is eligible for your verified account, an email will be sent with a fresh claim link. Confirm that link explicitly to claim the order.");
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { lock.current = false; setPending(false); }
  };
  return <section className="space-y-3 rounded-2xl border bg-surface p-4">
    <h2 className="text-lg font-semibold">Claim a guest order</h2>
    <p className="text-sm text-muted-foreground">The account email must match the original order email, and a fresh email proof is required. Orders are never linked by email match alone.</p>
    <form onSubmit={submit} className="space-y-3"><Field label="Order ID" htmlFor="claim-order-id"><Input id="claim-order-id" name="orderId" maxLength={36} required autoComplete="off" /></Field><Button type="submit" disabled={pending || mode !== "live" || !account.emailVerified}>{pending ? "Requesting..." : "Request order claim email"}</Button></form>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {problem ? <ErrorNotice problem={problem} retryable={false} /> : null}
  </section>;
}
