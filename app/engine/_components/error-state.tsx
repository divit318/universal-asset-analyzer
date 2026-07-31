/**
 * Desk error state — the one way a failure is allowed to look on this page.
 *
 * Raw Python tracebacks are never primary content: `describeEngineError` reduces
 * whatever the subprocess produced to one plain-language line, and the raw dump
 * is demoted to a collapsed "Technical details" disclosure for debugging. Every
 * error on the desk — a failed section, a failed run, a failed validation —
 * renders through this so the treatment is identical everywhere.
 */

"use client";

import { Button } from "@/app/_components/ui";
import { describeEngineError } from "@/lib/engine-desk";

export function EngineErrorState({
  title,
  error,
  onRetry,
  retryLabel = "Retry",
}: {
  /** Optional bold lead-in, e.g. "Couldn't load the scorecard". */
  title?: string;
  /** The raw error text — traceback, stderr, or route-authored prose. */
  error: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { summary, detail } = describeEngineError(error);

  return (
    <div
      role="alert"
      className="flex flex-col gap-2.5 rounded-card border border-negative/30 bg-negative/5 px-4 py-3.5"
    >
      <div className="flex flex-col gap-1">
        {title && <p className="text-sm font-semibold text-negative">{title}</p>}
        <p className="text-sm leading-relaxed text-negative/90">{summary}</p>
      </div>

      {detail && (
        <details className="group">
          <summary className="cursor-pointer select-none text-label font-medium uppercase tracking-widest text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
            Technical details
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control border border-border bg-surface p-3 font-mono text-caption leading-relaxed text-muted">
            {detail}
          </pre>
        </details>
      )}

      {onRetry && (
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
