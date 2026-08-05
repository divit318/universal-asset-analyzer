/**
 * Golden AI workflow cases — the model-facing regression net.
 *
 * Each case freezes the INPUT side of a real workflow (built with the same
 * production prompt builders features use — never a re-worded copy) and
 * grades the OUTPUT side with deterministic checks: the workflow's own Zod
 * schema, membership/enum guards, and the grounding verifier.
 *
 * Two consumers, one grading path:
 *   - scripts/ai-eval.ts runs the cases LIVE (real key, real spend) and can
 *     record outputs to tests/ai-eval/recorded/.
 *   - tests/ai-eval/recorded-outputs.test.ts re-grades the recorded outputs
 *     offline in CI, so grader/schema/prompt drift is caught without a key.
 *
 * Grade functions return a list of failures; empty = pass. They must stay
 * pure and fast — anything flaky here poisons both consumers.
 */

import { buildMovementPrompt } from "@/lib/movement-explainer";
import { buildDigestPrompt, type WatchlistStockSummary } from "@/lib/ai-watchlist";
import { buildFinancialInsightPrompt } from "@/lib/ai-financial-insight";
import { buildSystemPrompt as buildNlScreenerSystemPrompt } from "@/lib/screener/nl-filters";
import { parseFilters } from "@/lib/screener/filter-engine";
import { MovementAnalysisSchema } from "@/lib/ai/schemas/movement";
import { WatchlistDigestSchema } from "@/lib/ai/schemas/watchlist-digest";
import { MovementWireSchema } from "@/lib/ai/schemas/movement";
import { WatchlistDigestWireSchema } from "@/lib/ai/schemas/watchlist-digest";
import { wireJsonSchema } from "@/lib/ai/providers/chain-analysis";
import { verifyGrounding } from "@/lib/ai/grounding";
import { extractJson } from "@/lib/json-extract";
import type { TaskType } from "@/lib/ai/task-registry";
import type { Quote, FundamentalsSnapshot, ScoreResult } from "@/lib/types";

export interface GoldenCase {
  name: string;
  taskType: TaskType;
  system?: string;
  prompt: string;
  json: boolean;
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  /** Deterministic output grading. Returns failures; empty = pass. */
  grade: (raw: string) => string[];
}

/* ─────────────────────────── frozen inputs ─────────────────────────────── */

function frozenQuote(symbol: string, name: string, price: number, changePercent: number, marketCap: number): Quote {
  return {
    symbol, name, price, previousClose: price / (1 + changePercent / 100),
    change: price - price / (1 + changePercent / 100), changePercent,
    currency: "USD", marketCap, peRatio: 24, dayHigh: price * 1.02, dayLow: price * 0.98,
    fiftyTwoWeekHigh: price * 1.3, fiftyTwoWeekLow: price * 0.7, volume: 40_000_000,
    exchange: "NMS", assetType: "EQUITY", marketState: "CLOSED",
    regularMarketTime: "2026-08-03T20:00:00.000Z", exchangeTimezone: "America/New_York",
  };
}

const MOVEMENT_EVIDENCE = {
  changePercent: -6.4,
  volumeAnomalyPct: 87,
  news: [
    {
      headline: "Nvidia loses $180 billion in market value after hyperscaler capex warning",
      publishedAt: "2026-08-02T14:30:00.000Z",
      summary: "Shares fell sharply after two major cloud customers signaled slower data-center spending growth for 2027.",
    },
    {
      headline: "Analysts trim NVDA targets but keep buy ratings, citing 62% data-center growth",
      publishedAt: "2026-08-02T18:05:00.000Z",
      summary: null,
    },
    {
      headline: "Semiconductor index slides 3.8% as rate-cut hopes fade",
      publishedAt: "2026-08-01T13:00:00.000Z",
      summary: "The broader chip complex sold off alongside treasury yields rising.",
    },
  ],
  sectorContext: "SECTOR CONTEXT: Technology is currently rank 4/11 by relative strength (leading), 1-month return 2.1%.",
};

