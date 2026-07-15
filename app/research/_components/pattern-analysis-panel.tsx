"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Newspaper, Bot, FileText, LineChart, BarChart3, X } from "lucide-react";
import { Badge, Button } from "@/app/_components/ui";
import { formatDate } from "@/lib/format";
import {
  computePatternStats,
  defaultPatternInsight,
  type TechnicalSignal,
} from "@/lib/pattern-signals";
import type { HistoryPoint, NewsItem } from "@/lib/types";

export interface AskAIPayload {
  question: string;
  action?: string;
  label: string;
}

export interface PatternAnalysisPanelProps {
  signal: TechnicalSignal;
  symbol: string;
  points: HistoryPoint[]; // full history, for computePatternStats
  allSignals: TechnicalSignal[]; // full, absolute-indexed — for historical stats across all history
  news?: NewsItem[];
  period: string; // current timeframe label, read-only display
  onClose: () => void;
  onAskAI: (payload: AskAIPayload) => void;
  onOpenTechnical: () => void;
}

const DIRECTION_VARIANT = {
  bullish: "positive",
  bearish: "negative",
  neutral: "neutral",
} as const;

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

export function PatternAnalysisPanel({
  signal,
  symbol,
  points,
  allSignals,
  news,
  period,
  onClose,
  onAskAI,
  onOpenTechnical,
}: PatternAnalysisPanelProps) {
  const [insight, setInsight] = useState(() => defaultPatternInsight(signal));
  const [insightSource, setInsightSource] = useState<"fallback" | "ai">("fallback");
  const [newsOpen, setNewsOpen] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  // "Why it matters" — instant deterministic sentence, replaced in place by the
  // on-demand AI call for THIS signal only. Never fires in a loop, never on
  // page load. Silent fallback on error/timeout — this is an enrichment, not
  // a critical path.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setInsight(defaultPatternInsight(signal));
    setInsightSource("fallback");
    /* eslint-enable react-hooks/set-state-in-effect */

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 12_000);

    fetch("/api/ai/pattern-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, signal }),
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { insight?: string } | null) => {
        if (json?.insight) {
          setInsight(json.insight);
          setInsightSource("ai");
        }
      })
      .catch(() => { /* keep the deterministic fallback */ })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, signal.name, signal.date]);

  const relatedNews = useMemo(
    () => (news ?? []).filter((n) => daysBetween(n.publishedAt, signal.date) <= 5).slice(0, 5),
    [news, signal.date],
  );

  const stats = useMemo(
    () => computePatternStats(signal.name, allSignals, points, 5),
    [signal.name, allSignals, points],
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{signal.name}</span>
          <Badge variant={DIRECTION_VARIANT[signal.direction]}>{signal.direction}</Badge>
          <span className="text-xs text-muted">Confidence <span className="font-mono font-medium text-foreground">{signal.confidence}%</span></span>
          <span className="text-xs text-muted">{formatDate(signal.date)}</span>
          <span className="text-xs text-muted">{period}</span>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* ── Why it matters ───────────────────────────────────────────────── */}
      <p className="text-xs leading-relaxed text-muted">
        {insight}
        {insightSource === "fallback" && (
          <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-brand/50 align-middle" title="Refining with AI…" />
        )}
      </p>

      {/* ── Key confirmations ────────────────────────────────────────────── */}
      {signal.confirmations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-micro font-semibold uppercase tracking-widest text-faint">Key confirmations</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {signal.confirmations.map((c) => (
              <span key={c.label} className="flex items-center gap-1.5 text-xs text-muted">
                <span className="text-positive">✓</span> {c.label}
                <span className="text-faint">({c.detail})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="secondary" onClick={() => setNewsOpen((v) => !v)}>
          <Newspaper className="h-3.5 w-3.5" strokeWidth={1.75} /> Related News
        </Button>
        <Button
          size="xs"
          variant="secondary"
          onClick={() =>
            onAskAI({
              question: `Explain why the ${signal.name} pattern that formed on ${formatDate(signal.date)} occurred, and what it suggests going forward.`,
              label: `Explain: ${signal.name}`,
            })
          }
        >
          <Bot className="h-3.5 w-3.5" strokeWidth={1.75} /> Ask AI
        </Button>
        <Button size="xs" variant="secondary" disabled title="You're already here">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.75} /> Company Research
        </Button>
        <Button size="xs" variant="secondary" onClick={onOpenTechnical}>
          <LineChart className="h-3.5 w-3.5" strokeWidth={1.75} /> Technical Analysis
        </Button>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => {
            setStatsExpanded(true);
            requestAnimationFrame(() => statsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
          }}
        >
          <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.75} /> Historical Similar Setups
        </Button>
      </div>

      {/* ── Related news (inline expand) ─────────────────────────────────── */}
      {newsOpen && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
          <p className="text-micro font-semibold uppercase tracking-widest text-faint">
            News within 5 days of {formatDate(signal.date)}
          </p>
          {relatedNews.length === 0 ? (
            <p className="text-xs text-muted">No news found in this window.</p>
          ) : (
            relatedNews.map((n) => (
              <a
                key={n.url}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-0.5 rounded px-1 py-1 hover:bg-surface-2"
              >
                <span className="text-xs font-medium text-foreground">{n.headline}</span>
                <span className="text-micro text-faint">{n.source} · {formatDate(n.publishedAt)}</span>
              </a>
            ))
          )}
        </div>
      )}

      {/* ── Historical Similar Setups ─────────────────────────────────────── */}
      <div ref={statsRef} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
        <p className="text-micro font-semibold uppercase tracking-widest text-faint">Historical Similar Setups</p>
        {stats.occurrences === 0 ? (
          <p className="text-xs text-muted">Not enough history to establish a base rate for this pattern.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCell label="Occurrences" value={String(stats.occurrences)} />
              <StatCell label="Bullish %" value={`${stats.bullishPct.toFixed(0)}%`} tone="positive" />
              <StatCell label="Bearish %" value={`${stats.bearishPct.toFixed(0)}%`} tone="negative" />
              <StatCell
                label="Avg Return (5d)"
                value={`${stats.avgReturnPct >= 0 ? "+" : ""}${stats.avgReturnPct.toFixed(1)}%`}
                tone={stats.avgReturnPct >= 0 ? "positive" : "negative"}
              />
            </div>
            <button
              onClick={() => setStatsExpanded((v) => !v)}
              className="self-start text-xs font-medium text-brand hover:underline"
            >
              {statsExpanded ? "View less" : "View more"}
            </button>
            {statsExpanded && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="grid grid-cols-3 gap-3">
                  {stats.extended.map((h) => (
                    <StatCell
                      key={h.horizonDays}
                      label={`${h.horizonDays}d win rate`}
                      value={`${h.winRatePct.toFixed(0)}%`}
                      sublabel={`${h.avgReturnPct >= 0 ? "+" : ""}${h.avgReturnPct.toFixed(1)}% avg`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  {stats.best && (
                    <span className="text-muted">
                      Best: <span className="font-mono text-positive">+{stats.best.returnPct.toFixed(1)}%</span> ({formatDate(stats.best.date)})
                    </span>
                  )}
                  {stats.worst && (
                    <span className="text-muted">
                      Worst: <span className="font-mono text-negative">{stats.worst.returnPct.toFixed(1)}%</span> ({formatDate(stats.worst.date)})
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-micro text-faint">{label}</span>
      <span className={`font-mono text-sm font-semibold ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground"}`}>
        {value}
      </span>
      {sublabel && <span className="text-micro text-faint">{sublabel}</span>}
    </div>
  );
}
