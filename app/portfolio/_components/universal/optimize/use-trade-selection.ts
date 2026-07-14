"use client";

import { useCallback, useMemo, useState } from "react";
import type { TargetWeight } from "@/lib/portfolio/engines/optimize";
import type { ImpactEstimate } from "@/lib/portfolio/engines/simulate";

export interface TradeSelectionSummary {
  count: number;
  /** Sum of |dollarDelta| across selected trades, scaled by each trade's partial %. */
  totalTradeValue: number;
  /** Sum of dollarDelta (signed) — positive = net cash required, negative = net cash generated. */
  netCash: number;
  netBuys: number;
  netSells: number;
  turnoverPct: number;
}

export interface SelectedTrade extends TargetWeight {
  partialPct: number;
}

/**
 * Selection + partial-implementation state for the Optimize tab's trade list
 * (Features 1, 2, 12). Pure client state — derives its summary from the
 * already-fetched TargetWeight[] and (optionally) the separately-fetched
 * per-trade ImpactEstimate map; it does not fetch anything itself.
 */
export function useTradeSelection(
  trades: TargetWeight[],
  totalPortfolioValue: number,
  impacts: Map<string, ImpactEstimate> | null,
) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partialPct, setPartialPct] = useState<Map<string, number>>(new Map());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setPct = useCallback((id: string, pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    setPartialPct((prev) => {
      const next = new Map(prev);
      next.set(id, clamped);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(trades.map((t) => t.holdingId))), [trades]);
  const clearAll = useCallback(() => setSelected(new Set()), []);
  const selectBuys = useCallback(
    () => setSelected(new Set(trades.filter((t) => t.action === "BUY").map((t) => t.holdingId))),
    [trades],
  );
  const selectSells = useCallback(
    () => setSelected(new Set(trades.filter((t) => t.action === "SELL").map((t) => t.holdingId))),
    [trades],
  );
  const invert = useCallback(
    () => setSelected((prev) => new Set(trades.filter((t) => !prev.has(t.holdingId)).map((t) => t.holdingId))),
    [trades],
  );

  // Evidence-based selections — real per-trade impact, not a heuristic. All
  // three are no-ops until the impacts map has loaded.
  const selectHighestImpact = useCallback(
    (n = 5) => {
      if (!impacts) return;
      const ranked = [...trades].sort(
        (a, b) => Math.abs(impacts.get(b.holdingId)?.healthDelta ?? 0) - Math.abs(impacts.get(a.holdingId)?.healthDelta ?? 0),
      );
      setSelected(new Set(ranked.slice(0, n).map((t) => t.holdingId)));
    },
    [trades, impacts],
  );
  const selectHealthImprovements = useCallback(() => {
    if (!impacts) return;
    setSelected(new Set(trades.filter((t) => (impacts.get(t.holdingId)?.healthDelta ?? 0) > 0).map((t) => t.holdingId)));
  }, [trades, impacts]);
  const selectRiskReduction = useCallback(() => {
    if (!impacts) return;
    setSelected(
      new Set(
        trades
          .filter((t) => {
            const rd = impacts.get(t.holdingId)?.riskDelta;
            return rd != null && rd < 0;
          })
          .map((t) => t.holdingId),
      ),
    );
  }, [trades, impacts]);

  const summary = useMemo<TradeSelectionSummary>(() => {
    let totalTradeValue = 0;
    let netCash = 0;
    let netBuys = 0;
    let netSells = 0;
    for (const t of trades) {
      if (!selected.has(t.holdingId)) continue;
      const pct = (partialPct.get(t.holdingId) ?? 100) / 100;
      const amount = t.dollarDelta * pct;
      totalTradeValue += Math.abs(amount);
      netCash += amount;
      if (amount > 0) netBuys += amount;
      else netSells += Math.abs(amount);
    }
    return {
      count: selected.size,
      totalTradeValue,
      netCash,
      netBuys,
      netSells,
      turnoverPct: totalPortfolioValue > 0 ? (totalTradeValue / totalPortfolioValue) * 100 : 0,
    };
  }, [trades, selected, partialPct, totalPortfolioValue]);

  const selectedTrades = useMemo<SelectedTrade[]>(
    () => trades.filter((t) => selected.has(t.holdingId)).map((t) => ({ ...t, partialPct: partialPct.get(t.holdingId) ?? 100 })),
    [trades, selected, partialPct],
  );

  return {
    selected,
    isSelected: (id: string) => selected.has(id),
    toggle,
    selectAll,
    clearAll,
    selectBuys,
    selectSells,
    invert,
    selectHighestImpact,
    selectHealthImprovements,
    selectRiskReduction,
    partialPct,
    pctOf: (id: string) => partialPct.get(id) ?? 100,
    setPct,
    summary,
    selectedTrades,
  };
}

export type TradeSelectionState = ReturnType<typeof useTradeSelection>;
