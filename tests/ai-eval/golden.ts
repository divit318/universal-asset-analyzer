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
import { buildVerdictPrompt } from "@/lib/ai/report-sections";
import { buildThesisPrompt as buildScannerThesisPrompt } from "@/lib/scanner/thesis-builder";
import { buildThesisPrompt as buildPortfolioThesisPrompt } from "@/lib/portfolio/thesis";
import { MovementAnalysisSchema } from "@/lib/ai/schemas/movement";
import { WatchlistDigestSchema } from "@/lib/ai/schemas/watchlist-digest";
import { MovementWireSchema } from "@/lib/ai/schemas/movement";
import { WatchlistDigestWireSchema } from "@/lib/ai/schemas/watchlist-digest";
import { ScannerThesisWireSchema } from "@/lib/ai/schemas/scanner";
import { wireJsonSchema } from "@/lib/ai/providers/chain-analysis";
import { verifyGrounding } from "@/lib/ai/grounding";
import { extractJson } from "@/lib/json-extract";
import type { TaskType } from "@/lib/ai/task-registry";
import type { CompanyContext } from "@/lib/ai/types";
import type { Quote, FundamentalsSnapshot, ScoreResult, ScannerOpportunity, MarketEvent, SectorImpact } from "@/lib/types";

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

/**
 * Filter the verifier's unsupported-number list down to figures that are
 * GENUINELY absent from the evidence.
 *
 * The strict verifier flags a sign-stripped restatement — evidence says
 * "-21.2%", the model writes "21.2% below its 52-week high" — as unsupported,
 * because its numeric match is sign-aware. That is an honest, correctly-
 * transcribed figure whose direction is carried by the surrounding words, and
 * the CURRENT production model produces exactly this pattern (calibrated on
 * the baseline before any model change, so the gate cannot have been tuned to
 * flatter a candidate). A figure whose absolute value appears nowhere in the
 * evidence remains a failure. Direction-vs-sign contradictions are the
 * verifyGroundingWithFacts variant's job, per its own doc.
 */
function trulyUnsupported(unsupported: string[], evidence: string): string[] {
  return unsupported.filter((raw) => {
    const numeral = raw.replace(/[^0-9.]/g, "");
    if (!numeral) return true;
    const value = Number(numeral);
    if (!Number.isFinite(value)) return true;
    // Year-range artifact: the verifier reads "2027–2028" as the number
    // -2028, then flags it. A bare integer that looks like a calendar year is
    // accepted when the evidence contains it or the year immediately before
    // it (the start of the range it continues). Applies ONLY to 4-digit
    // year-shaped integers with no unit — every priced/percentaged figure
    // keeps the strict check.
    if (/^\d{4}$/.test(numeral) && value >= 1990 && value <= 2049) {
      if (evidence.includes(numeral) || evidence.includes(String(value - 1))) return false;
    }
    // Accept when the evidence carries the same magnitude with an explicit
    // sign (or the same digits at a different printed precision).
    const variants = [numeral, value.toFixed(1), value.toFixed(2), String(value)];
    return !variants.some((v) => evidence.includes(`-${v}`) || evidence.includes(`+${v}`) || evidence.includes(v));
  });
}

/**
 * Is `raw` a pairwise SUM or DIFFERENCE of two numbers present in the
 * evidence? Used by the portfolio-thesis case only: that task's documented
 * job is to COMBINE settled facts ("several settled facts combine into
 * something" — lib/portfolio/thesis.ts), and every model tested — including
 * the production baseline — correctly derives e.g. 46% + 38% = "84% in
 * equities". Deterministic and bounded: exactly two operands, both from the
 * evidence, tolerance 0.15. Anything else stays a failure.
 */
function derivedPairwise(raw: string, evidence: string): boolean {
  const value = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(value)) return false;
  const nums = [...evidence.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).slice(0, 400);
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (Math.abs(nums[i] + nums[j] - value) < 0.15) return true;
      if (Math.abs(Math.abs(nums[i] - nums[j]) - value) < 0.15) return true;
    }
  }
  return false;
}

/* ─────────────────────────── the golden set ────────────────────────────── */

