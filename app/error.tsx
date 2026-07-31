"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card, PageShell } from "@/app/_components/ui";

/**
 * App-wide render-error boundary.
 *
 * Every page in UAA renders data that outlives the code that wrote it —
 * platform-cache rows, sessionStorage restores, AI output — so render-time
 * surprises are a matter of when, not if. Without this file a throw fell
 * through to Next's default output: a blank page with no retry affordance.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell py="py-16">
      <Card padding="lg" className="mx-auto max-w-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-negative" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold tracking-tight">This page failed to render</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              The rest of the app is unaffected. Retrying re-renders with the same data; if that
              fails again, the data behind this page is likely damaged and a reload starts clean.
            </p>
            {error.message && (
              <p className="mt-2 truncate font-mono text-xs text-faint" title={error.message}>
                {error.message}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button variant="primary" size="sm" onClick={reset}>
                Try again
              </Button>
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
