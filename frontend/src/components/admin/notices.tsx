"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import type { AdminFailure } from "./server";
import type { ApiProblem } from "@/types/api";

export function ReloadAdmin({ label = "Reload current record", onReload }: { label?: string; onReload?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => startTransition(() => { if (onReload) onReload(); else router.refresh(); })}>
      {pending ? "Reloading..." : label}
    </Button>
  );
}

export function AdminAccessNotice({ failure, returnTo = "/admin" }: { failure: AdminFailure; returnTo?: string }) {
  const copy = {
    mock: { title: "Staff tools require the live store", detail: "Demo browsing does not connect to staff accounts or allow catalog, stock or order changes." },
    unauthenticated: { title: "Sign in with your staff account", detail: "Your session is missing or has expired. Only an operator-provisioned admin account can use this workspace." },
    forbidden: { title: "Staff access required", detail: "This account does not have current admin access. Staff accounts are provisioned by the operator; there is no public staff signup or role management." },
    error: { title: "Current staff data could not be loaded", detail: "The store service could not return a verified staff response. No cached private records are used as a fallback." },
  }[failure.reason];
  return (
    <section role="alert" className="space-y-4 rounded-2xl border border-border-strong bg-white/80 p-5">
      <h1 className="text-xl font-semibold">{copy.title}</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.detail}</p>
      {failure.reason === "error" && failure.problem ? <p className="text-xs text-muted-foreground">{failure.problem.title} (HTTP {failure.problem.status}) <span className="font-mono">{failure.problem.code}</span></p> : null}
      {failure.problem?.traceId ? <p className="break-all font-mono text-xs text-muted-foreground">Error reference: {failure.problem.traceId}</p> : null}
      <div className="flex flex-wrap gap-2">
        {failure.reason === "unauthenticated" || failure.reason === "forbidden" ? <Link href={`/account/login?next=${encodeURIComponent(returnTo)}`} className={buttonStyles()}>Staff sign in</Link> : null}
        {failure.reason !== "mock" ? <ReloadAdmin label="Check access again" /> : null}
        <Link href="/" className={buttonStyles({ variant: "ghost" })}>Storefront</Link>
      </div>
    </section>
  );
}

export function MutationNotice({ problem, message, onReload, uncertain = false }: { problem?: ApiProblem | null; message?: string | null; onReload?: () => void; uncertain?: boolean }) {
  if (!problem && !message) return null;
  const conflict = problem?.status === 409;
  const denied = problem?.status === 401 || problem?.status === 403;
  return (
    <div role="alert" className="space-y-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
      <p className="font-semibold text-danger">{conflict ? "This record changed or the action is no longer allowed (409)." : denied ? "Your staff session is no longer authorized." : "The change could not be confirmed."}</p>
      <p className="leading-relaxed">{message ?? (conflict ? "Reload the current version and review its state before submitting a new change. Nothing will be overwritten automatically." : denied ? "Sign in again and reload this record before making another change." : problem?.detail ?? "The service did not confirm the result. Review this record before trying again.")}</p>
      {problem?.code ? <p className="break-words font-mono text-xs text-muted-foreground">Code: {problem.code}</p> : null}
      {problem?.traceId ? <p className="break-all font-mono text-xs text-muted-foreground">Error reference: {problem.traceId}</p> : null}
      {uncertain && !conflict && !denied ? <p className="leading-relaxed">The request may already have been applied. Use the retry button to send the exact same command with its original idempotency key. Do not create a second adjustment or repeat cash collection.</p> : null}
      {conflict || denied ? <ReloadAdmin onReload={onReload} /> : null}
    </div>
  );
}
