/**
 * IC Pipeline — Stage 1: Signal Detection Engine.
 *
 * Pure detectors over the structured data. Every detector declares the market
 * it applies to and is only evaluated there (Phase 4: market gating in both
 * directions). Every evaluation is recorded — pass or fail — so the UI can
 * show negative results too (Phase 5.13): a check that ran and found nothing
 * is information; a check that could not run for lack of data is a gap.
 *
 * Rate deltas are percentage points and say so ("fell 3.2pp"), never "%"
 * (Phase 1.9). Money is formatted in the trading currency, never hardcoded $.
 *
 * Categories without a data source (SHARE_DILUTION, GUIDANCE_CUT,
 * MARKET_SHARE_LOSS, ROYALTY_INCREASE, RELATED_PARTY_EXPANSION, CAPEX_SURGE)
 * were removed rather than left advertised-but-dead: a signal library that
 * lists checks it can never fire misstates its own coverage.
 */

import type { FundamentalsSnapshot, FinancialStatements, InsiderActivity } from "./types";
import type { ScreenerInCompany } from "./screener-in";
import { fmtPercent, fmtPp, fmtMultiple, fmtMoneyCompact, deltaPp } from "./ic/format";

export type SignalSeverity = "low" | "medium" | "high";
export type SignalMarket = "US" | "IN" | "ANY";

export type SignalCategory =
  | "MARGIN_COMPRESSION"
  | "REVENUE_DECELERATION"
  | "DEBT_INCREASE"
  | "FCF_DETERIORATION"
  | "VALUATION_STRETCH"
  | "EARNINGS_MISS_STREAK"
  | "INSIDER_SELLING"
  | "ROCE_DROP"
  | "INVENTORY_SPIKE"
  | "WORKING_CAPITAL_DETERIORATION"
  | "FII_SELLING"
  | "DII_BUYING";

export interface DetectedSignal {
  id: string;
  category: SignalCategory;
  severity: SignalSeverity;
  /** One-line description, e.g. "ROCE fell 4.8pp (18.2% → 13.4%)" */
  description: string;
  /** Numbers that back the signal */
  dataPoints: string[];
}

/**
 * The record of one detector evaluation — fired or not (Phase 5.13).
 * `evaluated` false means the data needed was unavailable.
 */
export interface SignalCheck {
  category: SignalCategory;
  label: string;
  market: SignalMarket;
  /** What the detector looks at and over what window. */
  evidence: string;
  /** The firing rule, human-readable. */
  threshold: string;
  evaluated: boolean;
  /** Why it could not be evaluated, when evaluated=false. */
  unavailableReason: string | null;
  fired: boolean;
  signal: DetectedSignal | null;
}

export interface SignalDetectionInput {
  snapshot?: FundamentalsSnapshot;
  statements?: FinancialStatements | null;
  insider?: InsiderActivity;
  epsSurprises?: number[];
  screenerIn?: ScreenerInCompany | null;
  /** Trading currency for money formatting. Defaults to USD. */
  currency?: string;
  /** Resolved market — gates which detectors run. */
  market?: "US" | "IN" | "OTHER";
}

/* -------------------------------------------------------------------------- */
/* Detector plumbing                                                          */
/* -------------------------------------------------------------------------- */

type SeriesPoint = { fy: number; value: number };

interface DetectorDef {
  category: SignalCategory;
  label: string;
  market: SignalMarket;
  evidence: string;
  threshold: string;
  run: (input: SignalDetectionInput) => { signal: DetectedSignal | null } | { unavailable: string };
}

const last = (s: SeriesPoint[] | undefined, n = 1): SeriesPoint | null => s?.at(-n) ?? null;

/* -------------------------------------------------------------------------- */
/* Yahoo/EDGAR-based detectors (any market)                                   */
/* -------------------------------------------------------------------------- */

