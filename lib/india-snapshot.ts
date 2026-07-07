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
 */
import type { ScreenerInCompany } from "./screener-in";
import type { Recommendation } from "./types";

export interface IndiaDerivedInputs {
  debtToEquity: number | null;
  interestCoverage: number | null;
  evToEbitda: number | null;
  priceToBook: number | null;
}

export type IndiaVerdictLabel = "Strong Buy" | "Accumulate" | "Hold" | "Reduce" | "Avoid";

export interface IndiaSnapshotVerdict {
  label: IndiaVerdictLabel;
  style: string;
}

/** Map the India verdict onto the shared Recommendation enum so other modules
 *  (e.g. the Macro Context ladder) render India stocks from screener.in too. */
const VERDICT_TO_RECOMMENDATION: Record<IndiaVerdictLabel, Recommendation> = {
  "Strong Buy": "STRONG_BUY",
  Accumulate: "BUY",
  Hold: "HOLD",
  Reduce: "SELL",
  Avoid: "STRONG_SELL",
};

export interface IndiaSnapshot {
  quality: number;
  valuation: number;
  growth: number;
  capitalAllocation: number;
  /** Weighted composite (0–100) — the one headline score for Indian stocks. */
  composite: number;
  verdict: IndiaSnapshotVerdict;
  /** The verdict expressed on the shared Recommendation enum. */
  recommendation: Recommendation;
  strengths: string[];
  risks: string[];
}

/** Composite weighting — kept in one place so the ring, verdict and hero agree. */
const WEIGHTS = { quality: 0.35, valuation: 0.25, growth: 0.25, capitalAllocation: 0.15 } as const;

export function scoreQuality(
  c: ScreenerInCompany,
  debtToEquity: number | null,
  interestCoverage: number | null,
): number {
  let score = 0;
  // ROCE (0–30)
  if (c.roce != null) {
    if (c.roce >= 25) score += 30;
    else if (c.roce >= 20) score += 24;
    else if (c.roce >= 15) score += 18;
    else if (c.roce >= 10) score += 10;
    else score += 4;
  }
  // ROE (0–25)
  if (c.roe != null) {
    if (c.roe >= 20) score += 25;
    else if (c.roe >= 15) score += 20;
    else if (c.roe >= 12) score += 14;
    else if (c.roe >= 8) score += 8;
    else score += 3;
  }
  // Leverage (0–25)
  if (debtToEquity != null) {
    if (debtToEquity <= 0.3) score += 25;
    else if (debtToEquity <= 0.5) score += 20;
    else if (debtToEquity <= 1) score += 14;
    else if (debtToEquity <= 2) score += 7;
    else score += 2;
  } else {
    score += 15; // neutral if unknown
  }
  // Interest coverage (0–20)
  if (interestCoverage != null) {
    if (interestCoverage >= 8) score += 20;
    else if (interestCoverage >= 5) score += 16;
    else if (interestCoverage >= 3) score += 10;
    else if (interestCoverage >= 1.5) score += 5;
    else score += 1;
  } else {
    score += 12; // neutral
  }
  return Math.min(100, score);
}

export function scoreValuation(
  c: ScreenerInCompany,
  evToEbitda: number | null,
  priceToBook: number | null,
): number {
  let score = 0;
  // P/E (0–35) — lower = better for value
  if (c.pe != null) {
    if (c.pe <= 12) score += 35;
    else if (c.pe <= 18) score += 28;
    else if (c.pe <= 25) score += 20;
    else if (c.pe <= 35) score += 12;
    else if (c.pe <= 50) score += 6;
    else score += 2;
  }
  // EV/EBITDA (0–30)
  if (evToEbitda != null) {
    if (evToEbitda <= 8) score += 30;
    else if (evToEbitda <= 12) score += 22;
    else if (evToEbitda <= 16) score += 14;
    else if (evToEbitda <= 22) score += 7;
    else score += 2;
  } else {
    score += 15;
  }
  // P/B (0–20)
  if (priceToBook != null) {
    if (priceToBook <= 2) score += 20;
    else if (priceToBook <= 4) score += 14;
    else if (priceToBook <= 7) score += 8;
    else score += 2;
  } else {
    score += 10;
  }
  // Dividend yield bonus (0–15)
  if (c.dividendYield != null) {
    if (c.dividendYield >= 3) score += 15;
    else if (c.dividendYield >= 2) score += 10;
    else if (c.dividendYield >= 1) score += 5;
  }
  return Math.min(100, score);
}

