"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { Card, Badge } from "@/app/_components/ui";
import { LoadingMark } from "@/app/_components/loading-mark";
import type { PortfolioThesis as Thesis } from "@/lib/portfolio/thesis";

/**
 * The Portfolio Thesis + Identity banner — one AI-generated paragraph plus a
 * handful of persistent identity tags, shown once at the top of the page.
 *
 * Fetched from its OWN endpoint (see app/api/portfolio/thesis/route.ts),
 * independently of the deterministic report — an AI call has no business
 * blocking the dashboard's numbers. Cached server-side by portfolio content
 * hash, so it only regenerates when the holdings actually change.
 */
export function PortfolioThesisBanner({
  enabled,
  refreshSignal,
}: {
  enabled: boolean;
  /** Bump this (e.g. a counter) to force a refetch — used after a trade execution changes the holdings. */
  refreshSignal?: number;
}) {
  const fetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/portfolio/thesis", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio thesis");
    return json as Thesis;
  }, []);

  const { data, error, isInitialLoading, refresh } = useDataset<Thesis>("portfolioThesis", "default", fetcher, { enabled });

  // A brand-new dataset's very first fetch can lose a race with React's
  // dev-mode double-invoke of effects: the synthetic mount->cleanup->mount
  // cycle aborts the in-flight request before it resolves, and the store is
  // left reporting "loading" with nothing actually in flight to end it. A
  // forced refresh bypasses the "already loading" guard and starts a real
  // request, so a component that's still loading after a generous window
  // self-heals instead of showing a skeleton forever.
  const loadingRef = useRef(isInitialLoading);
  useEffect(() => {
    loadingRef.current = isInitialLoading;
  }, [isInitialLoading]);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      if (loadingRef.current) refresh();
    }, 4000);
    return () => clearTimeout(t);
  }, [enabled, refresh]);

  // Holdings changed elsewhere (a trade was executed) — the server-side cache
  // is already keyed by portfolio content hash so it will honestly regenerate,
  // but the client has to be told to ask again; nothing does that automatically.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (refreshSignal != null) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only on refreshSignal changing, not on every `refresh` identity change.
  }, [refreshSignal]);

  if (!enabled) return null;

  // Surfaced separately from the loading state — otherwise a failed fetch
  // (e.g. a transient 503 during a dev rebuild) looks identical to "still
  // loading" forever, since both leave `data` null.
  if (error && !data) {
    return (
      <Card className="flex items-center justify-between gap-3 p-4">
        <p className="text-xs text-muted">Portfolio thesis unavailable right now.</p>
        <button onClick={refresh} className="text-xs text-brand hover:underline">Retry</button>
      </Card>
    );
  }

  // A LABELLED wait, not three grey bars.
  //
  // This is the topmost element on the page and the slowest, because it is the only
  // one that waits on a local language model. Unlabelled skeleton bars sitting there
  // for twenty seconds are indistinguishable from a broken panel — and every
  // deterministic number below has already rendered, so the natural conclusion is
  // that something is stuck. Saying what is being waited for, and that the rest of
  // the page is unaffected, converts a suspected fault into an understood wait.
  if (isInitialLoading || !data) {
    return (
      <Card className="flex items-center gap-2.5 p-4">
        <LoadingMark size={16} label="Generating portfolio thesis" />
        <div className="flex flex-col">
          <span className="text-xs font-medium text-foreground">Reading your portfolio…</span>
          <span className="text-[11px] text-muted/70">
            The AI is writing a thesis and a bear case. Every figure below is already
            final — this runs independently and never blocks them.
          </span>
        </div>
      </Card>
    );
  }

  const hasDetail = data.strengths.length > 0 || data.risks.length > 0 || data.bearCase || data.mustBeTrue;

  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {data.identity.map((tag) => (
          <Badge key={tag} variant="brand">{tag}</Badge>
        ))}
        {data.source === "fallback" && (
          <Badge variant="neutral">Measured facts only — AI offline</Badge>
        )}
      </div>

      <p className="text-sm leading-relaxed text-foreground">{data.thesis}</p>

      {/* ── Scannable, not prose ─────────────────────────────────────────────
          This was one ninety-word paragraph. It contained a genuinely important
          judgement — "reliance on a single asset class and no alternative exposure
          is a key weakness" — in its fourth clause, where nobody scanning a
          dashboard would find it. Analysts scan; they do not read paragraphs on a
          screen they open every morning. Splitting the judgement into labelled
          columns costs nothing and is the difference between the insight being
          delivered and merely being present. */}
      {hasDetail && (
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {data.strengths.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-positive">
                Working
              </span>
              <ul className="flex flex-col gap-1">
                {data.strengths.map((s, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-muted">— {s}</li>
                ))}
              </ul>
            </div>
          )}
          {data.risks.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                Watch
              </span>
              <ul className="flex flex-col gap-1">
                {data.risks.map((r, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-muted">— {r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* The bear case is given its own emphasis because it is the one thing on
          this page arguing AGAINST the portfolio, and a tool that only ever
          agrees with its user is not an analyst. Rendered only when the model had
          something substantive — the prompt permits an empty answer, and a
          manufactured bear case would be worse than none. */}
      {data.bearCase && (
        <div className="flex flex-col gap-1 rounded-lg border border-negative/25 bg-negative/[0.04] p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-negative">
            The case against this portfolio
          </span>
          <p className="text-[11px] leading-relaxed text-muted">{data.bearCase}</p>
        </div>
      )}

      {data.mustBeTrue && (
        <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-surface/40 p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            What has to be true for this to work
          </span>
          <p className="text-[11px] leading-relaxed text-muted">{data.mustBeTrue}</p>
        </div>
      )}

      {/* Provenance, stated once.
          Everything else on this page is arithmetic; this card is a local language
          model's reading of that arithmetic, and the two do not carry the same
          authority. The prompt now hands the model every directional verdict as a
          settled fact precisely because it was observed inverting them — but a 7B
          model can still err, and the honest thing is to say which panel is
          measured and which is interpreted rather than letting the visual
          consistency imply they are the same kind of claim. */}
      {data.source === "ai" && (
        <p className="text-[10px] leading-relaxed text-muted/50">
          Written by the AI from the measured figures on this page. Interpretation,
          not measurement — where it and a panel below disagree, the panel is right.
        </p>
      )}
    </Card>
  );
}
