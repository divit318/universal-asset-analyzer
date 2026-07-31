"use client";

// Last-resort error boundary: only renders when the root layout itself
// throws, so it must provide its own <html>/<body>. Its real job is the
// Sentry.captureException call — render errors never hit a route handler's
// try/catch or onRequestError, so without this they would be invisible to
// the Sentry → GitHub issue → Devin triage loop (docs/devin-integration.md).
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          An unexpected error crashed this page. It has been recorded
          {error.digest ? ` (digest ${error.digest})` : ""}.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
