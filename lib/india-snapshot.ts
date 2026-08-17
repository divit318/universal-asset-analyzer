/**
 * India investment snapshot scoring — the single source of truth for the
 * conviction score shown on Indian (NSE/BSE) research.
 *
 * For Indian equities, screener.in is the authoritative fundamentals source;
 * Yahoo Finance coverage of NSE/BSE names is frequently incomplete or stale.
 * The research page therefore scores Indian stocks from screener.in data ONLY,
 * and must never mix in the Yahoo composite (that produced two contradictory
 * headline scores). This module is pure/testable so both the UI card and the
 * page-level hero derive the exact same numbers.
 *
 * Missing-data policy (2026-08 rework): a factor with no data is EXCLUDED and
 * the bucket renormalizes over what remains — never silently scored "neutral".
 * A factor that does not apply to the company (leverage math for a bank) is
 * tracked separately as notApplicable. The snapshot reports both lists so the
 * UI can say what the score is actually built on.
 */
import type {
  ScreenerInCompany,
  ScreenerInAnnualPL,
  ScreenerInStatements,
  ScreenerInStatementRow,
} from "./screener-in";
import { indianFiscalLabel } from "./format";
import { RECOMMENDATION_TONE, scoreToRecommendation } from "./recommendation";
import type { Recommendation } from "./types";

/* -------------------------------------------------------------------------- */
/* Statement accessors (pure — this module is imported by client components,  */
/* so it must only take TYPE imports from lib/screener-in)                    */
/* -------------------------------------------------------------------------- */

/** Case-insensitive exact-name lookup in a statement table. */
export function statementRow(
  stmt: ScreenerInStatements | null,
  ...names: string[]
): ScreenerInStatementRow | null {
  if (!stmt) return null;
  for (const n of names) {
    const row = stmt.rows.find((r) => r.name.toLowerCase() === n.toLowerCase());
    if (row) return row;
  }
  return null;
}

