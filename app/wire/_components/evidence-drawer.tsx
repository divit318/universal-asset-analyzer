"use client";

import { useEffect, useState } from "react";
import type { EvidenceArticle, EvidenceRequest } from "@/lib/wire/evidence";
import { relativeAge } from "@/lib/provenance";

/**
 * Evidence drawer — every insight on The Wire reaches its source articles in
 * one click. Replaces the standalone Source Explorer: instead of one global
 * list to rummage through, each card opens exactly its own evidence.
 *
 * Honesty rules:
 *   - The count in the header is of RESOLVED articles; ids that no longer
 *     resolve (stale cached payloads) are simply absent, not invented.
 *   - An approximate join (risk alerts — no pipeline-recorded linkage yet)
 *     says so in plain text; it is never presented as a recorded citation.
 */
export function EvidenceDrawer({
  request,
  articles,
  onClose,
}: {
  request: EvidenceRequest;
  articles: EvidenceArticle[];
  onClose: () => void;
}) {
  // Captured at open — relative ages inside are static for the drawer's life.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm" onClick={onClose} aria-hidden />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label={`Evidence for ${request.title}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-popover animate-menu-drop"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">
              Evidence · {articles.length} article{articles.length === 1 ? "" : "s"}
            </span>
            <h2 className="text-sm font-semibold leading-5">{request.title}</h2>
            {request.approximate && (
              <p className="text-[11px] leading-4 text-warning">
                Approximate — matched by shared sector/ticker, not a pipeline-recorded link.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close evidence drawer"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {articles.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">
              None of this insight&apos;s source articles are present in the current payload —
              likely a scan cached before evidence linking existed. Run a fresh scan to restore them.
            </p>
          ) : (
            <ul>
              {articles.map((a) => (
                <li key={a.storyId} className="border-b border-border last:border-b-0">
                  <div className="flex flex-col gap-1 px-5 py-3">
                    <a
                      href={a.url || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] leading-5 text-foreground hover:text-accent hover:underline"
                    >
                      {a.headline}
                    </a>
                    <div className="flex items-center gap-2 text-[11px] text-muted/70">
                      <span>{a.source}</span>
                      {a.publishedAt && (
                        <>
                          <span>·</span>
                          <span title={new Date(a.publishedAt).toLocaleString()}>
                            {relativeAge(Math.max(0, openedAt - new Date(a.publishedAt).getTime()))}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
