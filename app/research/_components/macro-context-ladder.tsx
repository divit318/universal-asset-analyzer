"use client";

import { useEffect, useState } from "react";
import type { MarketRegime, Recommendation, SectorRotationEntry } from "@/lib/types";

/**
 * Market → Sector → Company regime ladder. Market regime comes from /api/regime
 * — the Scanner's last snapshot when fresh, a live macro/sector computation
 * otherwise (no AI, no Scanner run). Sector regime is the Sector Rotation entry
 * already fetched by SectorContextCard, passed down to avoid a duplicate fetch.
 * Company regime relabels the existing composite recommendation — no new scoring.
 *
 * There is deliberately no separate "industry regime" rung: no data source
 * in this codebase tracks GICS industry-level (as opposed to sector-level)
 * rotation, and fabricating one would violate the no-placeholder-data rule.
 * The industry name is shown as context under the sector rung instead.
 */

const TREND_LABEL: Record<MarketRegime["trend"], { label: string; cls: string }> = {
  "risk-on":  { label: "Risk-On",  cls: "text-positive border-positive/30 bg-positive/8" },
  "risk-off": { label: "Risk-Off", cls: "text-negative border-negative/30 bg-negative/8" },
  neutral:    { label: "Neutral",  cls: "text-warning border-warning/30 bg-warning/8" },
};

const SECTOR_CLASS_STYLE: Record<SectorRotationEntry["classification"], { label: string; cls: string }> = {
  leading:       { label: "Leading",       cls: "text-positive border-positive/30 bg-positive/8" },
  strengthening: { label: "Strengthening", cls: "text-emerald-400 border-emerald-400/30 bg-emerald-400/8" },
  weakening:     { label: "Weakening",     cls: "text-warning border-warning/30 bg-warning/8" },
  lagging:       { label: "Lagging",       cls: "text-negative border-negative/30 bg-negative/8" },
};

const REC_CLASS: Record<Recommendation, { label: string; cls: string }> = {
  STRONG_BUY:  { label: "Expansion", cls: "text-positive border-positive/30 bg-positive/8" },
  BUY:         { label: "Expansion", cls: "text-positive border-positive/30 bg-positive/8" },
  HOLD:        { label: "Stable",    cls: "text-warning border-warning/30 bg-warning/8" },
  SELL:        { label: "Contracting", cls: "text-negative border-negative/30 bg-negative/8" },
  STRONG_SELL: { label: "Contracting", cls: "text-negative border-negative/30 bg-negative/8" },
};

function Rung({ tier, label, cls, detail }: { tier: string; label: string; cls: string; detail?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">{tier}</span>
      <span className={`inline-flex w-fit items-center rounded border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
        {label}
      </span>
      {detail && <span className="text-[10px] text-muted/70">{detail}</span>}
    </div>
  );
}

interface Props {
  sectorEntry: SectorRotationEntry | null;
  industry: string | null | undefined;
  recommendation: Recommendation | null;
}

export function MacroContextLadder({ sectorEntry, industry, recommendation }: Props) {
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/regime")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setRegime(data?.regime ?? null); })
      .catch(() => { /* best-effort */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex gap-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 flex-1 animate-pulse rounded-lg bg-surface-2" />)}
      </div>
    );
  }

  const marketRung = regime
    ? TREND_LABEL[regime.trend]
    : { label: "Unavailable", cls: "text-muted border-border bg-surface-2" };

  const sectorRung = sectorEntry
    ? SECTOR_CLASS_STYLE[sectorEntry.classification]
    : { label: "Unavailable", cls: "text-muted border-border bg-surface-2" };

  const companyRung = recommendation
    ? REC_CLASS[recommendation]
    : { label: "Unavailable", cls: "text-muted border-border bg-surface-2" };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">Macro Context</h3>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Rung
          tier="Market Regime"
          label={marketRung.label}
          cls={marketRung.cls}
          detail={regime ? `${regime.breadthPct != null ? `${Math.round(regime.breadthPct)}% breadth · ` : ""}${regime.dominantSectors.slice(0, 2).join(", ") || "—"}` : undefined}
        />
        <Rung
          tier="Sector Regime"
          label={sectorRung.label}
          cls={sectorRung.cls}
          detail={sectorEntry ? `${sectorEntry.sector} · rank #${sectorEntry.rank}/11${industry ? ` · ${industry}` : ""}` : industry ?? undefined}
        />
        <Rung
          tier="Company Regime"
          label={companyRung.label}
          cls={companyRung.cls}
          detail={recommendation ? `Composite recommendation: ${recommendation.replace("_", " ")}` : undefined}
        />
      </div>
    </div>
  );
}
