/**
 * AI verdict for the non-equity Compare framework (ETF, REIT, Crypto,
 * Commodity, Bond, Forex) — the class-tailored counterpart to
 * lib/ai-compare.ts's equity comparison. Built entirely from data the class
 * API route already assembled (ClassCompareEntry: metrics, attributes,
 * composite scores, top holdings, risk flags) rather than a second fetch
 * pass, since the Screener universe backing it is already cached.
 *
 * Framing is driven by each class's own registry entry
 * (`AssetClassDefinition.aiPrompt` + `keyQuestions` below) rather than a
 * hardcoded equity-shaped prompt — an ETF prompt talks about expense ratios
 * and tracking, a bond prompt about duration and credit, with no per-class
 * branching in the prompt-building logic itself.
 */

import { runAnalysis } from "../ai/analysis";
import { LooseObjectSchema } from "../ai/schemas/loose";
import { ClassComparisonWireSchema, COMPARISON_SCHEMA_VERSION } from "../ai/schemas/comparison";
import { verifyGrounding, collectClaimText, type GroundingReport } from "../ai/grounding";
import { getAssetClass, availableMetrics } from "../assets/registry";
import { computeHoldingsOverlap } from "./holdings-overlap";
import type { AssetClassId } from "../assets/types";
import type { ClassCompareEntry } from "./types";
import type { RankedAsset } from "../ai-compare";
import { AI_NARRATIVE_UNAVAILABLE, AI_RECOVERY_HINT } from "../ai/availability";

export interface KeyQuestionAnswer {
  label: string;
  answer: string;
}

export interface ClassComparisonResult {
  model: string;
  symbols: string[];
  rankings: RankedAsset[];
  noClearWinner: boolean;
  tradeoffSummary: string;
  executiveSummary: string;
  conditionsForChange: string;
  confidenceScore: number;
  keyQuestions: KeyQuestionAnswer[];
  grounding?: GroundingReport;
}

/**
 * The specific questions each class's AI verdict must answer — the
 * "avoid generic language, discuss what actually matters for this class"
 * requirement, as data rather than per-class prompt branching.
 */
const KEY_QUESTIONS: Partial<Record<AssetClassId, string[]>> = {
  etf: [
    "Total cost of ownership",
    "Trading liquidity",
    "Hidden concentration",
    "Benchmark tracking",
    "Distinct exposure, or the same product with a different ticker",
  ],
  reit: [
    "Valuation relative to FFO",
    "Balance-sheet risk in a higher-rate environment",
    "Property-type concentration",
    "Distribution safety (payout ratio)",
  ],
  crypto: [
    "Real utility/demand vs. speculative momentum",
    "Dilution risk from unlocked supply ahead",
    "Liquidity depth relative to market cap",
    "Whether these are genuinely different bets or correlated proxies for the same trade",
  ],
  commodity: [
    "What the futures curve says about near-term supply/demand",
    "Seasonal pattern reliability",
    "Geopolitical exposure",
  ],
  bond: [
    "Yield versus credit and duration risk actually taken",
    "Sensitivity to a rate shock",
    "Whether the funds are genuinely different duration/credit bets",
  ],
  forex: [
    "Carry versus volatility",
    "Central-bank policy divergence",
    "Whether these pairs are correlated bets on the same macro theme",
  ],
};

const fmt = {
  score: (v: number | null) => (v == null ? "n/a" : `${v}/100`),
};

/** Generic unit-driven formatter — mirrors the registry's own `unit` field rather than a per-metric format function, so this stays a lib-level module with no dependency on the UI's class-sections.ts. */
function formatByUnit(v: number, unit: string): string {
  switch (unit) {
    case "%": return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
    case "x": return `${v.toFixed(2)}x`;
    case "$B": return `$${v.toFixed(2)}B`;
    case "$": return `$${v.toFixed(2)}`;
    case "yrs": return `${v.toFixed(1)}y`;
    case "bps": return `${v.toFixed(0)}bps`;
    case "score": return `${Math.round(v)}`;
    default: return v.toLocaleString("en-US");
  }
}