const WATCHLIST_SUMMARIES: WatchlistStockSummary[] = [
  {
    symbol: "AAPL", name: "Apple Inc.", quote: frozenQuote("AAPL", "Apple Inc.", 232.5, 0.8, 3_550_000_000_000),
    fundamentalScore: 78, recommendation: "buy", topRisk: null, analystUpside: 12, sector: "Technology", momentumTrend: "up",
  },
  {
    symbol: "PFE", name: "Pfizer Inc.", quote: frozenQuote("PFE", "Pfizer Inc.", 27.1, -1.9, 154_000_000_000),
    fundamentalScore: 41, recommendation: "sell", topRisk: "valuation", analystUpside: -4, sector: "Healthcare", momentumTrend: "down",
  },
  {
    symbol: "JPM", name: "JPMorgan Chase & Co.", quote: frozenQuote("JPM", "JPMorgan Chase & Co.", 248.3, 0.2, 700_000_000_000),
    fundamentalScore: 66, recommendation: "hold", topRisk: "macro", analystUpside: 6, sector: "Financial Services", momentumTrend: "flat",
  },
];

// The insight prompt reads only these fields; the full interfaces carry many
// more nullable market-data columns that would be noise here. The casts are
// fixture-local and the prompt builder is the one real consumer.
const INSIGHT_SNAPSHOT = {
  symbol: "MSFT", price: 512.4, sector: "Technology",
  revenueGrowth: 0.152, earningsGrowth: 0.183, operatingMargins: 0.472, freeCashflow: 74_100_000_000,
} as FundamentalsSnapshot;

const INSIGHT_SCORE = {
  total: 82, composite: 79, recommendation: "buy", confidence: 74, rationale: "frozen eval fixture",
  buckets: [
    { name: "Growth", points: 18, max: 25 },
    { name: "Capital Allocation", points: 20, max: 25 },
  ],
  signals: {},
} as unknown as ScoreResult;

const INSIGHT_STATEMENTS = {
  revenue: [
    { fy: 2024, value: 245_122_000_000 },
    { fy: 2025, value: 282_300_000_000 },
  ],
  freeCashFlow: [
    { fy: 2024, value: 67_500_000_000 },
    { fy: 2025, value: 74_100_000_000 },
  ],
  operatingMargin: [
    { fy: 2024, value: 0.446 },
    { fy: 2025, value: 0.472 },
  ],
  revenueCagr: 0.14,
  fcfCagr: 0.11,
  // Same fixture-local reasoning as above: the summary reads exactly these.
} as unknown as Parameters<typeof buildFinancialInsightPrompt>[0]["statements"];

/* ─────────────────────────── grading helpers ───────────────────────────── */

function parseJsonOr(raw: string, failures: string[]): Record<string, unknown> | null {
  try {
    return extractJson<Record<string, unknown>>(raw);
  } catch {
    failures.push("output contained no parseable JSON");
    return null;
  }
}

/** Symbols mentioned at the start of pick/concern lines ("AAPL: reason"). */
function leadingSymbols(items: string[]): string[] {
  return items
    .map((s) => /^([A-Z][A-Z0-9.\-]{0,11})\b/.exec(s.trim())?.[1])
    .filter((s): s is string => Boolean(s));
}

/* ─────────────────────────── the golden set ────────────────────────────── */