/** Latest value of a statement row, by exact name (first match wins). */
export function latestStatementValue(
  stmt: ScreenerInStatements | null,
  ...names: string[]
): number | null {
  return statementRow(stmt, ...names)?.values.at(-1) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Derived fundamentals                                                       */
/* -------------------------------------------------------------------------- */

export interface IndiaLatestQuarter {
  period: string;             // "Jun 2026"
  fiscalLabel: string;        // "Q1 FY27"
  sales: number | null;       // ₹ Cr
  netProfit: number | null;   // ₹ Cr
  eps: number | null;         // ₹
  salesYoYPercent: number | null;
  netProfitYoYPercent: number | null;
}

/**
 * Everything computable from a screener.in company record, derived in ONE
 * place so the API route, the AI prompts and the watchlist fit scorer can
 * never disagree. All monetary values are ₹ Cr on the company's stated
 * reporting basis (`basis`).
 */
export interface IndiaDerivedFundamentals {
  basis: "consolidated" | "standalone" | null;
  statementKind: "industrial" | "financial";
  /** Equity Capital + Reserves, latest balance-sheet column. */
  totalEquity: number | null;
  /** Borrowings, latest balance-sheet column (banks: excludes Deposits). */
  totalDebt: number | null;
  /** Banks/NBFCs only. */
  deposits: number | null;
  /** Borrowings / total equity. Not applicable to financials; null when equity ≤ 0. */
  debtToEquity: number | null;
  /** (Operating profit + other income − depreciation) / interest, latest full FY.
   *  Not applicable to financials; null when interest < ₹1 Cr (effectively debt-free). */
  interestCoverage: number | null;
  /** Market cap / total equity; falls back to price / book value per share. */
  priceToBook: number | null;
  /** Market cap / TTM (or latest FY) sales. */
  priceToSales: number | null;
  /** Not computable: cash & equivalents sit inside screener.in's collapsed
   *  "Other Assets" breakdown, which needs a per-row AJAX call. Kept in the
   *  shape so callers don't invent their own — always null for now. */
  evToEbitda: number | null;
  salesGrowthYoYPercent: number | null;   // latest full FY vs prior
  salesCagr3yPercent: number | null;      // 3-year CAGR over full FYs
  profitGrowthYoYPercent: number | null;
  operatingCashFlow: number | null;       // latest FY, ₹ Cr
  freeCashFlow: number | null;            // latest FY, ₹ Cr (source-reported)
  netCashFlow: number | null;
  grossNpaPercent: number | null;         // financials, latest reported quarter
  netNpaPercent: number | null;
  latestQuarter: IndiaLatestQuarter | null;
  latestAnnualPeriod: string | null;      // "Mar 2026" — latest full FY column
  /** Metrics that apply to this company but had no data. */
  missing: string[];
  /** Metrics that do not apply to this company kind (e.g. D/E for a bank). */
  notApplicable: string[];
}

const FULL_FY_RE = /^[A-Za-z]{3}\s+\d{4}$/;

/** Annual rows that are real fiscal years (drops the "TTM" column). */
function fullFiscalYears(annualPL: ScreenerInAnnualPL[]): ScreenerInAnnualPL[] {
  return annualPL.filter((r) => FULL_FY_RE.test(r.period));
}

function pctChange(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function deriveIndiaFundamentals(c: ScreenerInCompany): IndiaDerivedFundamentals {
  const missing: string[] = [];
  const notApplicable: string[] = [];
  const financial = c.statementKind === "financial";

  const equityCapital = latestStatementValue(c.balanceSheet, "Equity Capital", "Share Capital");
  const reserves = latestStatementValue(c.balanceSheet, "Reserves");
  const totalEquity = equityCapital != null || reserves != null
    ? (equityCapital ?? 0) + (reserves ?? 0)
    : null;
  const totalDebt = latestStatementValue(c.balanceSheet, "Borrowings", "Borrowing");
  const deposits = financial ? latestStatementValue(c.balanceSheet, "Deposits") : null;
  if (totalEquity == null) missing.push("total equity");
  if (totalDebt == null) missing.push("borrowings");

  // Leverage / coverage — industrial companies only. For banks and NBFCs,
  // borrowing IS the business; a D/E ratio or interest coverage computed the
  // industrial way would flag every healthy lender as distressed.
  let debtToEquity: number | null = null;
  let interestCoverage: number | null = null;
  if (financial) {
    notApplicable.push("debt/equity", "interest coverage");
  } else {
    debtToEquity = totalDebt != null && totalEquity != null && totalEquity > 0
      ? Number((totalDebt / totalEquity).toFixed(2))
      : null;
    if (debtToEquity == null) missing.push("debt/equity");

    const fys = fullFiscalYears(c.annualPL);
    const latestFy = fys.at(-1);
    if (latestFy?.interest != null && latestFy.interest >= 1 &&
        latestFy.operatingProfit != null) {
      const ebit = latestFy.operatingProfit + (latestFy.otherIncome ?? 0) - (latestFy.depreciation ?? 0);
      interestCoverage = Number((ebit / latestFy.interest).toFixed(1));
    } else if (latestFy?.interest != null && latestFy.interest < 1) {
      notApplicable.push("interest coverage (negligible interest)");
    } else {
      missing.push("interest coverage");
    }
  }

  const priceToBook =
    c.marketCap != null && totalEquity != null && totalEquity > 0
      ? Number((c.marketCap / totalEquity).toFixed(2))
      : c.currentPrice != null && c.bookValue != null && c.bookValue > 0
        ? Number((c.currentPrice / c.bookValue).toFixed(2))
        : null;
  if (priceToBook == null) missing.push("price/book");

  const fys = fullFiscalYears(c.annualPL);
  const ttmSales = c.annualPL.find((r) => r.period.toUpperCase() === "TTM")?.sales ?? null;
  const salesForPs = ttmSales ?? fys.at(-1)?.sales ?? null;
  const priceToSales = c.marketCap != null && salesForPs != null && salesForPs > 0
    ? Number((c.marketCap / salesForPs).toFixed(2))
    : null;

  const last = fys.at(-1);
  const prior = fys.at(-2);
  const salesGrowthYoYPercent = pctChange(last?.sales ?? null, prior?.sales ?? null);
  const profitGrowthYoYPercent = pctChange(last?.netProfit ?? null, prior?.netProfit ?? null);
  let salesCagr3yPercent: number | null = null;
  if (fys.length >= 4) {
    const base = fys.at(-4)?.sales;
    const end = last?.sales;
    if (base != null && base > 0 && end != null && end > 0) {
      salesCagr3yPercent = Number((((end / base) ** (1 / 3) - 1) * 100).toFixed(1));
    }
  }
  if (salesGrowthYoYPercent == null && salesCagr3yPercent == null) missing.push("sales growth");

  const operatingCashFlow = latestStatementValue(c.cashFlow, "Cash from Operating Activity");
  const freeCashFlow = latestStatementValue(c.cashFlow, "Free Cash Flow");
  const netCashFlow = latestStatementValue(c.cashFlow, "Net Cash Flow");
  if (operatingCashFlow == null) missing.push("operating cash flow");

  const latestQ = c.quarterlyPL.at(-1) ?? null;
  const yoyQ = latestQ ? c.quarterlyPL.find((q, i) =>
    i === c.quarterlyPL.length - 5 &&
    q.period.slice(0, 3).toLowerCase() === latestQ.period.slice(0, 3).toLowerCase(),
  ) ?? null : null;
  const latestQuarter: IndiaLatestQuarter | null = latestQ
    ? {
        period: latestQ.period,
        fiscalLabel: indianFiscalLabel(latestQ.period),
        sales: latestQ.sales,
        netProfit: latestQ.netProfit,
        eps: latestQ.eps ?? null,
        salesYoYPercent: pctChange(latestQ.sales, yoyQ?.sales ?? null),
        netProfitYoYPercent: pctChange(latestQ.netProfit, yoyQ?.netProfit ?? null),
      }
    : null;
  if (latestQuarter == null) missing.push("quarterly results");

  const grossNpaPercent = financial ? (latestQ?.grossNpaPercent ?? null) : null;
  const netNpaPercent = financial ? (latestQ?.netNpaPercent ?? null) : null;
  if (financial && netNpaPercent == null) missing.push("NPA");

  return {
    basis: c.basis,
    statementKind: c.statementKind,
    totalEquity,
    totalDebt,
    deposits,
    debtToEquity,
    interestCoverage,
    priceToBook,
    priceToSales,
    evToEbitda: null,
    salesGrowthYoYPercent,
    salesCagr3yPercent,
    profitGrowthYoYPercent,
    operatingCashFlow,
    freeCashFlow,
    netCashFlow,
    grossNpaPercent,
    netNpaPercent,
    latestQuarter,
    latestAnnualPeriod: last?.period ?? null,
    missing,
    notApplicable,
  };
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

export type IndiaVerdictLabel = "Strong Buy" | "Accumulate" | "Hold" | "Reduce" | "Avoid";

export interface IndiaSnapshotVerdict {
  label: IndiaVerdictLabel;
  style: string;
}

/** India-market vocabulary over the canonical 5 tiers. The words differ from
 *  the US labels (Accumulate/Reduce is how Indian brokerage research speaks),
 *  but the underlying bands are lib/recommendation.ts's TIER_EDGES — a 61 is a
 *  BUY-tier score whether the page renders "Buy" or "Accumulate". */
const INDIA_VERDICT_LABEL: Record<Recommendation, IndiaVerdictLabel> = {
  STRONG_BUY: "Strong Buy",
  BUY: "Accumulate",
  HOLD: "Hold",
  SELL: "Reduce",
  STRONG_SELL: "Avoid",
};

export interface IndiaDataQuality {
  /** Share of applicable scoring factors that actually had data (0–1). */
  coverage: number;
  /** Applicable factors with no data — the score renormalized around these. */
  missing: string[];
  /** Factors that do not apply to this company kind. */
  notApplicable: string[];
}

export interface IndiaSnapshot {
  /** Bucket scores, 0–100 over the factors that had data; null = no data at all. */
  quality: number | null;
  valuation: number | null;
  growth: number | null;
  capitalAllocation: number | null;
  /** Weighted composite (0–100) over available buckets — the one headline score. */
  composite: number;
  verdict: IndiaSnapshotVerdict;
  /** The verdict expressed on the shared Recommendation enum. */
  recommendation: Recommendation;
  strengths: string[];
  risks: string[];
  dataQuality: IndiaDataQuality;
}

/** Composite weighting — kept in one place so the ring, verdict and hero agree. */
const WEIGHTS = { quality: 0.35, valuation: 0.25, growth: 0.25, capitalAllocation: 0.15 } as const;

interface Factor {
  label: string;
  max: number;
  /** null = no data (factor excluded and bucket renormalized). */
  points: number | null;
}

interface BucketScore {
  score: number | null;
  missing: string[];
  /** Applicable factors with data / total applicable factors. */
  availableCount: number;
  totalCount: number;
}

/** Score a bucket over its available factors only — no half-credit for gaps. */
function scoreBucket(factors: Factor[]): BucketScore {
  const available = factors.filter((f) => f.points != null);
  const missing = factors.filter((f) => f.points == null).map((f) => f.label);
  const counts = { availableCount: available.length, totalCount: factors.length };
  if (available.length === 0) return { score: null, missing, ...counts };
  const points = available.reduce((s, f) => s + (f.points as number), 0);
  const max = available.reduce((s, f) => s + f.max, 0);
  return { score: Math.round((points / max) * 100), missing, ...counts };
}

function band(value: number, edges: [number, number][], fallback: number): number {
  for (const [threshold, points] of edges) if (value >= threshold) return points;
  return fallback;
}

function bandLow(value: number, edges: [number, number][], fallback: number): number {
  for (const [threshold, points] of edges) if (value <= threshold) return points;
  return fallback;
}

export function scoreQuality(c: ScreenerInCompany, d: IndiaDerivedFundamentals): BucketScore {
  const financial = d.statementKind === "financial";
  const factors: Factor[] = [
    { label: "ROCE", max: 30, points: c.roce == null ? null : band(c.roce, [[25, 30], [20, 24], [15, 18], [10, 10]], 4) },
    { label: "ROE", max: 25, points: c.roe == null ? null : band(c.roe, [[20, 25], [15, 20], [12, 14], [8, 8]], 3) },
  ];
  if (!financial) {
    factors.push(
      { label: "leverage", max: 25, points: d.debtToEquity == null ? null : bandLow(d.debtToEquity, [[0.3, 25], [0.5, 20], [1, 14], [2, 7]], 2) },
      { label: "interest coverage", max: 20, points: d.interestCoverage == null ? null : band(d.interestCoverage, [[8, 20], [5, 16], [3, 10], [1.5, 5]], 1) },
    );
  } else if (d.netNpaPercent != null) {
    // Asset quality is the bank analogue of the leverage factors.
    factors.push({ label: "asset quality (net NPA)", max: 25, points: bandLow(d.netNpaPercent, [[0.5, 25], [1, 20], [2, 12], [3.5, 5]], 1) });
  }
  return scoreBucket(factors);
}

export function scoreValuation(c: ScreenerInCompany, d: IndiaDerivedFundamentals): BucketScore {
  const factors: Factor[] = [
    { label: "P/E", max: 35, points: c.pe == null ? null : bandLow(c.pe, [[12, 35], [18, 28], [25, 20], [35, 12], [50, 6]], 2) },
    { label: "EV/EBITDA", max: 30, points: d.evToEbitda == null ? null : bandLow(d.evToEbitda, [[8, 30], [12, 22], [16, 14], [22, 7]], 2) },
    { label: "P/B", max: 20, points: d.priceToBook == null ? null : bandLow(d.priceToBook, [[2, 20], [4, 14], [7, 8]], 2) },
    { label: "dividend yield", max: 15, points: c.dividendYield == null ? null : band(c.dividendYield, [[3, 15], [2, 10], [1, 5]], 0) },
  ];
  return scoreBucket(factors);
}

export function scoreGrowth(c: ScreenerInCompany, d: IndiaDerivedFundamentals): BucketScore {
  const growthPct = d.salesCagr3yPercent ?? d.salesGrowthYoYPercent;
  const factors: Factor[] = [
    { label: "sales growth", max: 70, points: growthPct == null ? null : band(growthPct, [[20, 66], [15, 56], [10, 46], [5, 35], [0, 24]], 14) },
    { label: "profit growth", max: 30, points: d.profitGrowthYoYPercent == null ? null : band(d.profitGrowthYoYPercent, [[20, 30], [15, 25], [8, 18], [0, 12]], 4) },
  ];
  return scoreBucket(factors);
}

export function scoreCapitalAllocation(c: ScreenerInCompany, d: IndiaDerivedFundamentals): BucketScore {
  const financial = d.statementKind === "financial";
  // ROCE trend from the ratios table history (present for most industrials).
  const roceHistory = c.ratios.find((r) => r.name.toLowerCase().includes("roce"));
  let trendPoints: number | null = null;
  if (roceHistory) {
    const vals = roceHistory.values.map((v) => parseFloat(v.value)).filter((n) => isFinite(n));
    if (vals.length >= 3) {
      const trend = vals[vals.length - 1] - vals[vals.length - 3];
      trendPoints = trend > 3 ? 30 : trend > 0 ? 22 : trend > -3 ? 12 : 4;
    }
  }
  const factors: Factor[] = [
    { label: "ROCE trend", max: 30, points: trendPoints },
    { label: "returns level", max: 25, points: c.roce == null && c.roe == null ? null : band(Math.max(c.roce ?? -Infinity, c.roe ?? -Infinity), [[18, 25], [14, 18], [10, 10]], 4) },
    { label: "dividend", max: 15, points: c.dividendYield == null ? null : band(c.dividendYield, [[1.5, 15], [0.75, 10], [0.25, 5]], 2) },
  ];
  if (!financial) {
    factors.push({ label: "balance-sheet discipline", max: 30, points: d.debtToEquity == null ? null : bandLow(d.debtToEquity, [[0.5, 30], [1, 20], [2, 8]], 2) });
  }
  return scoreBucket(factors);
}

/** The India verdict is the canonical band of the composite, in India-market
 *  words and the canonical badge tone. Previously banded at 78/62/46/30 —
 *  which made a composite of 61 read "Hold" here while every other surface
 *  called the same 61 a Buy. NOTE: whether India deserves its own calibrated
 *  edges (as a named variant of lib/recommendation.ts, never a private table)
 *  is a documented open question — see "Known open calibration question —
 *  India verdict bands" in ARCHITECTURE.md. */
export function overallVerdict(composite: number): IndiaSnapshotVerdict {
  const rec = scoreToRecommendation(composite);
  return { label: INDIA_VERDICT_LABEL[rec], style: RECOMMENDATION_TONE[rec] };
}

function computeStrengths(c: ScreenerInCompany, d: IndiaDerivedFundamentals): string[] {
  const s: string[] = [];
  const financial = d.statementKind === "financial";
  if (c.roce != null && c.roce >= 20) s.push(`High capital returns (ROCE ${c.roce.toFixed(1)}%)`);
  else if (c.roce != null && c.roce >= 15) s.push(`Decent capital efficiency (ROCE ${c.roce.toFixed(1)}%)`);
  if (c.roe != null && c.roe >= 18) s.push(`Strong ROE of ${c.roe.toFixed(1)}%`);
  if (financial && d.netNpaPercent != null && d.netNpaPercent <= 1) {
    s.push(`Healthy asset quality (net NPA ${d.netNpaPercent.toFixed(2)}%)`);
  }
  if (!financial && d.debtToEquity != null && d.debtToEquity <= 0.5) s.push(`Low financial leverage (D/E ${d.debtToEquity.toFixed(2)}x)`);
  if (!financial && d.interestCoverage != null && d.interestCoverage >= 5) s.push(`Comfortable debt servicing (${d.interestCoverage.toFixed(1)}x interest cover)`);
  if (!financial && d.freeCashFlow != null && d.freeCashFlow > 0 && d.operatingCashFlow != null && d.operatingCashFlow > 0) {
    s.push(`Positive free cash flow (₹${Math.round(d.freeCashFlow).toLocaleString("en-IN")} Cr in ${d.latestAnnualPeriod ?? "latest FY"})`);
  }
  if (c.dividendYield != null && c.dividendYield >= 2) s.push(`Attractive dividend yield (${c.dividendYield.toFixed(1)}%)`);
  if (c.pe != null && c.pe <= 18) s.push(`Reasonable valuation (P/E ${c.pe.toFixed(1)}x)`);
  if (c.promoterHolding != null && c.promoterHolding >= 60) s.push(`High promoter conviction (${c.promoterHolding.toFixed(1)}%)`);
  const growth = d.salesCagr3yPercent ?? d.salesGrowthYoYPercent;
  if (growth != null && growth >= 15) s.push(`Strong revenue growth (${growth.toFixed(0)}%/yr)`);
  return s.slice(0, 5);
}

function computeRisks(c: ScreenerInCompany, d: IndiaDerivedFundamentals): string[] {
  const r: string[] = [];
  const financial = d.statementKind === "financial";
  if (c.pe != null && c.pe > 35) r.push(`Expensive valuation (P/E ${c.pe.toFixed(1)}x)`);
  else if (c.pe != null && c.pe > 25) r.push(`Premium valuation demands growth execution`);
  if (financial && d.netNpaPercent != null && d.netNpaPercent > 2.5) {
    r.push(`Elevated net NPA (${d.netNpaPercent.toFixed(2)}%) — asset-quality stress`);
  }
  if (!financial && d.debtToEquity != null && d.debtToEquity > 1.5) r.push(`High leverage (D/E ${d.debtToEquity.toFixed(1)}x)`);
  if (!financial && d.totalEquity != null && d.totalEquity <= 0) r.push("Negative net worth — liabilities exceed shareholder equity");
  if (!financial && d.interestCoverage != null && d.interestCoverage < 2) r.push("Thin interest coverage — earnings vulnerable to rate rises");
  if (!financial && d.freeCashFlow != null && d.freeCashFlow < 0) r.push(`Negative free cash flow in ${d.latestAnnualPeriod ?? "latest FY"}`);
  if (c.promoterHolding != null && c.promoterHolding < 35) r.push("Low promoter stake may signal reduced alignment");
  if (c.roe != null && c.roe < 10) r.push(`Below-par ROE (${c.roe.toFixed(1)}%) — low capital efficiency`);
  if (c.roce != null && c.roce < 10 && !financial) r.push(`Weak ROCE (${c.roce.toFixed(1)}%) — returns below cost of capital`);
  const growth = d.salesGrowthYoYPercent;
  if (growth != null && growth < 5) r.push("Slowing revenue momentum");
  return r.slice(0, 5);
}

/**
 * The one place that turns screener.in company data into the Indian conviction
 * snapshot. Both the InvestmentSnapshot card and the research page's DecisionHero
 * consume this, guaranteeing a single coherent score.
 */
export function computeIndiaSnapshot(
  company: ScreenerInCompany,
  derived: IndiaDerivedFundamentals,
): IndiaSnapshot {
  const quality = scoreQuality(company, derived);
  const valuation = scoreValuation(company, derived);
  const growth = scoreGrowth(company, derived);
  const capitalAllocation = scoreCapitalAllocation(company, derived);

  // Composite over the buckets that have data, weights renormalized. A stock
  // with zero scorable data (shouldn't happen — P/E almost always exists)
  // falls back to a flat Hold at 50 with coverage 0.
  const buckets: [BucketScore, number][] = [
    [quality, WEIGHTS.quality],
    [valuation, WEIGHTS.valuation],
    [growth, WEIGHTS.growth],
    [capitalAllocation, WEIGHTS.capitalAllocation],
  ];
  const available = buckets.filter(([b]) => b.score != null);
  const totalWeight = available.reduce((s, [, w]) => s + w, 0);
  const composite = totalWeight > 0
    ? Math.round(available.reduce((s, [b, w]) => s + (b.score as number) * w, 0) / totalWeight)
    : 50;

  const allMissing = [...new Set([
    ...quality.missing, ...valuation.missing, ...growth.missing, ...capitalAllocation.missing,
  ])];
  const availableFactors = buckets.reduce((s, [b]) => s + b.availableCount, 0);
  const totalFactors = buckets.reduce((s, [b]) => s + b.totalCount, 0);
  const coverage = totalFactors > 0 ? availableFactors / totalFactors : 0;

  const verdict = overallVerdict(composite);
  return {
    quality: quality.score,
    valuation: valuation.score,
    growth: growth.score,
    capitalAllocation: capitalAllocation.score,
    composite,
    verdict,
    recommendation: scoreToRecommendation(composite),
    strengths: computeStrengths(company, derived),
    risks: computeRisks(company, derived),
    dataQuality: {
      coverage,
      missing: allMissing,
      notApplicable: derived.notApplicable,
    },
  };
}