export const GOLDEN_CASES: GoldenCase[] = [
  (() => {
    const movementPrompt = buildMovementPrompt(
      { subjectKind: "symbol", subject: "NVDA", windowDays: 5, sector: "Technology" },
      MOVEMENT_EVIDENCE,
    );
    return {
      name: "explain-movement — NVDA drop with capex-warning evidence",
      taskType: "explain-movement" as const,
      prompt: movementPrompt,
      json: true,
      jsonSchema: wireJsonSchema(MovementWireSchema),
      maxTokens: 1024,
      grade: (raw: string) => {
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
        // Every number the model cites must come from what the model was SHOWN —
        // the rendered prompt, not the raw fixture object. Grading against
        // `JSON.stringify(MOVEMENT_EVIDENCE)` flagged perfectly-grounded answers:
        // the prompt says "-6.40%" and "up 87%", the fixture says `-6.4` and `87`,
        // so a model quoting the prompt verbatim was scored as inventing numbers.
        // The insight case below has always graded against its prompt; this one
        // now does the same. The standard is unchanged: numbers must trace to
        // the evidence the model actually received.
        const grounding = verifyGrounding(
          [parsed.data.summary, ...drivers.map((d) => `${d.description} ${d.evidence}`)].join("\n"),
          movementPrompt,
        );
        // Same sign/precision tolerance as every other case: "6.4%" against a
        // prompt that says "-6.40%" is an honest restatement, not an invention.
        const invented = trulyUnsupported(grounding.unsupportedNumbers, movementPrompt);
        if (invented.length > 0) {
          failures.push(`ungrounded numbers: ${invented.join(" | ")}`);
        }
        return failures;
      },
    };
  })(),

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

  /* ── investment verdict — the Research Hub hero (Phase 4 quality gate) ──── */
  (() => {
    // Frozen CompanyContext with exactly the fields buildEquityFacts consumes.
    // Composite 59 sits in the HOLD band (42–59), so the pinned verdict word
    // is "neutral" — the case verifies the model respects the computed
    // conclusion, cites only dossier figures, and fills every section.
    const ctx = {
      symbol: "CAT",
      name: "Caterpillar Inc.",
      builtAt: "2026-08-03T00:00:00.000Z",
      quote: frozenQuote("CAT", "Caterpillar Inc.", 837.58, -0.55, 385_010_000_000),
      profile: null,
      snapshot: {
        symbol: "CAT", sector: "Industrials",
        forwardPE: 26.2, trailingPE: 36.23, priceToBook: 19.85,
        profitMargins: 0.145, operatingMargins: 0.222, grossMargins: 0.297,
        returnOnEquity: 0.57, returnOnAssets: 0.09,
        revenueGrowth: 0.24, earningsGrowth: 0.682,
        debtToEquity: 2.33, currentRatio: 1.37, dividendYield: 0.0077,
        enterpriseToEbitda: 26.1,
      } as FundamentalsSnapshot,
      statements: null,
      analyst: {
        recommendationKey: "buy", numberOfOpinions: 28,
        targetMean: 972.95, upsidePercent: 16.2,
        strongBuy: 6, buy: 8, hold: 12, sell: 2, strongSell: 0,
      } as CompanyContext["analyst"],
      insider: null,
      score: {
        composite: 59, recommendation: "hold",
        rationale: "Hold — fundamentals 62, analysts 63, momentum 46 (all /100).",
        buckets: [
          { name: "Valuation", points: 15.75, max: 25, factors: [] },
          { name: "Quality", points: 19, max: 25, factors: [] },
          { name: "Growth", points: 19, max: 25, factors: [] },
          { name: "Financial Health", points: 6.25, max: 25, factors: [] },
        ],
      } as unknown as ScoreResult,
      risks: [
        { category: "Financial", reason: "D/E 2.33", level: "high" },
        { category: "Valuation", reason: "Forward P/E above sector median", level: "medium" },
      ] as CompanyContext["risks"],
      momentum: {
        return3m: -9.5, vsSma200: 12.4, vsSma50: -8.4, pctFrom52WkHigh: -21.2, trend: "up",
      } as CompanyContext["momentum"],
      personality: null, peers: null, filings: [],
      news: [
        { headline: "Caterpillar backlog grows on data-center power demand", url: "", publishedAt: "2026-08-01T12:00:00.000Z", source: "eval-fixture" },
      ] as CompanyContext["news"],
      onWatchlist: false, ownership: null, sectorRotation: null,
      recentTimelineEvents: [], relatedOpportunities: null, yourExposure: null,
      warnings: [],
    } as CompanyContext;

    const { prompt, evidence } = buildVerdictPrompt(ctx, null);
    return {
      name: "investment-verdict — CAT hold-band hero verdict",
      taskType: "investment-verdict" as const,
      prompt,
      json: true,
      maxTokens: 2048,
      grade: (raw: string) => {
        const failures: string[] = [];
        const obj = parseJsonOr(raw, failures);
        if (!obj) return failures;
        const headline = typeof obj.headline === "string" ? obj.headline : "";
        const thesis = typeof obj.thesis === "string" ? obj.thesis : "";
        const catalysts = Array.isArray(obj.catalysts) ? (obj.catalysts as unknown[]) : [];
        const risks = Array.isArray(obj.risks) ? (obj.risks as unknown[]) : [];
        const keyMetrics = Array.isArray(obj.keyMetrics) ? (obj.keyMetrics as unknown[]) : [];

        // Investment conclusion: the composite (59 → HOLD band) is settled in
        // code and stated in the prompt; a model that argues past it fails.
        if (obj.verdict !== "neutral") failures.push(`verdict must be "neutral" (composite 59), got ${JSON.stringify(obj.verdict)}`);
        // Structural completeness — what the hero renders.
        if (headline.trim().length < 15) failures.push("headline missing or trivially short");
        if (/shows potential/i.test(headline)) failures.push("headline uses the banned generic phrase");
        if (thesis.trim().length < 100) failures.push("thesis shorter than a real 2-3 sentence case");
        if (catalysts.length < 3) failures.push(`expected ≥3 catalysts, got ${catalysts.length}`);
        if (risks.length < 3) failures.push(`expected ≥3 risks, got ${risks.length}`);
        if (keyMetrics.length !== 5) failures.push(`expected exactly 5 keyMetrics, got ${keyMetrics.length}`);
        // Reasoning quality proxy the prompt itself demands: catalysts and
        // risks must cite specific figures, not generic bullets.
        const uncited = [...catalysts, ...risks].filter((s) => typeof s === "string" && !/\d/.test(s));
        if (uncited.length > 0) failures.push(`${uncited.length} catalyst/risk bullet(s) cite no figure`);
        if (!["high", "medium", "low"].includes(String(obj.confidence))) failures.push("confidence not an allowed value");
        // Numerical accuracy: every figure must trace to the evidence block —
        // the same verifier the product runs on live verdicts.
        const grounding = verifyGrounding(JSON.stringify(obj), evidence);
        const invented = trulyUnsupported(grounding.unsupportedNumbers, evidence);
        if (invented.length > 0) {
          failures.push(`ungrounded numbers: ${invented.join(" | ")}`);
        }
        return failures;
      },
    };
  })(),

  /* ── portfolio thesis — the Portfolio banner (Phase 4 quality gate) ─────── */
  (() => {
    const evaluation = {
      holdings: [
        {
          id: "NVDA", assetClass: "equity", symbol: "NVDA", name: "NVIDIA", currency: "USD",
          quantity: 120, unit: "shares", costBasis: 60_000, costBasisBase: 60_000, acquiredAt: "2024-05-01",
          valuation: { mode: "market", value: 148_000, valueBase: 148_000, fxRate: 1, source: "yahoo", asOf: "2026-08-01", stale: false },
          weight: 46, unrealizedPL: 88_000, unrealizedPct: 146.7, liquidity: "t0", income: null,
          factors: { equityBeta: 1.7 }, metrics: {}, attributes: { sector: "Technology" }, score: null, meta: {},
        },
        {
          id: "VOO", assetClass: "fund", symbol: "VOO", name: "Vanguard S&P 500 ETF", currency: "USD",
          quantity: 200, unit: "shares", costBasis: 90_000, costBasisBase: 90_000, acquiredAt: "2023-01-15",
          valuation: { mode: "market", value: 122_000, valueBase: 122_000, fxRate: 1, source: "yahoo", asOf: "2026-08-01", stale: false },
          weight: 38, unrealizedPL: 32_000, unrealizedPct: 35.6, liquidity: "t0", income: null,
          factors: { equityBeta: 1.0 }, metrics: {}, attributes: { sector: null }, score: null, meta: {},
        },
        {
          id: "CASH-USD", assetClass: "cash", symbol: null, name: "USD Cash", currency: "USD",
          quantity: 51_000, unit: "units", costBasis: 51_000, costBasisBase: 51_000, acquiredAt: "2026-01-01",
          valuation: { mode: "manual", value: 51_000, valueBase: 51_000, fxRate: 1, source: "manual", asOf: "2026-08-01", stale: false },
          weight: 16, unrealizedPL: 0, unrealizedPct: 0, liquidity: "t0", income: null,
          factors: {}, metrics: {}, attributes: {}, score: null, meta: {},
        },
      ],
      totalValue: 321_000,
      allocation: {
        byAssetClass: {
          dimension: "assetClass",
          slices: [
            { key: "equity", label: "Equities", value: 148_000, weight: 46, count: 1, avgScore: null },
            { key: "fund", label: "Funds", value: 122_000, weight: 38, count: 1, avgScore: null },
            { key: "cash", label: "Cash", value: 51_000, weight: 16, count: 1, avgScore: null },
          ],
          hhi: 3816, unclassifiedPct: 0,
        },
        bySector: { dimension: "sector", slices: [{ key: "Technology", label: "Technology", value: 148_000, weight: 46, count: 1, avgScore: null }], hhi: 2116, unclassifiedPct: 38 },
        byGeography: { dimension: "geography", slices: [], hhi: 0, unclassifiedPct: 0 },
        byCurrency: { dimension: "currency", slices: [], hhi: 0, unclassifiedPct: 0 },
        byLiquidity: { dimension: "liquidity", slices: [], hhi: 0, unclassifiedPct: 0 },
        byFactor: [{ factor: "equityBeta", label: "Equity market", exposure: 1.28 }],
      },
      risk: {
        annualizedVolatility: 21, beta: 1.28, benchmarkLabel: "S&P 500", sharpeRatio: 1.1, sortinoRatio: 1.5,
        maxDrawdown: -18, var95Pct: 2.4, var95Dollar: 7_700, cvar95Pct: 3.4, cvar95Dollar: 10_900,
        duration: null, creditSensitivity: null, foreignCurrencyPct: 0, illiquidPct: 0, illiquidHoldings: 0,
        inflationSensitivity: -0.8, positionHhi: 3816, topHoldingWeight: 46, topAssetClassWeight: 46,
        topSectorWeight: 46, concentrationRisk: "high",
        coverage: { observedPct: 100, proxiedPct: 0, unmodelledPct: 0, holdingsObserved: 3, holdingsProxied: 0, holdingsUnmodelled: 0 },
        correlation: null,
      },
      alignment: {
        score: 61, scoreExact: 61, label: "Mixed", status: "scored", confirmed: false,
        themes: [
          { id: "liquidity", label: "Liquidity", question: "", priority: 2, weightShare: 1 / 3, score: 95, scoreExact: 95, status: "aligned", unratedReason: null, finding: "95% of value is same-day liquid.", basis: "", evidencePct: 100, facts: [], mismatch: null },
          { id: "concentration", label: "Concentration", question: "", priority: 2, weightShare: 1 / 3, score: 34, scoreExact: 34, status: "mismatch", unratedReason: null, finding: "NVDA is 46% of the book; top holding above the 25% position cap.", basis: "", evidencePct: 100, facts: [], mismatch: null },
          { id: "income", label: "Income", question: "", priority: 2, weightShare: 1 / 3, score: 42, scoreExact: 42, status: "tension", unratedReason: null, finding: "Dividend income covers little of the book.", basis: "", evidencePct: 100, facts: [], mismatch: null },
        ],
        mismatches: [],
        dataGaps: [],
        summary: "Concentrated growth book with a large cash reserve.",
        evidencePct: 100,
      },
    } as unknown as Parameters<typeof buildPortfolioThesisPrompt>[0];

    const thesisPrompt = buildPortfolioThesisPrompt(evaluation, {});
    return {
      name: "portfolio-thesis — concentrated NVDA book with cash reserve",
      taskType: "portfolio-intelligence" as const,
      prompt: thesisPrompt,
      json: true,
      maxTokens: 1024,
      grade: (raw: string) => {
        const failures: string[] = [];
        const obj = parseJsonOr(raw, failures);
        if (!obj) return failures;
        const thesis = typeof obj.thesis === "string" ? obj.thesis.trim() : "";
        const strengths = Array.isArray(obj.strengths) ? (obj.strengths as unknown[]) : [];
        const risks = Array.isArray(obj.risks) ? (obj.risks as unknown[]) : [];
        if (thesis.length < 60) failures.push("thesis missing or trivially short");
        if (strengths.length < 1) failures.push("no strengths");
        if (risks.length < 1) failures.push("no risks");
        // Each strength/risk must be tied to a figure (the prompt's own rule).
        const uncited = [...strengths, ...risks].filter((s) => typeof s === "string" && !/\d/.test(s));
        if (uncited.length > 0) failures.push(`${uncited.length} strength/risk item(s) cite no figure`);
        // One-figure-one-direction: the 46% NVDA weight is a settled RISK
        // (the alignment concentration finding says so); it must not appear as a strength.
        const asStrength = strengths.some((s) => typeof s === "string" && /46\s?%|46 percent/i.test(s));
        if (asStrength) failures.push("the 46% concentration figure was framed as a strength");
        const grounding = verifyGrounding(JSON.stringify(obj), thesisPrompt);
        const invented = trulyUnsupported(grounding.unsupportedNumbers, thesisPrompt).filter(
          (n) => !derivedPairwise(n, thesisPrompt),
        );
        if (invented.length > 0) {
          failures.push(`ungrounded numbers: ${invented.join(" | ")}`);
        }
        return failures;
      },
    };
  })(),

  /* ── Wire scanner thesis — the batch pipeline (Phase 4 quality gate) ────── */
  (() => {
    const opp = {
      ticker: "ETN", name: "Eaton Corporation", direction: "bullish",
      theme: "Grid capex acceleration", rationale: "Transformer and switchgear backlogs extend as utilities pull forward grid-hardening budgets.",
      quote: { price: 412.5, currency: "USD", changePercent: 1.8, peRatio: 31.2, marketCap: 162_000_000_000 },
      compositeScores: { quality: 78, value: 41, growth: 72, financialHealth: 66, momentum: 70 },
      sourceEventIds: ["ev1"],
    } as unknown as ScannerOpportunity;
    const events = [
      {
        id: "ev1",
        headline: "US utilities raise 2027 grid capex plans by 18% on data-center load growth",
        summary: "Regulated utilities filed revised capital plans citing multi-year interconnection queues.",
        causalChain: [
          { order: 1, description: "Higher approved capex flows to transmission and substation equipment orders" },
          { order: 2, description: "Electrical-equipment lead times extend, supporting pricing" },
        ],
      },
    ] as unknown as MarketEvent[];
    const sectorImpact = {
      sector: "Industrials", direction: "positive", strength: 72,
      rationale: "Grid equipment names carry multi-year backlogs; capex revisions extend visibility.",
    } as unknown as SectorImpact;

    const prompt = buildScannerThesisPrompt(opp, events, sectorImpact);
    return {
      name: "wire-thesis — ETN grid-capex opportunity",
      taskType: "wire-thesis" as const,
      prompt,
      json: true,
      maxTokens: 2048,
      grade: (raw: string) => {
        const failures: string[] = [];
        const obj = parseJsonOr(raw, failures);
        if (!obj) return failures;
        const parsed = ScannerThesisWireSchema.safeParse(obj);
        if (!parsed.success) {
          failures.push(`schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
          return failures;
        }
        const d = obj as Record<string, unknown>;
        const headline = typeof d.headline === "string" ? d.headline : "";
        if (headline.split(/\s+/).length > 14) failures.push("headline exceeds the ~10-word budget");
        for (const key of ["bullCase", "bearCase", "keyCatalysts", "keyRisks"] as const) {
          const arr = Array.isArray(d[key]) ? (d[key] as unknown[]) : [];
          if (arr.length < 3) failures.push(`${key}: expected 3 items, got ${arr.length}`);
        }
        // The Wire generates dozens of these per day: an answer that balloons
        // to several thousand tokens is a latency and spend bug even when its
        // content is fine. The schema asks for ~10 short fields; 6000 chars is
        // roughly double a generous complete answer.
        if (raw.length > 6000) failures.push(`output is ${raw.length} chars — far beyond the schema's budget`);
        // Grounding is checked over the EVIDENCE-BOUND fields: headline,
        // summary, and the bull case argue from the dossier, so their figures
        // must trace to it. keyCatalysts/keyRisks/bearCase/timeHorizon are
        // FORWARD-LOOKING by the schema's own instruction ("upcoming
        // catalyst") — models legitimately write "2027–2028" and "12–24
        // months" there, which the numeric verifier reads as invented
        // negatives. Every model tested, including the production baseline,
        // tripped that artifact; scoping the check is grader correctness, not
        // a relaxation of the evidence standard where evidence applies.
        const grounded = JSON.stringify({ headline: d.headline, summary: d.summary, bullCase: d.bullCase });
        const grounding = verifyGrounding(grounded, prompt);
        const invented = trulyUnsupported(grounding.unsupportedNumbers, prompt);
        if (invented.length > 0) {
          failures.push(`ungrounded numbers: ${invented.join(" | ")}`);
        }
        return failures;
      },
    };
  })(),
];
