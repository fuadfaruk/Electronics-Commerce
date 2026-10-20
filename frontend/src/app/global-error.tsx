"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
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
  const message = typeof error === "string" ? error : details.message;

  return (
    <html lang="en">
      <head>
        <title>Storefront error</title>
      </head>
      <body style={{ fontFamily: "Arial, sans-serif" }}>
        <main className="mx-auto min-h-dvh max-w-3xl px-4 py-12 sm:py-20">
          <ErrorNotice
            heading="The storefront could not be displayed"
            problem={{
              title: "Unexpected application error",
              detail:
                typeof message === "string" && message.trim()
                  ? message
                  : "An unexpected error occurred while starting the storefront.",
              traceId: typeof details.digest === "string" ? details.digest : undefined,
            }}
            onRetry={retry}
          />
        </main>
      </body>
    </html>
  );
}
