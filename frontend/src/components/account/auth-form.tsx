"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { Field, Input } from "@/components/ui/input";
import { safeNext } from "@/lib/account/links";
import { commerceMutation } from "@/lib/api/client";
import { parseAccount, parseMessage } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import { attemptMemory, readAttempt } from "@/lib/checkout/attempt";
import { strongPassword } from "@/lib/checkout/validation";
import type { ApiProblem, StorefrontMode } from "@/types/api";

type AuthAction = "login" | "register" | "forgot" | "resend";
const TITLES = { login: "Sign in", register: "Create your account", forgot: "Reset your password", resend: "Resend verification email" };
const subscribeAttempt = (notify: () => void) => {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
};

export function AuthForm({ action, mode, next = "/account", staffOnly = false }: { action: AuthAction; mode: StorefrontMode; next?: string; staffOnly?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState("");
  const attempt = useSyncExternalStore(subscribeAttempt, () => mode === "live" && Boolean(readAttempt().reference), () => false);
  const lock = useRef(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || mode !== "live" || (staffOnly && action !== "login")) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();
    setValidation(""); setProblem(null); setMessage("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) { setValidation("Enter a valid email address."); return; }
    if (action === "register" && (name.length < 2 || name.length > 100 || /[\u0000-\u001f]/.test(name))) { setValidation("Enter a name between 2 and 100 characters."); return; }
    if (action === "register" && !strongPassword(password)) { setValidation("Use 10 to 128 characters with uppercase, lowercase, a number and a symbol."); return; }
    const saved = readAttempt().reference;
    const original = saved ? attemptMemory(saved) : undefined;
    if (action === "login" && saved && (saved.ownerKind === "guest" || (original?.ownerKind === "account" && original.payload.contact.email.toLowerCase() !== email.toLowerCase()))) {
      setValidation("Resolve the original checkout before switching to a different account."); return;
    }
    lock.current = true; setPending(true);
    try {
      if (action === "login") {
        const account = await commerceMutation("Auth/login", { email, password }, parseAccount, { mode });
        if (staffOnly && !account.isAdmin) throw new ApiRequestError({ status: 403 });
        const destination = safeNext(next);
        router.replace(staffOnly && destination !== "/admin" && !destination.startsWith("/admin/") ? "/admin" : destination); router.refresh();
      } else {
        await commerceMutation(`Auth/${action}`, action === "register" ? { name, email, password } : { email }, parseMessage, { mode });
        setMessage("If this address is eligible, an email will be sent with the next steps. Open that email to continue.");
        form.reset();
      }
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { lock.current = false; setPending(false); }
  };

  return <section className="mx-auto max-w-lg space-y-5">
    <header className="space-y-2"><p className="bench-strip">{staffOnly ? "Store operations" : "Customer account"}</p><h1 className="text-2xl font-semibold">{staffOnly ? "Staff sign in" : TITLES[action]}</h1><p className="text-sm text-muted-foreground">{staffOnly ? "Only an operator-provisioned staff account can sign in. Customers order as guests without an account." : action === "login" ? "Use your verified email and password. Your account is managed by the store." : action === "register" ? "Verify your email before account checkout or order claims. Registering does not sign you in." : "The response does not disclose whether an account exists."}</p></header>
    {mode === "mock" ? <p role="status">Account actions are disabled in mock mode.</p> : null}
    {attempt && action === "login" ? <p role="status" className="rounded-xl border bg-warning-soft p-3 text-sm">An earlier checkout is unresolved. Restore the same original account only, or <Link href="/checkout" className="font-medium underline">check its receipt</Link>. Signing in will not retry that checkout as a guest.</p> : null}
    {problem ? <ErrorNotice problem={problem} heading="Account request unsuccessful" retryable={false} /> : null}
    {validation ? <p role="alert" className="text-sm text-danger">{validation}</p> : null}
    {message ? <p role="status" className="rounded-xl border bg-success-soft p-3 text-sm">{message}</p> : null}
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      <fieldset disabled={pending || mode !== "live" || (staffOnly && action !== "login")} className="space-y-4">
        {action === "register" ? <Field label="Name" htmlFor="auth-name"><Input id="auth-name" name="name" autoComplete="name" minLength={2} maxLength={100} required /></Field> : null}
        <Field label="Email" htmlFor="auth-email"><Input id="auth-email" name="email" type="email" autoComplete={action === "login" ? "username" : "email"} maxLength={254} required /></Field>
        {action === "login" || action === "register" ? <Field label="Password" htmlFor="auth-password" hint={action === "register" ? "10 to 128 characters, including uppercase, lowercase, a number and a symbol." : undefined}><Input id="auth-password" name="password" type="password" autoComplete={action === "login" ? "current-password" : "new-password"} minLength={action === "register" ? 10 : 1} maxLength={128} required /></Field> : null}
        <Button type="submit" fullWidth>{pending ? "Submitting..." : action === "register" ? "Register and send verification" : action === "forgot" ? "Send password reset email" : action === "resend" ? "Send verification email" : "Sign in"}</Button>
      </fieldset>
    </form>
    {!staffOnly ? <nav aria-label="Account options" className="flex flex-wrap gap-x-5 text-sm font-medium text-brand">
      {action !== "login" ? <Link href="/account/login" prefetch={false} className="inline-flex min-h-11 items-center">Sign in</Link> : null}
      {action !== "register" ? <Link href="/account/register" prefetch={false} className="inline-flex min-h-11 items-center">Create account</Link> : null}
      {action !== "forgot" ? <Link href="/account/forgot" prefetch={false} className="inline-flex min-h-11 items-center">Forgot password</Link> : null}
      {action !== "resend" ? <Link href="/account/resend" prefetch={false} className="inline-flex min-h-11 items-center">Resend verification</Link> : null}
    </nav> : null}
  </section>;
}
