"use client";

import { useEffect, useState } from "react";
import type { MovementDriver, MovementExplanation } from "@/lib/types";
import { Skeleton, SkeletonText } from "./ui/skeleton";

const PERSISTENCE_LABEL: Record<MovementExplanation["persistence"], string> = {
  transient: "Likely transient",
  "short-term": "Short-term effect",
  durable: "Durable driver",
};

const DIR_DOT: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "bg-positive",
  bearish: "bg-negative",
  neutral: "bg-muted/50",
};

/**
 * Groups the engine's driver categories (lib/movement-explainer.ts's schema:
 * earnings|analyst|macro|sector|valuation|news|technical|volume|sentiment|
 * other) into the 4 contribution buckets called for by the spec — a display
 * transform only, no new driver taxonomy.
 */
type ContributionGroup = "Macro" | "Sector" | "Company-Specific" | "News";
const GROUP_FOR: Record<MovementDriver["category"], ContributionGroup> = {
  macro: "Macro",
  sector: "Sector",
  news: "News",
  earnings: "Company-Specific",
  analyst: "Company-Specific",
  valuation: "Company-Specific",
  technical: "Company-Specific",
  volume: "Company-Specific",
  sentiment: "Company-Specific",
  other: "Company-Specific",
};
const GROUP_ORDER: ContributionGroup[] = ["Macro", "Sector", "Company-Specific", "News"];

function groupDrivers(drivers: MovementDriver[]): { group: ContributionGroup; drivers: MovementDriver[] }[] {
  return GROUP_ORDER
    .map((group) => ({ group, drivers: drivers.filter((d) => GROUP_FOR[d.category] === group) }))
    .filter((g) => g.drivers.length > 0);
}

/**
 * Explain Every Movement. Defaults to the original click-to-reveal button —
 * several callers (Portfolio's live Decision Queue in actions-tab.tsx renders
 * one of these per recommendation, unconditionally) would otherwise fire N
 * parallel Ollama calls on every page load. Pass `autoLoad` to switch to
 * "instead of a button, display" behavior — used by Research, where the spec
 * calls for it and there's only ever one instance on the page.
 */
export function MovementExplainerCard({
  symbol,
  sector,
  autoLoad = false,
  onLoaded,
}: {
  symbol: string;
  sector?: string | null;
  autoLoad?: boolean;
  /** Lets a parent (e.g. WhyNowCard) reuse the top driver without a second fetch. */
  onLoaded?: (explanation: MovementExplanation | null) => void;
}) {
  const [trackedSymbol, setTrackedSymbol] = useState(symbol);
  const [explanation, setExplanation] = useState<MovementExplanation | null>(null);
  const [loading, setLoading] = useState(autoLoad);
  const [opened, setOpened] = useState(autoLoad);

  // Reset when the symbol changes — adjusted during render, not in an effect,
  // to avoid the cascading-render pattern (react.dev "You Might Not Need an Effect").
  if (symbol !== trackedSymbol) {
    setTrackedSymbol(symbol);
    setExplanation(null);
    setOpened(autoLoad);
  }

  useEffect(() => {
    if (!autoLoad) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setExplanation(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    const params = new URLSearchParams({ kind: "symbol", subject: symbol });
    if (sector) params.set("sector", sector);
    void fetch(`/api/movement?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const exp = data?.explanation ?? null;
        setExplanation(exp);
        onLoaded?.(exp);
      })
      .catch(() => { if (!cancelled) { setExplanation(null); onLoaded?.(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, sector, autoLoad]);

  async function load() {
    setOpened(true);
    if (explanation) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind: "symbol", subject: symbol });
      if (sector) params.set("sector", sector);
      const res = await fetch(`/api/movement?${params.toString()}`);
      const data = await res.json();
      const exp = data.explanation ?? null;
      setExplanation(exp);
      onLoaded?.(exp);
    } catch {
      setExplanation(null);
      onLoaded?.(null);
    } finally {
      setLoading(false);
    }
  }

  if (!opened) {
    return (
      <button
        type="button"
        onClick={load}
        className="self-start rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground"
      >
        Why did {symbol} move?
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton height="h-3" width="w-1/3" />
        <SkeletonText lines={2} />
      </div>
    );
  }

  if (!explanation) {
    return autoLoad ? null : (
      <div className="rounded-lg border border-border bg-surface p-4 text-xs text-muted">
        Unable to explain this movement right now.
      </div>
    );
  }

  const groups = groupDrivers(explanation.drivers);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Why did {symbol} move?</h3>
        <div className="flex items-center gap-2 text-[10px] text-muted/70">
          <span>{PERSISTENCE_LABEL[explanation.persistence]}</span>
          <span className="rounded-full border border-border px-2 py-0.5 font-mono">
            {explanation.confidence}% confidence
          </span>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{explanation.summary}</p>
      {groups.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map(({ group, drivers }) => (
            <div key={group} className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">{group}</span>
              <ul className="flex flex-col gap-1.5">
                {drivers.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DIR_DOT[d.direction]}`} />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-foreground">{d.description}</span>
                      <span className="text-muted/70">{d.evidence}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
