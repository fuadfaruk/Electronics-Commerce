"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { AlertIcon } from "@/components/ui/icons";
import type { ApiProblem } from "@/types/api";

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
    >
      {pending ? "Trying again..." : "Try again"}
    </Button>
  );
}

export function ErrorNotice({
  problem,
  heading = "This content could not be loaded",
  onRetry,
}: {
  problem: ApiProblem;
  heading?: string;
  onRetry?: () => void;
}) {
  return (
    <section
      role="alert"
      aria-label={heading}
      className="min-w-0 space-y-4 rounded-2xl border border-danger/30 bg-surface p-4 sm:p-6"
    >
      <header className="flex items-start gap-3">
        <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold sm:text-lg">{heading}</h2>
          <p className="break-words text-sm font-medium text-danger">
            {problem.title}
            {problem.status !== undefined ? ` (HTTP ${problem.status})` : ""}
          </p>
        </div>
      </header>

      <p className="break-words text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {problem.detail}
      </p>

      {problem.errors && Object.keys(problem.errors).length > 0 ? (
        <ul className="space-y-1 text-sm">
          {Object.entries(problem.errors).map(([field, messages]) => (
            <li key={field} className="break-words">
              <span className="font-medium">{field}: </span>
              {messages.join(" ")}
            </li>
          ))}
        </ul>
      ) : null}

      {problem.url || problem.cause || problem.traceId || problem.type ? (
        <dl className="space-y-2 rounded-xl border border-border bg-surface-muted p-3 text-xs">
          {problem.url ? (
            <div>
              <dt className="font-medium">Request</dt>
              <dd className="mt-0.5 font-mono break-all">
                {problem.method ?? "GET"} {problem.url}
              </dd>
            </div>
          ) : null}
          {problem.cause ? (
            <div>
              <dt className="font-medium">Cause</dt>
              <dd className="mt-0.5 break-words">{problem.cause}</dd>
            </div>
          ) : null}
          {problem.traceId ? (
            <div>
              <dt className="font-medium">Error reference / trace ID</dt>
              <dd className="mt-0.5 font-mono break-all">{problem.traceId}</dd>
            </div>
          ) : null}
          {problem.type ? (
            <div>
              <dt className="font-medium">Problem type</dt>
              <dd className="mt-0.5 font-mono break-all">{problem.type}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {onRetry ? <Button onClick={onRetry}>Try again</Button> : <RefreshButton />}
        {/* <Link href="/" className={buttonStyles({ variant: "secondary" })}>
          Go home
        </Link> */}
      </div>
    </section>
  );
}