export function detectMarginCompression(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
): DetectedSignal | null {
  const om = st?.operatingMargin ?? [];
  if (om.length < 2) {
    if (s.operatingMargins == null || s.ebitdaMargins == null) return null;
    const gapPp = deltaPp(s.ebitdaMargins, s.operatingMargins);
    if (gapPp < -15) {
      return {
        id: "margin-compression-snapshot",
        category: "MARGIN_COMPRESSION",
        severity: "medium",
        description: `Large D&A drag: operating margin ${fmtPercent(s.operatingMargins)} sits ${fmtPp(Math.abs(gapPp))} below EBITDA margin ${fmtPercent(s.ebitdaMargins)}`,
        dataPoints: [`Op margin: ${fmtPercent(s.operatingMargins)}`, `EBITDA margin: ${fmtPercent(s.ebitdaMargins)}`],
      };
    }
    return null;
  }

  const latest = last(om)!;
  const prev = last(om, 2)!;
  const dropPp = deltaPp(prev.value, latest.value);

  if (dropPp < -3) {
    return {
      id: "margin-compression-trend",
      category: "MARGIN_COMPRESSION",
      severity: dropPp < -7 ? "high" : "medium",
      description: `Operating margin fell ${fmtPp(Math.abs(dropPp))} (FY${prev.fy} ${fmtPercent(prev.value)} → FY${latest.fy} ${fmtPercent(latest.value)})`,
      dataPoints: [`FY${prev.fy}: ${fmtPercent(prev.value)}`, `FY${latest.fy}: ${fmtPercent(latest.value)}`],
    };
  }
  return null;
}

export function detectRevenueDeceleration(st: FinancialStatements | null): DetectedSignal | null {
  const rev = st?.revenue ?? [];
  if (rev.length < 3) return null;

  const g1 = rev.at(-1)!.value / rev.at(-2)!.value - 1;
  const g0 = rev.at(-2)!.value / rev.at(-3)!.value - 1;
  const decelPp = deltaPp(g0, g1);

  if (decelPp < -5 && g1 < g0) {
    return {
      id: "revenue-deceleration",
      category: "REVENUE_DECELERATION",
      severity: decelPp < -12 ? "high" : "medium",
      description: `Revenue growth decelerated ${fmtPp(Math.abs(decelPp))} (${fmtPercent(g0)} → ${fmtPercent(g1)})`,
      dataPoints: [
        `FY${rev.at(-3)!.fy}→FY${rev.at(-2)!.fy}: ${fmtPercent(g0, { signed: true })}`,
        `FY${rev.at(-2)!.fy}→FY${rev.at(-1)!.fy}: ${fmtPercent(g1, { signed: true })}`,
      ],
    };
  }
  return null;
}

export function detectDebtIncrease(s: FundamentalsSnapshot, currency = "USD"): DetectedSignal | null {
  if (s.debtToEquity == null) return null;

  if (s.debtToEquity > 2) {
    return {
      id: "debt-high",
      category: "DEBT_INCREASE",
      severity: "high",
      description: `Debt/equity elevated at ${fmtMultiple(s.debtToEquity, 2)}`,
      dataPoints: [
        `D/E: ${fmtMultiple(s.debtToEquity, 2)}`,
        `Total debt: ${fmtMoneyCompact(s.totalDebt, currency)}`,
      ],
    };
  }
  if (s.debtToEquity > 1) {
    return {
      id: "debt-elevated",
      category: "DEBT_INCREASE",
      severity: "medium",
      description: `Debt/equity above 1x at ${fmtMultiple(s.debtToEquity, 2)}`,
      dataPoints: [`D/E: ${fmtMultiple(s.debtToEquity, 2)}`],
    };
  }
  return null;
}

