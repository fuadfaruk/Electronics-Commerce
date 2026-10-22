"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
import { safeProblem } from "@/lib/api/errors";
import "./globals.css";

export default function GlobalError({
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
    <html lang="en">
      <head>
        <title>Storefront error</title>
      </head>
      <body style={{ fontFamily: "Arial, sans-serif" }}>
        <main className="mx-auto min-h-dvh max-w-3xl px-4 py-12 sm:py-20">
          <ErrorNotice
            heading="The storefront could not be displayed"
            problem={safeProblem(503, undefined, details.digest)}
            onRetry={retry}
          />
        </main>
      </body>
    </html>
  );
}
