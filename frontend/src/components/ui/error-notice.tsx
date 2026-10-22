"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { AlertIcon } from "@/components/ui/icons";
import type { ApiProblem } from "@/types/api";
import { safeProblem } from "@/lib/api/errors";

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
  problem: incoming,
  heading = "This content could not be loaded",
  onRetry,
  retryable = true,
}: {
  problem: ApiProblem;
  heading?: string;
  onRetry?: () => void;
  retryable?: boolean;
}) {
  const problem = safeProblem(incoming.status, incoming.code, incoming.traceId);
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

      <p className="text-xs font-mono text-muted-foreground">{problem.code}</p>
      {problem.traceId ? (
        <dl className="space-y-2 rounded-xl border border-border bg-surface-muted p-3 text-xs">
          {problem.traceId ? (
            <div>
              <dt className="font-medium">Error reference / trace ID</dt>
              <dd className="mt-0.5 font-mono break-all">{problem.traceId}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {retryable ? <div className="flex flex-wrap gap-2">
        {onRetry ? <Button onClick={onRetry}>Try again</Button> : <RefreshButton />}
      </div> : null}
    </section>
  );
}
