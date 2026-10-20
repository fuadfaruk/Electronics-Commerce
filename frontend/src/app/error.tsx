"use client";

import { ErrorNotice } from "@/components/ui/error-notice";

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
  const message = typeof error === "string" ? error : details.message;

  return (
    <ErrorNotice
      heading="This page could not be displayed"
      problem={{
        title: "Unexpected page error",
        detail:
          typeof message === "string" && message.trim()
            ? message
            : "An unexpected error occurred while displaying this page.",
        traceId: typeof details.digest === "string" ? details.digest : undefined,
      }}
      onRetry={retry}
    />
  );
}
