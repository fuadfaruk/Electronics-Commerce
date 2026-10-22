"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
import { safeProblem } from "@/lib/api/errors";

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const details =
    error && typeof error === "object"
      ? (error as { message?: unknown; digest?: unknown })
      : {};

  return (
    <ErrorNotice
      heading="This page could not be displayed"
      problem={safeProblem(503, undefined, details.digest)}
      onRetry={retry}
    />
  );
}