function buildEvidenceTable(assetClass: AssetClassId, entries: ClassCompareEntry[]): string {
  const symbols = entries.map((e) => e.symbol);
  const colWidth = 14;
  const row = (label: string, values: string[]) =>
    `  ${label.padEnd(28)} ${values.map((v) => v.padEnd(colWidth)).join(" ")}`;
  const header = `${"Metric".padEnd(30)} ${symbols.map((s) => s.padEnd(colWidth)).join(" ")}`;
  const divider = "-".repeat(30 + (colWidth + 1) * symbols.length);

  const lines: string[] = [header, divider];
  // availableMetrics() already excludes `unavailable` metrics (Fund Flow,
  // Tracking Error, Country Exposure for ETF) — the AI never gets asked
  // about numbers the platform doesn't actually have.
  for (const metric of availableMetrics(assetClass)) {
    const values = entries.map((e) => {
      if (metric.options) {
        const v = e.attributes[metric.key];
        return v ?? "n/a";
      }
      const v = e.metrics[metric.key];
      return v == null ? "n/a" : formatByUnit(v, metric.unit);
    });
    lines.push(row(metric.label, values));
  }
  lines.push(divider);
  lines.push(row("Overall Score", entries.map((e) => fmt.score(e.scores.overall))));
  for (const axisKey of entries[0]?.scores.axes.map((a) => a.key) ?? []) {
    const label = entries[0].scores.axes.find((a) => a.key === axisKey)!.label;
    lines.push(row(label, entries.map((e) => fmt.score(e.scores.axes.find((a) => a.key === axisKey)?.value ?? null))));
  }

  const flagLines = entries
    .map((e) => `${e.symbol} risk flags: ${e.riskFlags?.map((f) => f.label).join("; ") || "none flagged"}`)
    .join("\n");

  const overlap = computeHoldingsOverlap(entries);
  const overlapLines = overlap
    ? [
        overlap.pairOverlapPercent != null ? `Holdings overlap: ${overlap.pairOverlapPercent}%` : null,
        overlap.shared.length ? `Shared top holdings: ${overlap.shared.slice(0, 5).map((s) => s.name).join(", ")}` : null,
      ].filter(Boolean).join("\n")
    : "";

  return [lines.join("\n"), flagLines, overlapLines].filter(Boolean).join("\n\n");
}

function buildClassComparePrompt(
  assetClass: AssetClassId,
  entries: ClassCompareEntry[],
): { prompt: string; evidence: string } {
  const def = getAssetClass(assetClass);
  const symbolList = entries.map((e) => e.symbol).join(", ");
  const n = entries.length;
  const evidence = buildEvidenceTable(assetClass, entries);
  const questions = KEY_QUESTIONS[assetClass] ?? [];

  const prompt = `You are ${def.aiPrompt.role}. Compare ALL ${n} of the following ${def.noun} together using ONLY the data below: ${symbolList}. Every section must address all ${n} — never limit the analysis to just two of them. Focus your read on: ${def.aiPrompt.focus}.

${evidence}

Write a structured comparison. Be specific — cite the numbers above. Do NOT force a single "winner" — rank every ${def.assetClass === "fund" ? "fund" : "asset"} and give each its own thesis; if the field is genuinely close, say so explicitly instead of picking one arbitrarily. Never use language specific to individual company stock-picking (earnings, EPS, management quality) unless the data above actually supports it. Return as JSON:
{
  "keyQuestions": [
${questions.map((q) => `    { "label": ${JSON.stringify(q)}, "answer": "2-3 sentences answering this specifically for all ${n}, citing numbers" }`).join(",\n")}
  ],
  "rankings": [
    { "rank": 1, "symbol": "<one of: ${symbolList}>", "thesis": "1-2 sentences: the case for this pick specifically", "strengths": ["<short phrase, cite a number>", "..."], "weaknesses": ["<short phrase, cite a number>", "..."], "bestFor": "the type of investor this suits best" }
    // one entry per ${def.noun.replace(/s$/, "")}, rank 1..${n}, best first
  ],
  "noClearWinner": "<true if the field is genuinely close and the ranking shouldn't be read as decisive, false otherwise>",
  "tradeoffSummary": "One paragraph: why the ranking landed this way, OR — if noClearWinner — why the right pick depends on the investor's own objective rather than a factual edge",
  "executiveSummary": "2-3 sentences for a top-of-page summary covering ALL ${n}, written for someone who will only read this one paragraph",
  "conditionsForChange": "One sentence: what would have to change for the ranking order to shift",
  "confidenceScore": "<0-100 integer — how confident are you in this ranking given the data available>"
}`;

  return { prompt, evidence };
}

type FlatClassAI = {
  keyQuestions?: unknown[];
  rankings?: unknown[];
  noClearWinner?: boolean | string;
  tradeoffSummary?: string;
  executiveSummary?: string;
  conditionsForChange?: string;
  confidenceScore?: number;
};

function sanitizeRanking(item: unknown, validSymbols: Set<string>): RankedAsset | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const symbol = typeof r.symbol === "string" ? r.symbol.toUpperCase().trim() : null;
  if (!symbol || !validSymbols.has(symbol)) return null;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    rank: typeof r.rank === "number" ? r.rank : 0,
    symbol,
    thesis: typeof r.thesis === "string" ? r.thesis : "",
    strengths: asStringArray(r.strengths),
    weaknesses: asStringArray(r.weaknesses),
    bestFor: typeof r.bestFor === "string" ? r.bestFor : "",
  };
}

