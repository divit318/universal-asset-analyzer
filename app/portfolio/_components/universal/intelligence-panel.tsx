"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { Card, Badge } from "@/app/_components/ui";
import { LoadingMark } from "@/app/_components/loading-mark";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { formatDate } from "@/lib/format";
import type {
  EvidenceLine,
  FindingExplore,
  IntelligenceFinding,
  PortfolioIntelligence,
  WhatChanged,
} from "@/lib/portfolio/intelligence/types";

/**
 * The Intelligence tab — the portfolio critic.
 *
 * Everything ranked and quantified here was computed deterministically
 * (lib/portfolio/intelligence/detectors.ts); only the executive summary and the
 * cross-currents line are AI-written, and both are labelled as interpretation.
 * Fetched from its own endpoint independently of the report — an AI call has no
 * business blocking the page's numbers.
 */
export function IntelligencePanel({
  enabled,
  refreshSignal,
}: {
  enabled: boolean;
  /** Bump to force a refetch — used after a trade execution changes the holdings. */
  refreshSignal?: number;
}) {
  const fetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/portfolio/intelligence", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio intelligence");
    return json as PortfolioIntelligence;
  }, []);

  const { data, error, isInitialLoading, refresh } = useDataset<PortfolioIntelligence>(
    "portfolioIntelligence",
    "default",
    fetcher,
    { enabled },
  );

  // Same self-heal as the thesis banner: a dev-mode double-mount can abort the
  // very first request and strand the store in "loading" forever.
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

  if (error && !data) {
    return (
      <Card className="flex items-center justify-between gap-3 p-4">
        <p className="text-xs text-muted">Portfolio intelligence unavailable right now.</p>
        <button onClick={refresh} className="text-xs text-brand hover:underline">
          Retry
        </button>
      </Card>
    );
  }

  if (isInitialLoading || !data) {
    return (
      <Card className="flex items-center gap-2.5 p-4">
        <LoadingMark size={16} label="Analyzing portfolio structure" />
        <div className="flex flex-col">
          <span className="text-xs font-medium text-foreground">Reading the portfolio as a system…</span>
          <span className="text-[11px] text-muted/70">
            Looking through fund constituents, cross-holding correlations and position
            history for what the holdings list doesn&apos;t show. Every figure in the
            findings is computed, not generated.
          </span>
        </div>
      </Card>
    );
  }

  const headlineCount = data.findings.filter((f) => f.severity !== "low").length;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Executive summary ─────────────────────────────────────────── */}
      <Card className="flex flex-col gap-3 border-brand/30 bg-brand/[0.04] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-brand">
            {data.allClear
              ? "Portfolio intelligence — nothing material detected"
              : `Portfolio intelligence — ${headlineCount > 0 ? headlineCount : data.findings.length} ${(headlineCount > 0 ? headlineCount : data.findings.length) === 1 ? "thing" : "things"} you may be missing`}
          </span>
          {data.source === "fallback" && <Badge variant="neutral">Measured facts only — AI offline</Badge>}
          {data.source === "measured" && <Badge variant="positive">Measured</Badge>}
        </div>
        <p className="text-sm leading-relaxed text-foreground">{data.executiveSummary}</p>
        {data.crossCurrents && (
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-surface/40 p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
              Across the findings
            </span>
            <p className="text-[11px] leading-relaxed text-muted">{data.crossCurrents}</p>
          </div>
        )}
        {data.source === "ai" && (
          <p className="text-[10px] leading-relaxed text-muted/50">
            Summary written by the AI from the settled findings below. Interpretation, not
            measurement — every figure and severity was computed before the AI saw it.
          </p>
        )}
      </Card>

      {/* ── What changed ──────────────────────────────────────────────── */}
      <WhatChangedCard whatChanged={data.whatChanged} onRerun={refresh} />

      {/* ── Findings, most consequential first ────────────────────────── */}
      {data.findings.map((f, i) => (
        <FindingCard key={f.id} finding={f} priority={i + 1} />
      ))}

      {/* ── Coverage disclosure ───────────────────────────────────────── */}
      {data.coverage.fundsOpaque.length > 0 && (
        <Card className="flex flex-col gap-1 border-border bg-surface/40 p-3.5">
          <span className="text-[11px] font-semibold text-foreground">
            Look-through coverage: {data.coverage.lookThroughPct}% of fund-held value
          </span>
          <p className="text-[11px] leading-relaxed text-muted">
            No constituent data is available for{" "}
            <strong className="text-foreground">{data.coverage.fundsOpaque.join(", ")}</strong>, so
            the findings above could not see inside {data.coverage.fundsOpaque.length === 1 ? "it" : "them"}.
            Exposure through {data.coverage.fundsOpaque.length === 1 ? "that fund" : "those funds"} is
            unknown — not zero — and no finding was invented to fill the gap.
          </p>
        </Card>
      )}
    </div>
  );
}

