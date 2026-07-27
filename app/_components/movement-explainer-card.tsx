"use client";

import { useEffect, useRef, useState } from "react";
import type { MovementDriver, MovementExplanation } from "@/lib/types";

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
  ready = true,
  onLoaded,
}: {
  symbol: string;
  sector?: string | null;
  autoLoad?: boolean;
  /**
   * Hold the auto-load until every input is final. Pass `false` while `sector`
   * is still resolving — generating an explanation without the sector costs the
   * same inference as generating it with, and is immediately superseded.
   */
  ready?: boolean;
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

  /**
   * Auto-load, exactly once per (symbol, sector) pair.
   *
   * `ready` exists because `sector` arrives late: the research page passes
   * `fundamentals?.snapshot?.sector`, which is `undefined` on first render and
   * `"Technology"` a second later. Without a gate this effect fired twice, and
   * because the old cleanup only flipped a `cancelled` flag — it never aborted
   * the request — the superseded call still ran a full local inference to
   * completion on a backend that serializes them. The verdict generation then
   * queued behind work whose result had already been thrown away.
   */
  const requestKey = `${symbol}|${sector ?? ""}`;
  const loadedKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!autoLoad || !ready) return;
    if (loadedKeyRef.current === requestKey) return;
    loadedKeyRef.current = requestKey;

    // Supersede the previous key's request, if any.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setExplanation(null);

    const params = new URLSearchParams({ kind: "symbol", subject: symbol });
    if (sector) params.set("sector", sector);

    void fetch(`/api/movement?${params.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const exp = data?.explanation ?? null;
        setExplanation(exp);
        onLoaded?.(exp);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setExplanation(null);
        onLoaded?.(null);
        void err;
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    // No cleanup-abort: StrictMode's mount→cleanup→mount would abort this
    // request and then hit the `loadedKeyRef` guard on the second pass, leaving
    // the card stuck loading forever. Unmount is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, autoLoad, ready]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
        <div className="h-2.5 w-full animate-pulse rounded bg-surface-2" />
        <div className="h-2.5 w-4/5 animate-pulse rounded bg-surface-2" />
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
