/**
 * The contract every asset-class research engine implements. A "13th asset
 * class" should mean: write one file satisfying this interface, add one line
 * to registry.ts — not touch the Research Hub page, the AI orchestration
 * core, or any other engine's code.
 *
 * Deliberately NOT implemented by every AssetClass yet. Only "fund" has a
 * real engine (lib/research-engines/fund/); the rest are declared in
 * lib/asset-class.ts so detection/registry keys are exhaustive ahead of
 * time, but a real engine per class is future-phase work (see the roadmap
 * in the Research Hub redesign). Equity intentionally has no engine module
 * here — its logic already lives directly in app/research/page.tsx,
 * lib/scoring.ts, and lib/ai/context.ts; forcing a 1170-line working page
 * through a brand-new interface in the same phase that introduces the
 * interface would risk regressing the one asset class every user depends on
 * today. Extracting equity into this shape is future cleanup, not a
 * Phase-1 requirement.
 */

import type { AssetClass } from "../asset-class";
import type { HistoryPoint, Recommendation } from "../types";
import type { TaskType } from "../ai/task-registry";

/** One optional UI card for an asset class's Research Hub tabs, resolved by id in the page's module renderer. */
export interface ResearchModule {
  id: string;
  tab: "conviction" | "analysis" | "financials" | "ownership" | "details";
  title: string;
}

export interface AssetScore {
  value: number; // 0-100
  recommendation: Recommendation;
  confidence: number; // 0-100
  rationale: string;
}

/**
 * `TData` is the engine's own asset-class-shaped data payload (e.g.
 * FundProfileData) — engines do not share a data shape, only this contract.
 */
export interface ResearchEngine<TData> {
  assetClass: AssetClass;
  /** Which lib/ai/task-registry.ts TaskType this engine's prompts route through. */
  taskType: TaskType;
  /** Ordered list of extra modules this asset class renders (beyond the shared masthead/chart shell every class gets). */
  modules: ResearchModule[];
  fetchData(symbol: string): Promise<TData>;
  /** `history` is the same daily OHLC series /api/research already fetches for every symbol's chart — passed in, not re-fetched per engine. */
  score(data: TData, history: HistoryPoint[]): AssetScore;
}