export function detectFcfDeterioration(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
  currency = "USD",
): DetectedSignal | null {
  const fcf = st?.freeCashFlow ?? [];
  if (fcf.length < 2) {
    if (s.freeCashflow != null && s.freeCashflow < 0) {
      return {
        id: "fcf-negative",
        category: "FCF_DETERIORATION",
        severity: "high",
        description: `Negative free cash flow: ${fmtMoneyCompact(s.freeCashflow, currency)} (TTM)`,
        dataPoints: [`FCF (TTM): ${fmtMoneyCompact(s.freeCashflow, currency)}`],
      };
    }
    return null;
  }

  const latest = last(fcf)!;
  const prev = last(fcf, 2)!;
  const change = (latest.value - prev.value) / Math.abs(prev.value);

  if (latest.value < 0) {
    return {
      id: "fcf-turned-negative",
      category: "FCF_DETERIORATION",
      severity: "high",
      description: `FCF turned negative in FY${latest.fy}: ${fmtMoneyCompact(latest.value, currency)}`,
      dataPoints: [
        `FY${prev.fy}: ${fmtMoneyCompact(prev.value, currency)}`,
        `FY${latest.fy}: ${fmtMoneyCompact(latest.value, currency)}`,
      ],
    };
  }
  if (change < -0.3 && prev.value > 0) {
    return {
      id: "fcf-decline",
      category: "FCF_DETERIORATION",
      severity: "medium",
      description: `FCF declined ${fmtPercent(Math.abs(change))} year over year`,
      dataPoints: [
        `FY${prev.fy}: ${fmtMoneyCompact(prev.value, currency)}`,
        `FY${latest.fy}: ${fmtMoneyCompact(latest.value, currency)}`,
      ],
    };
  }
  return null;
}

export function detectValuationStretch(s: FundamentalsSnapshot): DetectedSignal | null {
  const flags: string[] = [];

  if (s.pegRatio != null && s.pegRatio > 3) flags.push(`PEG ${s.pegRatio.toFixed(2)}`);
  if (s.priceToBook != null && s.priceToBook > 20) flags.push(`P/B ${fmtMultiple(s.priceToBook)}`);
  if (s.forwardPE != null && s.forwardPE > 40) flags.push(`Fwd P/E ${fmtMultiple(s.forwardPE)}`);

  if (flags.length >= 2) {
    return {
      id: "valuation-stretched",
      category: "VALUATION_STRETCH",
      severity: "medium",
      description: `Valuation stretched on multiple metrics: ${flags.join(", ")}`,
      dataPoints: flags,
    };
  }
  if (flags.length === 1 && (s.pegRatio ?? 0) > 4) {
    return {
      id: "valuation-peg-extreme",
      category: "VALUATION_STRETCH",
      severity: "high",
      description: `Extreme PEG ratio of ${s.pegRatio!.toFixed(2)}: paying steeply for growth`,
      dataPoints: flags,
    };
  }
  return null;
}

export function detectEarningsMissStreak(epsSurprises: number[]): DetectedSignal | null {
  const recent = epsSurprises.slice(0, 4);
  const misses = recent.filter((s) => s < -0.02).length;
  if (misses < 2) return null;
  return {
    id: misses >= 3 ? "earnings-miss-streak" : "earnings-miss-2",
    category: "EARNINGS_MISS_STREAK",
    severity: misses >= 3 ? "high" : "medium",
    description: `${misses} of last ${recent.length} quarters missed EPS estimates`,
    dataPoints: recent.map((s, i) => `Q-${i + 1}: ${fmtPercent(s, { signed: true })}`),
  };
}