export function scoreGrowth(c: ScreenerInCompany): number {
  const growthRatio = c.ratios.find(
    (r) => r.name.toLowerCase().includes("sales growth") || r.name.toLowerCase().includes("revenue growth"),
  );
  const profitGrowthRatio = c.ratios.find(
    (r) => r.name.toLowerCase().includes("profit growth") || r.name.toLowerCase().includes("net profit"),
  );

  const annualSales = c.annualPL.map((d) => d.sales).filter((v): v is number => v != null);
  const annualProfit = c.annualPL.map((d) => d.netProfit).filter((v): v is number => v != null);

  let score = 50; // start neutral

  if (growthRatio) {
    const vals = growthRatio.values.map((v) => parseFloat(v.value)).filter((n) => isFinite(n));
    const recent = vals.slice(-3);
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    if (avg != null) {
      if (avg >= 20) score = 90;
      else if (avg >= 15) score = 78;
      else if (avg >= 10) score = 65;
      else if (avg >= 5) score = 50;
      else if (avg >= 0) score = 35;
      else score = 20;
    }
  } else if (annualSales.length >= 3) {
    const first = annualSales[0];
    const last = annualSales[annualSales.length - 1];
    if (first && last && first > 0) {
      const cagr = ((last / first) ** (1 / (annualSales.length - 1)) - 1) * 100;
      if (cagr >= 20) score = 90;
      else if (cagr >= 15) score = 78;
      else if (cagr >= 10) score = 65;
      else if (cagr >= 5) score = 50;
      else if (cagr >= 0) score = 35;
      else score = 20;
    }
  }

  if (profitGrowthRatio) {
    const lastVal = parseFloat(profitGrowthRatio.values.at(-1)?.value ?? "");
    if (isFinite(lastVal) && lastVal >= 15) score = Math.min(100, score + 8);
  } else if (annualProfit.length >= 2) {
    const pFirst = annualProfit[0];
    const pLast = annualProfit[annualProfit.length - 1];
    if (pFirst != null && pLast != null && pFirst > 0) {
      const profitGrowth = ((pLast - pFirst) / Math.abs(pFirst)) * 100 / Math.max(1, annualProfit.length - 1);
      if (profitGrowth >= 15) score = Math.min(100, score + 8);
    }
  }

  return Math.min(100, Math.max(0, score));
}

export function scoreCapitalAllocation(c: ScreenerInCompany, debtToEquity: number | null): number {
  let score = 50;
  const roceHistory = c.ratios.find((r) => r.name.toLowerCase().includes("roce"));
  if (roceHistory) {
    const vals = roceHistory.values.map((v) => parseFloat(v.value)).filter((n) => isFinite(n));
    if (vals.length >= 3) {
      const trend = vals[vals.length - 1] - vals[vals.length - 3];
      if (trend > 3) score += 20;
      else if (trend > 0) score += 10;
      else if (trend > -3) score -= 5;
      else score -= 15;
    }
  }
  if (debtToEquity != null) {
    if (debtToEquity <= 0.5) score += 15;
    else if (debtToEquity <= 1) score += 5;
    else score -= 10;
  }
  if (c.dividendYield != null && c.dividendYield > 1) score += 10;
  if (c.roce != null && c.roce >= 15) score += 10;

  return Math.min(100, Math.max(0, score));
}

export function overallVerdict(composite: number): IndiaSnapshotVerdict {
  if (composite >= 78) return { label: "Strong Buy", style: "text-positive border-positive/40 bg-positive/12" };
  if (composite >= 62) return { label: "Accumulate", style: "text-positive border-positive/30 bg-positive/8" };
  if (composite >= 46) return { label: "Hold", style: "text-warning border-warning/40 bg-warning/10" };
  if (composite >= 30) return { label: "Reduce", style: "text-negative border-negative/30 bg-negative/8" };
  return { label: "Avoid", style: "text-negative border-negative/40 bg-negative/12" };
}

