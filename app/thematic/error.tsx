"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card, PageShell } from "@/app/_components/ui";

/** Must match STORAGE_KEY in app/thematic/page.tsx — the restore this clears. */
const STORAGE_KEY = "uaa_thematic_last_report";

/**
 * Thematic-specific boundary: the page renders reports restored from
 * sessionStorage and the platform cache, so the likeliest render-time throw
 * is a damaged saved report. Recovery therefore offers "discard the saved
 * report and retry", which a generic boundary cannot.
 */
export default function ThematicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell py="py-16">
      <Card padding="lg" className="mx-auto max-w-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-negative" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold tracking-tight">The thematic report failed to render</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              This usually means the saved report is damaged or from an older version. Discarding it
              returns you to the search screen — the analysis itself is cached on the server, so a
              repeat search is still instant.
            </p>
            {error.message && (
              <p className="mt-2 truncate font-mono text-xs text-faint" title={error.message}>
                {error.message}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
                  reset();
                }}
              >
                Discard saved report and retry
              </Button>
              <Button variant="secondary" size="sm" onClick={reset}>
                Just retry
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