export function detectInsiderSelling(insider: InsiderActivity, currency = "USD"): DetectedSignal | null {
  if (insider.sellCount === 0) return null;

  const netMagnitude = Math.abs(insider.netValue);
  if (insider.netValue < -20_000_000 && insider.sellCount >= 3) {
    return {
      id: "insider-selling",
      category: "INSIDER_SELLING",
      severity: netMagnitude > 100_000_000 ? "high" : "medium",
      description: `Net insider selling of ${fmtMoneyCompact(netMagnitude, currency)} across ${insider.sellCount} transactions`,
      dataPoints: [
        `Buys: ${insider.buyCount}`,
        `Sells: ${insider.sellCount}`,
        `Net: ${fmtMoneyCompact(insider.netValue, currency)}`,
      ],
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Indian market (screener.in) detectors                                      */
/* -------------------------------------------------------------------------- */

function ratioSeries(company: ScreenerInCompany, match: (name: string) => boolean): number[] | null {
  const ratio = company.ratios.find((r) => match(r.name.toLowerCase()));
  if (!ratio || ratio.values.length < 2) return null;
  const vals = ratio.values.map((v) => parseFloat(v.value)).filter(Number.isFinite);
  return vals.length >= 2 ? vals : null;
}

export function detectRoceDrop(company: ScreenerInCompany): DetectedSignal | null {
  const vals = ratioSeries(company, (n) => n.includes("roce") || n.includes("return on capital"));
  if (!vals) {
    if (company.roce != null && company.roce < 10) {
      return {
        id: "roce-low",
        category: "ROCE_DROP",
        severity: company.roce < 5 ? "high" : "medium",
        description: `ROCE at ${company.roce.toFixed(1)}%: below cost-of-capital threshold`,
        dataPoints: [`ROCE: ${company.roce.toFixed(1)}%`],
      };
    }
    return null;
  }

  const latest = vals.at(-1)!;
  const prev = vals.at(-2)!;
  const dropPp = prev - latest; // screener.in ROCE values are already in points

  if (dropPp > 3) {
    return {
      id: "roce-drop",
      category: "ROCE_DROP",
      severity: dropPp > 6 ? "high" : "medium",
      description: `ROCE fell ${fmtPp(dropPp)} (${prev.toFixed(1)}% → ${latest.toFixed(1)}%)`,
      dataPoints: [`Previous: ${prev.toFixed(1)}%`, `Latest: ${latest.toFixed(1)}%`, `Drop: ${fmtPp(dropPp)}`],
    };
  }
  return null;
}

export function detectInventorySpike(company: ScreenerInCompany): DetectedSignal | null {
  const vals = ratioSeries(company, (n) => n.includes("inventory"));
  if (!vals) return null;

  const latest = vals.at(-1)!;
  const prev = vals.at(-2)!;
  const change = latest - prev;

  if (change > 15 && latest > 60) {
    return {
      id: "inventory-spike",
      category: "INVENTORY_SPIKE",
      severity: change > 30 ? "high" : "medium",
      description: `Inventory days spiked by ${change.toFixed(0)} days (${prev.toFixed(0)} → ${latest.toFixed(0)} days)`,
      dataPoints: [`Previous: ${prev.toFixed(0)} days`, `Latest: ${latest.toFixed(0)} days`],
    };
  }
  return null;
}

export function detectWorkingCapitalDeterioration(company: ScreenerInCompany): DetectedSignal | null {
  const debtor = ratioSeries(company, (n) => n.includes("debtor"));
  const payable = ratioSeries(company, (n) => n.includes("payable") || n.includes("creditor"));

  const signals: string[] = [];
  if (debtor && debtor.at(-1)! - debtor.at(-2)! > 10) {
    signals.push(`Debtor days: ${debtor.at(-2)!.toFixed(0)} → ${debtor.at(-1)!.toFixed(0)}`);
  }
  if (payable && payable.at(-2)! - payable.at(-1)! > 10) {
    signals.push(`Payable days: ${payable.at(-2)!.toFixed(0)} → ${payable.at(-1)!.toFixed(0)}`);
  }

  if (signals.length > 0) {
    return {
      id: "working-capital-deterioration",
      category: "WORKING_CAPITAL_DETERIORATION",
      severity: signals.length >= 2 ? "high" : "medium",
      description: `Working capital cycle lengthening: ${signals.join("; ")}`,
      dataPoints: signals,
    };
  }
  return null;
}

function shareholdingDelta(
  shareholding: ScreenerInCompany["shareholding"],
  match: (name: string) => boolean,
): { prev: number; latest: number } | null {
  const row = shareholding.find((s) => match(s.name.toLowerCase()));
  if (!row || row.values.length < 2) return null;
  const vals = row.values.map((v) => parseFloat(v)).filter(Number.isFinite);
  if (vals.length < 2) return null;
  return { prev: vals.at(-2)!, latest: vals.at(-1)! };
}

export function detectFIISelling(shareholding: ScreenerInCompany["shareholding"]): DetectedSignal | null {
  const d = shareholdingDelta(shareholding, (n) => n.includes("fii") || n.includes("foreign"));
  if (!d) return null;
  const dropPp = d.prev - d.latest;
  if (dropPp > 1.5) {
    return {
      id: "fii-selling",
      category: "FII_SELLING",
      severity: dropPp > 4 ? "high" : "medium",
      description: `FII holding fell ${fmtPp(dropPp)} over the last quarter (${d.prev.toFixed(1)}% → ${d.latest.toFixed(1)}%)`,
      dataPoints: [`Previous: ${d.prev.toFixed(1)}%`, `Latest: ${d.latest.toFixed(1)}%`],
    };
  }
  return null;
}

export function detectDIIBuying(shareholding: ScreenerInCompany["shareholding"]): DetectedSignal | null {
  const d = shareholdingDelta(shareholding, (n) => n.includes("dii") || n.includes("domestic"));
  if (!d) return null;
  const risePp = d.latest - d.prev;
  if (risePp > 1.5) {
    return {
      id: "dii-buying",
      category: "DII_BUYING",
      severity: "low", // positive signal; low severity = noteworthy
      description: `DII buying: holding rose ${fmtPp(risePp)} (${d.prev.toFixed(1)}% → ${d.latest.toFixed(1)}%)`,
      dataPoints: [`Previous: ${d.prev.toFixed(1)}%`, `Latest: ${d.latest.toFixed(1)}%`],
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Registry + evaluation                                                      */
/* -------------------------------------------------------------------------- */

const DETECTORS: DetectorDef[] = [
  {
    category: "MARGIN_COMPRESSION",
    label: "Margin compression",
    market: "ANY",
    evidence: "Annual operating margins (statements), or snapshot EBITDA vs operating margin",
    threshold: "operating margin down >3pp YoY (high: >7pp), or D&A drag >15pp",
    run: (i) => (i.snapshot ? { signal: detectMarginCompression(i.snapshot, i.statements ?? null) } : { unavailable: "no fundamentals snapshot" }),
  },
  {
    category: "REVENUE_DECELERATION",
    label: "Revenue deceleration",
    market: "ANY",
    evidence: "Three most recent annual revenue figures",
    threshold: "growth rate down >5pp between consecutive years (high: >12pp)",
    run: (i) => (i.statements && i.statements.revenue.length >= 3 ? { signal: detectRevenueDeceleration(i.statements) } : { unavailable: "fewer than 3 years of revenue history" }),
  },
  {
    category: "DEBT_INCREASE",
    label: "Elevated leverage",
    market: "ANY",
    evidence: "Debt/equity ratio (snapshot)",
    threshold: "D/E above 1x (high: above 2x)",
    run: (i) => (i.snapshot?.debtToEquity != null ? { signal: detectDebtIncrease(i.snapshot, i.currency) } : { unavailable: "debt/equity not reported" }),
  },
  {
    category: "FCF_DETERIORATION",
    label: "Free cash flow deterioration",
    market: "ANY",
    evidence: "Annual FCF series (statements) or TTM FCF (snapshot)",
    threshold: "FCF negative, or down >30% YoY",
    run: (i) => (i.snapshot || (i.statements?.freeCashFlow.length ?? 0) >= 2
      ? { signal: detectFcfDeterioration(i.snapshot ?? ({} as FundamentalsSnapshot), i.statements ?? null, i.currency) }
      : { unavailable: "no cash flow data" }),
  },
  {
    category: "VALUATION_STRETCH",
    label: "Valuation stretch",
    market: "ANY",
    evidence: "PEG, P/B and forward P/E (snapshot)",
    threshold: "two of: PEG>3, P/B>20, fwd P/E>40; or PEG>4 alone",
    run: (i) => (i.snapshot ? { signal: detectValuationStretch(i.snapshot) } : { unavailable: "no fundamentals snapshot" }),
  },
  {
    category: "EARNINGS_MISS_STREAK",
    label: "Earnings miss streak",
    market: "ANY",
    evidence: "Last 4 quarterly EPS surprises vs consensus",
    threshold: "2+ misses of last 4 (high: 3+), miss = surprise < −2%",
    run: (i) => (i.epsSurprises && i.epsSurprises.length > 0 ? { signal: detectEarningsMissStreak(i.epsSurprises) } : { unavailable: "no EPS surprise history (thin or no analyst coverage)" }),
  },
  {
    category: "INSIDER_SELLING",
    label: "Insider selling",
    market: "ANY",
    evidence: "Reported insider transactions, trailing window",
    threshold: "net selling > $20M across 3+ sells (high: > $100M)",
    run: (i) => (i.insider && i.insider.transactions.length > 0 ? { signal: detectInsiderSelling(i.insider, i.currency) } : { unavailable: "no insider transaction data for this name" }),
  },
  {
    category: "ROCE_DROP",
    label: "ROCE deterioration",
    market: "IN",
    evidence: "ROCE history (screener.in ratios)",
    threshold: "down >3pp YoY (high: >6pp), or level below 10%",
    run: (i) => (i.screenerIn ? { signal: detectRoceDrop(i.screenerIn) } : { unavailable: "screener.in data unavailable" }),
  },
  {
    category: "INVENTORY_SPIKE",
    label: "Inventory spike",
    market: "IN",
    evidence: "Inventory days history (screener.in ratios)",
    threshold: "up >15 days YoY with level >60 days (high: >30 days)",
    run: (i) => (i.screenerIn ? { signal: detectInventorySpike(i.screenerIn) } : { unavailable: "screener.in data unavailable" }),
  },
  {
    category: "WORKING_CAPITAL_DETERIORATION",
    label: "Working capital deterioration",
    market: "IN",
    evidence: "Debtor and payable days (screener.in ratios)",
    threshold: "debtor days up >10, or payable days down >10",
    run: (i) => (i.screenerIn ? { signal: detectWorkingCapitalDeterioration(i.screenerIn) } : { unavailable: "screener.in data unavailable" }),
  },
  {
    category: "FII_SELLING",
    label: "FII selling",
    market: "IN",
    evidence: "Foreign institutional holding, quarterly (screener.in shareholding)",
    threshold: "down >1.5pp QoQ (high: >4pp)",
    run: (i) => (i.screenerIn ? { signal: detectFIISelling(i.screenerIn.shareholding) } : { unavailable: "screener.in data unavailable" }),
  },
  {
    category: "DII_BUYING",
    label: "DII buying",
    market: "IN",
    evidence: "Domestic institutional holding, quarterly (screener.in shareholding)",
    threshold: "up >1.5pp QoQ (positive signal)",
    run: (i) => (i.screenerIn ? { signal: detectDIIBuying(i.screenerIn.shareholding) } : { unavailable: "screener.in data unavailable" }),
  },
];

/** Number of signal checks in the library per market — single source for UI copy. */
export function signalLibrarySize(market: "US" | "IN" | "OTHER"): number {
  return DETECTORS.filter((d) => d.market === "ANY" || d.market === market).length;
}

/**
 * Evaluate every detector applicable to the market. Returns the full record —
 * fired, passed, and could-not-evaluate — so negative results are rendered too.
 */
export function evaluateAllSignals(input: SignalDetectionInput): SignalCheck[] {
  const market = input.market ?? "US";
  return DETECTORS
    .filter((d) => d.market === "ANY" || d.market === market)
    .map((d) => {
      const outcome = d.run(input);
      if ("unavailable" in outcome) {
        return {
          category: d.category, label: d.label, market: d.market,
          evidence: d.evidence, threshold: d.threshold,
          evaluated: false, unavailableReason: outcome.unavailable, fired: false, signal: null,
        };
      }
      return {
        category: d.category, label: d.label, market: d.market,
        evidence: d.evidence, threshold: d.threshold,
        evaluated: true, unavailableReason: null, fired: outcome.signal !== null, signal: outcome.signal,
      };
    });
}

/** Fired signals only — the compact view most stages consume. */
export function detectAllSignals(input: SignalDetectionInput): DetectedSignal[] {
  return evaluateAllSignals(input)
    .map((c) => c.signal)
    .filter((s): s is DetectedSignal => s !== null);
}
