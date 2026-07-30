"use client";

import { useCallback, useMemo, useState } from "react";
import { computePlanFunding, type PlanFunding, type TargetWeight } from "@/lib/portfolio/engines/optimize";
import type { ImpactEstimate } from "@/lib/portfolio/engines/simulate";

export interface TradeSelectionSummary extends PlanFunding {
  count: number;
  turnoverPct: number;
}

/**
 * Which bulk action, if any, the CURRENT selection actually is.
 *
 * A bulk button is a statement about the selection, not a record of the last
 * click — "Select All" rendered in its pressed style next to "0 of 16 trades
 * selected" is two contradictory claims about the same state, and the user has to
 * decide which one is lying. So each flag is recomputed from the live selection
 * set: click Select All then untick one row and the button stops being active,
 * because it is no longer true.
 *
 * `invert` has no flag by design — it is a transformation, not a reachable state,
 * so there is nothing for it to be "currently" showing.
 */
export interface BulkActionState {
  all: boolean;
  none: boolean;
  buys: boolean;
  sells: boolean;
  highestImpact: boolean;
  healthImprovements: boolean;
  riskReduction: boolean;
}

/** Set equality over holding ids, treating the empty candidate set as "not a state". */
function selectionIs(selected: Set<string>, candidate: string[]): boolean {
  return candidate.length > 0 && selected.size === candidate.length && candidate.every((id) => selected.has(id));
}

export interface SelectedTrade extends TargetWeight {
  partialPct: number;
}

/** How many trades "Select Highest Impact" takes. */
const HIGHEST_IMPACT_COUNT = 5;

/**
 * Selection + partial-implementation state for the Optimize tab's trade list
 * (Features 1, 2, 12). Pure client state — derives its summary from the
 * already-fetched TargetWeight[] and (optionally) the separately-fetched
 * per-trade ImpactEstimate map; it does not fetch anything itself.
 *
 * The funding arithmetic is NOT reimplemented here: it comes from the engine's
 * computePlanFunding(), the same function that produces the whole plan's funding
 * line, so the selection total and the plan total can never use different rules
 * for what counts as a buy or as self-funded.
 */
export function useTradeSelection(
  trades: TargetWeight[],
  totalPortfolioValue: number,
  impacts: Map<string, ImpactEstimate> | null,
  cashAvailable: number,
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

  /* Each bulk action's candidate id list, computed ONCE and used for two things:
     performing the action, and deciding whether the button is currently active.
     Deriving the button's appearance from the same list that produced the
     selection is what makes "active" mean "true" rather than "clicked". Evidence-
     based sets are empty until the measured per-trade impacts have loaded. */
  const candidates = useMemo(() => {
    const ids = (ts: TargetWeight[]) => ts.map((t) => t.holdingId);
    const rankedByImpact = impacts
      ? [...trades].sort(
          (a, b) => Math.abs(impacts.get(b.holdingId)?.healthDelta ?? 0) - Math.abs(impacts.get(a.holdingId)?.healthDelta ?? 0),
        )
      : [];
    return {
      all: ids(trades),
      buys: ids(trades.filter((t) => t.action === "BUY")),
      sells: ids(trades.filter((t) => t.action === "SELL")),
      highestImpact: ids(rankedByImpact.slice(0, HIGHEST_IMPACT_COUNT)),
      healthImprovements: impacts
        ? ids(trades.filter((t) => (impacts.get(t.holdingId)?.healthDelta ?? 0) > 0))
        : [],
      riskReduction: impacts
        ? ids(trades.filter((t) => {
            const rd = impacts.get(t.holdingId)?.riskDelta;
            return rd != null && rd < 0;
          }))
        : [],
    };
  }, [trades, impacts]);

  const selectAll = useCallback(() => setSelected(new Set(candidates.all)), [candidates]);
  const clearAll = useCallback(() => setSelected(new Set()), []);
  const selectBuys = useCallback(() => setSelected(new Set(candidates.buys)), [candidates]);
  const selectSells = useCallback(() => setSelected(new Set(candidates.sells)), [candidates]);
  const invert = useCallback(
    () => setSelected((prev) => new Set(trades.filter((t) => !prev.has(t.holdingId)).map((t) => t.holdingId))),
    [trades],
  );

  // Evidence-based selections — real per-trade impact, not a heuristic. All
  // three are no-ops until the impacts map has loaded.
  const selectHighestImpact = useCallback(() => {
    if (!impacts) return;
    setSelected(new Set(candidates.highestImpact));
  }, [candidates, impacts]);
  const selectHealthImprovements = useCallback(() => {
    if (!impacts) return;
    setSelected(new Set(candidates.healthImprovements));
  }, [candidates, impacts]);
  const selectRiskReduction = useCallback(() => {
    if (!impacts) return;
    setSelected(new Set(candidates.riskReduction));
  }, [candidates, impacts]);

  const activeBulkAction = useMemo<BulkActionState>(() => ({
    all: selectionIs(selected, candidates.all),
    none: selected.size === 0,
    buys: selectionIs(selected, candidates.buys),
    sells: selectionIs(selected, candidates.sells),
    highestImpact: selectionIs(selected, candidates.highestImpact),
    healthImprovements: selectionIs(selected, candidates.healthImprovements),
    riskReduction: selectionIs(selected, candidates.riskReduction),
  }), [selected, candidates]);

  const summary = useMemo<TradeSelectionSummary>(() => {
    // dollarDelta scaled by each trade's partial-implementation percentage BEFORE
    // funding is computed — a 50%-implemented buy consumes half the cash.
    const scaled = trades
      .filter((t) => selected.has(t.holdingId))
      .map((t) => ({ dollarDelta: t.dollarDelta * ((partialPct.get(t.holdingId) ?? 100) / 100) }));
    const funding = computePlanFunding(scaled, cashAvailable);
    return {
      ...funding,
      count: selected.size,
      turnoverPct: totalPortfolioValue > 0 ? (funding.gross / totalPortfolioValue) * 100 : 0,
    };
  }, [trades, selected, partialPct, totalPortfolioValue, cashAvailable]);

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
    activeBulkAction,
    partialPct,
    pctOf: (id: string) => partialPct.get(id) ?? 100,
    setPct,
    summary,
    selectedTrades,
  };
}

export type TradeSelectionState = ReturnType<typeof useTradeSelection>;