/** Fallback order uses the composite Overall Score — a real, already-computed number, never fabricated. */
function normalizeRankings(raw: unknown[], entries: ClassCompareEntry[]): RankedAsset[] {
  const validSymbols = new Set(entries.map((e) => e.symbol));
  const bySymbol = new Map<string, RankedAsset>();
  for (const item of raw) {
    const r = sanitizeRanking(item, validSymbols);
    if (r && !bySymbol.has(r.symbol)) bySymbol.set(r.symbol, r);
  }

  const fallbackOrder = [...entries].sort((a, b) => (b.scores.overall ?? 0) - (a.scores.overall ?? 0));
  for (const e of fallbackOrder) {
    if (!bySymbol.has(e.symbol)) {
      bySymbol.set(e.symbol, { rank: 0, symbol: e.symbol, thesis: "", strengths: [], weaknesses: [], bestFor: "" });
    }
  }

  return fallbackOrder
    .map((e) => bySymbol.get(e.symbol)!)
    .sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return 0;
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function sanitizeKeyQuestions(raw: unknown[], questions: string[]): KeyQuestionAnswer[] {
  const bylabel = new Map<string, string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.label === "string" && typeof r.answer === "string") bylabel.set(r.label, r.answer);
  }
  // Preserve the framework's own question order regardless of model output order.
  return questions.map((label) => ({ label, answer: bylabel.get(label) ?? "" }));
}

/** Compare 2-5 assets of the same non-equity class. Entries must already be loaded (from the class API route). */
export async function compareClassAssets(
  assetClass: AssetClassId,
  entries: ClassCompareEntry[],
): Promise<ClassComparisonResult> {
  const valid = entries.filter((e) => !e.error);
  if (valid.length < 2) throw new Error("At least two distinct symbols are required");
  if (valid.length > 5) throw new Error("At most 5 symbols can be compared at once");

  const { prompt, evidence } = buildClassComparePrompt(assetClass, valid);
  const questions = KEY_QUESTIONS[assetClass] ?? [];

  let model = "unavailable";
  let flat: FlatClassAI = {};
  try {
    // Through the analysis seam (tranche 5); the class wire schema carries
    // the per-class keyQuestions contract. Downstream sanitizers
    // (normalizeRankings, sanitizeKeyQuestions, the ?? defaults) are the
    // parse layer, exactly as before.
    const analysis = await runAnalysis({
      taskType: "comparison",
      subjectKey: `compare:${assetClass}:${valid.map((e) => e.symbol).join(",")}`,
      prompt,
      schema: LooseObjectSchema,
      wireSchema: ClassComparisonWireSchema,
      schemaVersion: COMPARISON_SCHEMA_VERSION,
    });
    model = analysis.provider === "devin" ? "devin" : (analysis.meta.model ?? "ollama");
    flat = {
      keyQuestions: [], rankings: [], noClearWinner: false, tradeoffSummary: "",
      executiveSummary: "", conditionsForChange: "", confidenceScore: undefined,
      ...(analysis.data as Record<string, unknown>),
    } as FlatClassAI;
  } catch {
    // AI unavailable — the metric table / deterministic scores still work.
  }

  const aiUnavailable = model === "unavailable";
  const rankings = normalizeRankings(Array.isArray(flat.rankings) ? flat.rankings : [], valid);
  const keyQuestions = sanitizeKeyQuestions(Array.isArray(flat.keyQuestions) ? flat.keyQuestions : [], questions);

  const executiveSummary = flat.executiveSummary ?? (aiUnavailable
    ? `${AI_NARRATIVE_UNAVAILABLE} ${AI_RECOVERY_HINT}`
    : "");

  const grounding = aiUnavailable
    ? undefined
    : verifyGrounding(
        collectClaimText([
          executiveSummary,
          flat.tradeoffSummary ?? "",
          flat.conditionsForChange ?? "",
          ...keyQuestions.map((q) => q.answer),
          ...rankings.flatMap((r) => [r.thesis, r.bestFor, ...r.strengths, ...r.weaknesses]),
        ]),
        evidence,
      );

  return {
    model,
    symbols: valid.map((e) => e.symbol),
    rankings,
    noClearWinner: flat.noClearWinner === true || (flat.noClearWinner as unknown) === "true",
    tradeoffSummary: flat.tradeoffSummary ?? "",
    executiveSummary,
    conditionsForChange: flat.conditionsForChange ?? "",
    confidenceScore: typeof flat.confidenceScore === "number"
      ? Math.max(0, Math.min(100, Math.round(flat.confidenceScore)))
      : Math.round(valid.reduce((a, e) => a + (e.scores.overall ?? 50), 0) / valid.length),
    keyQuestions,
    grounding,
  };
}