/* ────────────────────────── What changed ────────────────────────── */

function WhatChangedCard({ whatChanged: wc, onRerun }: { whatChanged: WhatChanged; onRerun: () => void }) {
  const rows: { label: string; text: string }[] = [];
  if (wc.holdingsAdded.length > 0) rows.push({ label: "Added", text: wc.holdingsAdded.join(", ") });
  if (wc.holdingsRemoved.length > 0) rows.push({ label: "Removed", text: wc.holdingsRemoved.join(", ") });
  if (wc.resized.length > 0) {
    rows.push({
      label: "Resized",
      text: wc.resized.map((r) => `${r.label} ${r.fromPct.toFixed(1)}% → ${r.toPct.toFixed(1)}%`).join(", "),
    });
  }
  if (wc.newFindings.length > 0) rows.push({ label: "New findings", text: wc.newFindings.join(" · ") });
  if (wc.resolvedFindings.length > 0) rows.push({ label: "Resolved", text: wc.resolvedFindings.join(" · ") });

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/70">
          What changed in the portfolio
        </span>
        {wc.since && (
          <span className="text-[10px] text-muted/60">since {formatDate(wc.since)}</span>
        )}
      </div>
      {wc.baselineMethodologyStale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <span className="text-[11px] leading-relaxed text-warning">
            The baseline this diff compares against was produced under an older scoring
            methodology — treat the &quot;since&quot; comparison as approximate.
          </span>
          <button onClick={onRerun} className="shrink-0 text-[11px] font-semibold text-warning hover:underline">
            Rerun analysis
          </button>
        </div>
      )}
      {wc.since == null ? (
        <p className="text-[11px] leading-relaxed text-muted">
          First analysis — this run is the baseline. From now on, every run reports the
          holdings that changed and the findings that appeared or resolved since the last one.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted">
          Nothing has changed — no holdings added, removed or materially resized, and no
          finding has appeared or resolved since the last analysis.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.label} className="text-[11px] leading-relaxed text-muted">
              <strong className="text-foreground">{r.label}: </strong>
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ────────────────────────── Finding card ────────────────────────── */

const SEVERITY_BADGE: Record<IntelligenceFinding["severity"], { variant: "negative" | "warning" | "neutral"; label: string }> = {
  high: { variant: "negative", label: "High" },
  medium: { variant: "warning", label: "Medium" },
  low: { variant: "neutral", label: "Low" },
};

const BASIS_LABEL: Record<EvidenceLine["basis"], string> = {
  observed: "Observed",
  derived: "Derived",
};

/**
 * Where a finding's proof can be DRAWN. Every detector may declare an Exposure
 * view (`explore`) that shows exactly why its finding is true — the type
 * existed here since the Exposure rebuild but this panel never rendered it, so
 * findings ended in prose when a picture of the actual routes was one link
 * away. An issuer trace deep-links straight to that trace; the other views
 * land on /exposure, whose findings rail carries this same finding with its
 * "show me exactly why" navigation.
 */
function exploreHref(explore: FindingExplore): string {
  return explore.kind === "trace"
    ? `/exposure?issuer=${encodeURIComponent(explore.target)}`
    : "/exposure";
}

function FindingCard({ finding: f, priority }: { finding: IntelligenceFinding; priority: number }) {
  const tone = SEVERITY_BADGE[f.severity];
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-mono text-[11px] font-bold tabular-nums text-muted">
            {priority}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={tone.variant}>{tone.label}</Badge>
              <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{f.headline}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {f.weightPct != null && (
            <span
              className="cursor-help font-mono text-[11px] tabular-nums text-muted/70 underline decoration-dotted decoration-muted/30 underline-offset-2"
              title="Share of portfolio value implicated by this finding"
            >
              {f.weightPct.toFixed(1)}% involved
            </span>
          )}
          {f.explore && (
            <Link
              href={exploreHref(f.explore)}
              className="rounded-sm text-[11px] font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              See it drawn in Exposure →
            </Link>
          )}
        </div>
      </div>

      <CollapsibleSection title="Evidence & reasoning" subtitle="Every line labelled: observed from data, or derived from it">
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1.5">
            {f.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-px shrink-0 rounded-full border border-border bg-surface-3 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-muted">
                  {BASIS_LABEL[e.basis]}
                </span>
                <span className="text-[11px] leading-relaxed text-muted">{e.text}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
              Why this matters
            </span>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{f.whyItMatters}</p>
          </div>

          {f.blindSpot && (
            <div className="rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                Possible blind spot
              </span>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{f.blindSpot}</p>
            </div>
          )}

          {f.caveat && (
            <p className="text-[10px] leading-relaxed text-muted/60">{f.caveat}</p>
          )}
        </div>
      </CollapsibleSection>
    </Card>
  );
}