export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: "explain-movement — NVDA drop with capex-warning evidence",
    taskType: "explain-movement",
    prompt: buildMovementPrompt(
      { subjectKind: "symbol", subject: "NVDA", windowDays: 5, sector: "Technology" },
      MOVEMENT_EVIDENCE,
    ),
    json: true,
    jsonSchema: wireJsonSchema(MovementWireSchema),
    maxTokens: 1024,
    grade: (raw) => {
      const failures: string[] = [];
      const obj = parseJsonOr(raw, failures);
      if (!obj) return failures;
      const parsed = MovementAnalysisSchema.safeParse(obj);
      if (!parsed.success) {
        failures.push(`schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        return failures;
      }
      const { drivers, confidence } = parsed.data;
      if (drivers.length < 1 || drivers.length > 4) failures.push(`expected 1-4 drivers, got ${drivers.length}`);
      if (drivers.some((d) => !d.evidence.trim())) failures.push("a driver has empty evidence");
      // The dossier explains the move well (real headline + volume anomaly):
      // a well-calibrated confidence should not read as "no evidence".
      if (confidence < 20) failures.push(`confidence ${confidence} is implausibly low for this dossier`);
      // Every number the model cites must come from the dossier.
      const dossier = JSON.stringify(MOVEMENT_EVIDENCE);
      const grounding = verifyGrounding(
        [parsed.data.summary, ...drivers.map((d) => `${d.description} ${d.evidence}`)].join("\n"),
        dossier,
      );
      if (grounding.unsupportedNumbers.length > 0) {
        failures.push(`ungrounded numbers: ${grounding.unsupportedNumbers.join(" | ")}`);
      }
      return failures;
    },
  },

  {
    name: "watchlist-digest — 3-stock list, picks/concerns must be members",
    taskType: "watchlist-intelligence",
    prompt: buildDigestPrompt(WATCHLIST_SUMMARIES),
    json: true,
    jsonSchema: wireJsonSchema(WatchlistDigestWireSchema),
    maxTokens: 1024,
    grade: (raw) => {
      const failures: string[] = [];
      const obj = parseJsonOr(raw, failures);
      if (!obj) return failures;
      const parsed = WatchlistDigestSchema.safeParse(obj);
      if (!parsed.success) {
        failures.push(`schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        return failures;
      }
      const members = new Set(WATCHLIST_SUMMARIES.map((s) => s.symbol));
      for (const sym of leadingSymbols([...parsed.data.topPicks, ...parsed.data.topConcerns])) {
        if (!members.has(sym)) failures.push(`invented symbol in picks/concerns: ${sym}`);
      }
      if (!parsed.data.summary.trim()) failures.push("empty summary");
      return failures;
    },
  },

  {
    name: "nl-screener — 'cheap tech under 15x earnings, 2%+ dividend'",
    taskType: "nl-screener",
    system: buildNlScreenerSystemPrompt("equity"),
    prompt: "cheap tech stocks under 15x earnings paying at least 2% dividends, best first",
    json: true,
    maxTokens: 512,
    grade: (raw) => {
      const failures: string[] = [];
      const obj = parseJsonOr(raw, failures);
      if (!obj) return failures;
      // The exact production post-processing: anything invented is discarded.
      const filters = parseFilters("equity", obj);
      const range = (v: (typeof filters)[string] | undefined) =>
        v && v.kind === "range" ? v : null;
      const pe = range(filters.forwardPE);
      if (!pe || typeof pe.max !== "number" || pe.max < 10 || pe.max > 20) {
        failures.push(`expected a forwardPE max ≈ 15, got ${JSON.stringify(filters.forwardPE)}`);
      }
      const dy = range(filters.dividendYield);
      if (!dy || typeof dy.min !== "number" || dy.min < 1.5 || dy.min > 3) {
        failures.push(`expected a dividendYield min ≈ 2, got ${JSON.stringify(filters.dividendYield)}`);
      }
      return failures;
    },
  },

  (() => {
    const insightPrompt = buildFinancialInsightPrompt({
      symbol: "MSFT",
      snapshot: INSIGHT_SNAPSHOT,
      statements: INSIGHT_STATEMENTS,
      score: INSIGHT_SCORE,
    });
    return {
      name: "financial-insight — MSFT margin/FCF note (text mode)",
      taskType: "quick-summary" as const,
      prompt: insightPrompt,
      json: false,
      maxTokens: 512,
      grade: (raw: string) => {
        const failures: string[] = [];
        const text = raw.trim();
        if (!text) return ["empty output"];
        if (/^#|\*\*/m.test(text)) failures.push("markdown in plain-text output");
        const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0).length;
        if (sentences > 5) failures.push(`expected a 2-3 sentence note, got ~${sentences} sentences`);
        const grounding = verifyGrounding(text, insightPrompt);
        if (grounding.unsupportedNumbers.length > 0) {
          failures.push(`ungrounded numbers: ${grounding.unsupportedNumbers.join(" | ")}`);
        }
        return failures;
      },
    };
  })(),
];