function computeStrengths(
  c: ScreenerInCompany,
  debtToEquity: number | null,
  interestCoverage: number | null,
  evToEbitda: number | null,
): string[] {
  const s: string[] = [];
  if (c.roce != null && c.roce >= 20) s.push(`High capital returns (ROCE ${c.roce.toFixed(1)}%)`);
  else if (c.roce != null && c.roce >= 15) s.push(`Decent capital efficiency (ROCE ${c.roce.toFixed(1)}%)`);
  if (c.roe != null && c.roe >= 18) s.push(`Strong ROE of ${c.roe.toFixed(1)}%`);
  if (debtToEquity != null && debtToEquity <= 0.5) s.push("Low financial leverage (D/E ≤ 0.5x)");
  if (interestCoverage != null && interestCoverage >= 5) s.push("Comfortable debt servicing capacity");
  if (c.dividendYield != null && c.dividendYield >= 2) s.push(`Attractive dividend yield (${c.dividendYield.toFixed(1)}%)`);
  if (c.pe != null && c.pe <= 18) s.push(`Reasonable valuation (P/E ${c.pe.toFixed(1)}x)`);
  if (evToEbitda != null && evToEbitda <= 10) s.push(`Low EV/EBITDA of ${evToEbitda.toFixed(1)}x`);
  if (c.promoterHolding != null && c.promoterHolding >= 60) s.push(`High promoter conviction (${c.promoterHolding.toFixed(1)}%)`);
  const revenueGrowth = c.ratios.find((r) => r.name.toLowerCase().includes("sales growth"));
  if (revenueGrowth) {
    const recent = parseFloat(revenueGrowth.values.at(-1)?.value ?? "");
    if (isFinite(recent) && recent >= 15) s.push(`Strong revenue growth (${recent.toFixed(0)}% recently)`);
  }
  return s.slice(0, 5);
}

function computeRisks(
  c: ScreenerInCompany,
  debtToEquity: number | null,
  interestCoverage: number | null,
  evToEbitda: number | null,
): string[] {
  const r: string[] = [];
  if (c.pe != null && c.pe > 35) r.push(`Expensive valuation (P/E ${c.pe.toFixed(1)}x)`);
  else if (c.pe != null && c.pe > 25) r.push(`Premium valuation demands growth execution`);
  if (debtToEquity != null && debtToEquity > 1.5) r.push(`High leverage (D/E ${debtToEquity.toFixed(1)}x)`);
  if (interestCoverage != null && interestCoverage < 2) r.push("Thin interest coverage — earnings vulnerable to rate rises");
  if (c.promoterHolding != null && c.promoterHolding < 35) r.push("Low promoter stake may signal reduced alignment");
  if (evToEbitda != null && evToEbitda > 20) r.push(`Stretched EV/EBITDA (${evToEbitda.toFixed(1)}x)`);
  if (c.roe != null && c.roe < 10) r.push(`Below-par ROE (${c.roe.toFixed(1)}%) — low capital efficiency`);
  if (c.roce != null && c.roce < 10) r.push(`Weak ROCE (${c.roce.toFixed(1)}%) — returns below cost of capital`);
  const revenueGrowth = c.ratios.find((rr) => rr.name.toLowerCase().includes("sales growth"));
  if (revenueGrowth) {
    const recent = parseFloat(revenueGrowth.values.at(-1)?.value ?? "");
    if (isFinite(recent) && recent < 5) r.push("Slowing revenue momentum");
  }
  return r.slice(0, 5);
}

/**
 * The one place that turns screener.in company data into the Indian conviction
 * snapshot. Both the InvestmentSnapshot card and the research page's DecisionHero
 * consume this, guaranteeing a single coherent score.
 */
export function computeIndiaSnapshot(
  company: ScreenerInCompany,
  derived: IndiaDerivedInputs,
): IndiaSnapshot {
  const quality = scoreQuality(company, derived.debtToEquity, derived.interestCoverage);
  const valuation = scoreValuation(company, derived.evToEbitda, derived.priceToBook);
  const growth = scoreGrowth(company);
  const capitalAllocation = scoreCapitalAllocation(company, derived.debtToEquity);
  const composite = Math.round(
    quality * WEIGHTS.quality +
      valuation * WEIGHTS.valuation +
      growth * WEIGHTS.growth +
      capitalAllocation * WEIGHTS.capitalAllocation,
  );
  const verdict = overallVerdict(composite);
  return {
    quality,
    valuation,
    growth,
    capitalAllocation,
    composite,
    verdict,
    recommendation: VERDICT_TO_RECOMMENDATION[verdict.label],
    strengths: computeStrengths(company, derived.debtToEquity, derived.interestCoverage, derived.evToEbitda),
    risks: computeRisks(company, derived.debtToEquity, derived.interestCoverage, derived.evToEbitda),
  };
}
