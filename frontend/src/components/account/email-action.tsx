"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { Field, Input } from "@/components/ui/input";
import { parseEmailFragment, takeFragment, type EmailAction as Action, type EmailProof } from "@/lib/account/links";
import { commerceMutation } from "@/lib/api/client";
import { parseMessage, parseOrder } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import { readAttempt } from "@/lib/checkout/attempt";
import { strongPassword } from "@/lib/checkout/validation";
import type { AccountDto, ApiProblem, StorefrontMode } from "@/types/api";

const TITLES = { verify: "Confirm email verification", reset: "Choose a new password", claim: "Confirm guest order claim" };

export function EmailAction({ action, mode, account }: { action: Action; mode: StorefrontMode; account?: AccountDto | null }) {
  const router = useRouter();
  const proof = useRef<EmailProof | null>(null);
  const lock = useRef(false);
  const captured = useRef(false);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [validation, setValidation] = useState("");
  const capture = useEffectEvent(() => {
    if (captured.current && !window.location.hash) return;
    captured.current = true;
    proof.current = parseEmailFragment(takeFragment(), action);
    setAvailable(Boolean(proof.current)); setReady(true);
  });
  useEffect(() => {
    const receive = () => capture();
    receive();
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);

  const confirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || !proof.current || mode !== "live" || complete) return;
    // Nothing is consumed by GET or mount. The explicit form confirmation is the action boundary.
    takeFragment();
    if (action === "claim" && (!account || !account.emailVerified)) return;
    if (readAttempt().reference) { setValidation("Resolve the earlier checkout before changing identity or claiming an order."); return; }
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (action === "reset" && (!strongPassword(password) || password !== String(data.get("confirmPassword") ?? ""))) {
      setValidation("Use 10 to 128 characters with uppercase, lowercase, a number and a symbol, and enter the same password twice."); return;
    }
    lock.current = true; setPending(true); setProblem(null); setValidation("");
    try {
      if (action === "claim") {
        const order = await commerceMutation("Account/order-claims/complete", proof.current, parseOrder, { mode, expectedOwner: "account", expectedAccountId: account!.id });
        proof.current = null; setComplete(true); router.replace(`/account/orders/${order.id}`); router.refresh();
      } else {
        await commerceMutation(`Auth/${action}`, { ...proof.current, ...(action === "reset" ? { password } : {}) }, parseMessage, { mode });
        proof.current = null; setComplete(true);
      }
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { lock.current = false; setPending(false); }
  };

  return <section className="mx-auto max-w-lg space-y-5">
    <h1 className="text-2xl font-semibold">{TITLES[action]}</h1>
    <p className="text-sm text-muted-foreground">The link proof is removed from the address bar and kept only in this tab. Opening the page does not confirm an action or sign you in.</p>
    {mode === "mock" ? <p role="status">Email actions are disabled in sample mode.</p> : null}
    {!ready ? <p role="status">Reading the email link...</p> : !available ? <p role="alert" className="text-sm">This email link is missing or invalid. Open a fresh link from your email.</p> : null}
    {problem ? <ErrorNotice problem={problem} heading="Email action unsuccessful" retryable={false} /> : null}
    {validation ? <p role="alert" className="text-sm text-danger">{validation}</p> : null}
    {complete ? <p role="status" className="rounded-xl border bg-success-soft p-3">{action === "verify" ? "Email verified. Sign in to continue." : action === "reset" ? "Password reset. Sign in with your new password." : "The order was claimed by your account."}</p> : null}
    {action === "claim" && (!account || !account.emailVerified) ? <div className="space-y-2"><p className="text-sm">Sign in to a verified matching-email account, then reopen the original claim link. The proof is never carried through a sign-in URL.</p><Link href="/account/login" className="inline-flex min-h-11 items-center font-medium text-brand">Sign in</Link></div> : null}
    <form onSubmit={confirm} className="space-y-4" aria-busy={pending}>
      <fieldset disabled={pending || complete || !ready || !available || mode !== "live" || (action === "claim" && (!account || !account.emailVerified))} className="space-y-4">
        {action === "reset" ? <>
          <Field label="New password" htmlFor="reset-password"><Input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></Field>
          <Field label="Confirm new password" htmlFor="reset-confirm"><Input id="reset-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></Field>
        </> : null}
        {action === "claim" && account ? <p className="text-sm">Claim this order for {account.email}. Matching an email alone does not link orders; this confirmation uses the fresh email proof.</p> : null}
        <Button type="submit" fullWidth>{pending ? "Confirming..." : action === "verify" ? "Confirm verification" : action === "reset" ? "Confirm password reset" : "Confirm claim"}</Button>
      </fieldset>
    </form>
    <nav aria-label="Email link options" className="flex flex-wrap gap-4 text-sm font-medium text-brand">
      <Link href="/account/login" prefetch={false} className="inline-flex min-h-11 items-center">Sign in</Link>
      <Link href={action === "verify" ? "/account/resend" : action === "reset" ? "/account/forgot" : "/account/orders"} prefetch={false} className="inline-flex min-h-11 items-center">{action === "claim" ? "Order history and new claim request" : "Request a fresh email"}</Link>
    </nav>
  </section>;
}
