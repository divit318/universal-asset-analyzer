/**
 * IC Pipeline — Stage 1: Signal Detection Engine
 *
 * Pure functions that detect 13 categories of signals from structured data.
 * Each detector returns a DetectedSignal when triggered, or null if not.
 * All signals have a severity (low/medium/high) and a human-readable reason.
 */

import type { FundamentalsSnapshot, FinancialStatements, InsiderActivity } from "./types";
import type { ScreenerInCompany } from "./screener-in";

export type SignalSeverity = "low" | "medium" | "high";

export interface DetectedSignal {
  id: string;
  category: SignalCategory;
  severity: SignalSeverity;
  /** One-line description, e.g. "ROCE dropped from 18.2% to 13.4% YoY" */
  description: string;
  /** Numbers that back the signal */
  dataPoints: string[];
}

export type SignalCategory =
  | "ROCE_DROP"
  | "MARGIN_COMPRESSION"
  | "INVENTORY_SPIKE"
  | "DEBT_INCREASE"
  | "CAPEX_SURGE"
  | "FII_SELLING"
  | "DII_BUYING"
  | "SHARE_DILUTION"
  | "GUIDANCE_CUT"
  | "MARKET_SHARE_LOSS"
  | "WORKING_CAPITAL_DETERIORATION"
  | "ROYALTY_INCREASE"
  | "RELATED_PARTY_EXPANSION"
  | "INSIDER_SELLING"
  | "REVENUE_DECELERATION"
  | "FCF_DETERIORATION"
  | "VALUATION_STRETCH"
  | "EARNINGS_MISS_STREAK";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function x2(v: number): string {
  return `${v.toFixed(2)}x`;
}

/* -------------------------------------------------------------------------- */
/* US / Yahoo-based detectors                                                 */
/* -------------------------------------------------------------------------- */

export function detectMarginCompression(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
): DetectedSignal | null {
  const om = st?.operatingMargin ?? [];
  if (om.length < 2) {
    // Fall back to Yahoo snapshot
    if (s.operatingMargins == null || s.ebitdaMargins == null) return null;
    const gap = s.operatingMargins - s.ebitdaMargins;
    if (gap < -0.15) {
      return {
        id: "margin-compression-snapshot",
        category: "MARGIN_COMPRESSION",
        severity: "medium",
        description: `Large D&A drag: operating margin ${pct(s.operatingMargins)} vs EBITDA margin ${pct(s.ebitdaMargins)}`,
        dataPoints: [`Op margin: ${pct(s.operatingMargins)}`, `EBITDA margin: ${pct(s.ebitdaMargins)}`],
      };
    }
    return null;
  }

  const latest = om.at(-1)!.value;
  const prev = om.at(-2)!.value;
  const drop = latest - prev;

  if (drop < -0.03) {
    const severity: SignalSeverity = drop < -0.07 ? "high" : "medium";
    return {
      id: "margin-compression-trend",
      category: "MARGIN_COMPRESSION",
      severity,
      description: `Operating margin dropped ${pct(Math.abs(drop))} YoY (FY${om.at(-2)!.fy}→FY${om.at(-1)!.fy})`,
      dataPoints: [`FY${om.at(-2)!.fy}: ${pct(prev)}`, `FY${om.at(-1)!.fy}: ${pct(latest)}`],
    };
  }
  return null;
}

export function detectRevenueDeceleration(
  st: FinancialStatements | null,
): DetectedSignal | null {
  const rev = st?.revenue ?? [];
  if (rev.length < 3) return null;

  const g1 = rev.at(-1)!.value / rev.at(-2)!.value - 1;
  const g0 = rev.at(-2)!.value / rev.at(-3)!.value - 1;
  const decel = g0 - g1;

  if (decel > 0.05 && g1 < g0) {
    const severity: SignalSeverity = decel > 0.12 ? "high" : "medium";
    return {
      id: "revenue-deceleration",
      category: "REVENUE_DECELERATION",
      severity,
      description: `Revenue growth decelerated ${pct(decel)} (${pct(g0)} → ${pct(g1)})`,
      dataPoints: [
        `FY${rev.at(-3)!.fy}→FY${rev.at(-2)!.fy}: +${pct(g0)}`,
        `FY${rev.at(-2)!.fy}→FY${rev.at(-1)!.fy}: +${pct(g1)}`,
      ],
    };
  }
  return null;
}

export function detectDebtIncrease(
  s: FundamentalsSnapshot,
): DetectedSignal | null {
  if (s.debtToEquity == null) return null;

  if (s.debtToEquity > 2) {
    return {
      id: "debt-high",
      category: "DEBT_INCREASE",
      severity: "high",
      description: `Debt/equity ratio elevated at ${x2(s.debtToEquity)}`,
      dataPoints: [`D/E: ${x2(s.debtToEquity)}`, `Total debt: $${((s.totalDebt ?? 0) / 1e9).toFixed(1)}B`],
    };
  }
  if (s.debtToEquity > 1) {
    return {
      id: "debt-elevated",
      category: "DEBT_INCREASE",
      severity: "medium",
      description: `Debt/equity above 1x at ${x2(s.debtToEquity)}`,
      dataPoints: [`D/E: ${x2(s.debtToEquity)}`],
    };
  }
  return null;
}

export function detectFcfDeterioration(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
): DetectedSignal | null {
  const fcf = st?.freeCashFlow ?? [];
  if (fcf.length < 2) {
    if (s.freeCashflow != null && s.freeCashflow < 0) {
      return {
        id: "fcf-negative",
        category: "FCF_DETERIORATION",
        severity: "high",
        description: `Negative free cash flow: $${(s.freeCashflow / 1e9).toFixed(1)}B`,
        dataPoints: [`FCF: $${(s.freeCashflow / 1e9).toFixed(1)}B`],
      };
    }
    return null;
  }

  const latest = fcf.at(-1)!.value;
  const prev = fcf.at(-2)!.value;
  const change = (latest - prev) / Math.abs(prev);

  if (latest < 0) {
    return {
      id: "fcf-turned-negative",
      category: "FCF_DETERIORATION",
      severity: "high",
      description: `FCF turned negative in FY${fcf.at(-1)!.fy}: $${(latest / 1e9).toFixed(1)}B`,
      dataPoints: [`FY${fcf.at(-2)!.fy}: $${(prev / 1e9).toFixed(1)}B`, `FY${fcf.at(-1)!.fy}: $${(latest / 1e9).toFixed(1)}B`],
    };
  }
  if (change < -0.3 && prev > 0) {
    return {
      id: "fcf-decline",
      category: "FCF_DETERIORATION",
      severity: "medium",
      description: `FCF declined ${pct(Math.abs(change))} YoY`,
      dataPoints: [`FY${fcf.at(-2)!.fy}: $${(prev / 1e9).toFixed(1)}B`, `FY${fcf.at(-1)!.fy}: $${(latest / 1e9).toFixed(1)}B`],
    };
  }
  return null;
}

export function detectValuationStretch(
  s: FundamentalsSnapshot,
): DetectedSignal | null {
  const flags: string[] = [];

  if (s.pegRatio != null && s.pegRatio > 3) {
    flags.push(`PEG ${s.pegRatio.toFixed(2)}`);
  }
  if (s.priceToBook != null && s.priceToBook > 20) {
    flags.push(`P/B ${s.priceToBook.toFixed(1)}`);
  }
  if (s.forwardPE != null && s.forwardPE > 40) {
    flags.push(`Fwd P/E ${s.forwardPE.toFixed(1)}`);
  }

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
      description: `Extreme PEG ratio of ${s.pegRatio!.toFixed(2)} — paying steeply for growth`,
      dataPoints: flags,
    };
  }
  return null;
}

export function detectEarningsMissStreak(
  epsSurprises: number[],
): DetectedSignal | null {
  const recent = epsSurprises.slice(0, 4);
  const misses = recent.filter((s) => s < -0.02).length;
  if (misses >= 3) {
    return {
      id: "earnings-miss-streak",
      category: "EARNINGS_MISS_STREAK",
      severity: "high",
      description: `${misses} of last ${recent.length} quarters missed EPS estimates`,
      dataPoints: recent.map((s, i) => `Q-${i + 1}: ${s >= 0 ? "+" : ""}${(s * 100).toFixed(1)}%`),
    };
  }
  if (misses >= 2) {
    return {
      id: "earnings-miss-2",
      category: "EARNINGS_MISS_STREAK",
      severity: "medium",
      description: `${misses} of last ${recent.length} quarters missed EPS estimates`,
      dataPoints: recent.map((s, i) => `Q-${i + 1}: ${s >= 0 ? "+" : ""}${(s * 100).toFixed(1)}%`),
    };
  }
  return null;
}

export function detectInsiderSelling(insider: InsiderActivity): DetectedSignal | null {
  if (insider.sellCount === 0) return null;

  const netMagnitude = Math.abs(insider.netValue);
  if (insider.netValue < -20_000_000 && insider.sellCount >= 3) {
    const severity: SignalSeverity = netMagnitude > 100_000_000 ? "high" : "medium";
    return {
      id: "insider-selling",
      category: "INSIDER_SELLING",
      severity,
      description: `Net insider selling of $${(netMagnitude / 1e6).toFixed(0)}M across ${insider.sellCount} transactions`,
      dataPoints: [
        `Buys: ${insider.buyCount}`,
        `Sells: ${insider.sellCount}`,
        `Net: -$${(netMagnitude / 1e6).toFixed(0)}M`,
      ],
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Indian market (screener.in) detectors                                      */
/* -------------------------------------------------------------------------- */

export function detectRoceDrop(company: ScreenerInCompany): DetectedSignal | null {
  const roceRatio = company.ratios.find(
    (r) => r.name.toLowerCase().includes("roce") || r.name.toLowerCase().includes("return on capital"),
  );
  if (!roceRatio || roceRatio.values.length < 2) {
    // Use snapshot value
    if (company.roce != null && company.roce < 10) {
      return {
        id: "roce-low",
        category: "ROCE_DROP",
        severity: company.roce < 5 ? "high" : "medium",
        description: `ROCE at ${company.roce.toFixed(1)}% — below cost of capital threshold`,
        dataPoints: [`ROCE: ${company.roce.toFixed(1)}%`],
      };
    }
    return null;
  }

  const vals = roceRatio.values.map((v) => parseFloat(v.value)).filter(Number.isFinite);
  const latest = vals.at(-1)!;
  const prev = vals.at(-2)!;
  const drop = prev - latest;

  if (drop > 3) {
    const severity: SignalSeverity = drop > 6 ? "high" : "medium";
    return {
      id: "roce-drop",
      category: "ROCE_DROP",
      severity,
      description: `ROCE dropped ${drop.toFixed(1)}pp (${prev.toFixed(1)}% → ${latest.toFixed(1)}%)`,
      dataPoints: [
        `Previous: ${prev.toFixed(1)}%`,
        `Latest: ${latest.toFixed(1)}%`,
        `Drop: ${drop.toFixed(1)}pp`,
      ],
    };
  }
  return null;
}

export function detectInventorySpike(company: ScreenerInCompany): DetectedSignal | null {
  const invDays = company.ratios.find(
    (r) => r.name.toLowerCase().includes("inventory") || r.name.toLowerCase().includes("inventory days"),
  );
  if (!invDays || invDays.values.length < 2) return null;

  const vals = invDays.values.map((v) => parseFloat(v.value)).filter(Number.isFinite);
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
  const debtorDays = company.ratios.find((r) => r.name.toLowerCase().includes("debtor"));
  const payableDays = company.ratios.find((r) => r.name.toLowerCase().includes("payable") || r.name.toLowerCase().includes("creditor"));

  const signals: string[] = [];

  if (debtorDays && debtorDays.values.length >= 2) {
    const vals = debtorDays.values.map((v) => parseFloat(v.value)).filter(Number.isFinite);
    const latest = vals.at(-1)!;
    const prev = vals.at(-2)!;
    if (latest - prev > 10) {
      signals.push(`Debtor days: ${prev.toFixed(0)} → ${latest.toFixed(0)}`);
    }
  }

  if (payableDays && payableDays.values.length >= 2) {
    const vals = payableDays.values.map((v) => parseFloat(v.value)).filter(Number.isFinite);
    const latest = vals.at(-1)!;
    const prev = vals.at(-2)!;
    if (prev - latest > 10) {
      signals.push(`Payable days: ${prev.toFixed(0)} → ${latest.toFixed(0)}`);
    }
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

export function detectFIISelling(shareholding: ScreenerInCompany["shareholding"]): DetectedSignal | null {
  const fiiRow = shareholding.find(
    (s) => s.name.toLowerCase().includes("fii") || s.name.toLowerCase().includes("foreign"),
  );
  if (!fiiRow || fiiRow.values.length < 2) return null;

  const vals = fiiRow.values.map((v) => parseFloat(v)).filter(Number.isFinite);
  const latest = vals.at(-1)!;
  const prev = vals.at(-2)!;
  const drop = prev - latest;

  if (drop > 1.5) {
    return {
      id: "fii-selling",
      category: "FII_SELLING",
      severity: drop > 4 ? "high" : "medium",
      description: `FII holding dropped ${drop.toFixed(1)}pp over last quarter (${prev.toFixed(1)}% → ${latest.toFixed(1)}%)`,
      dataPoints: [`Previous: ${prev.toFixed(1)}%`, `Latest: ${latest.toFixed(1)}%`],
    };
  }
  return null;
}

export function detectDIIBuying(shareholding: ScreenerInCompany["shareholding"]): DetectedSignal | null {
  const diiRow = shareholding.find(
    (s) => s.name.toLowerCase().includes("dii") || s.name.toLowerCase().includes("domestic"),
  );
  if (!diiRow || diiRow.values.length < 2) return null;

  const vals = diiRow.values.map((v) => parseFloat(v)).filter(Number.isFinite);
  const latest = vals.at(-1)!;
  const prev = vals.at(-2)!;
  const rise = latest - prev;

  if (rise > 1.5) {
    return {
      id: "dii-buying",
      category: "DII_BUYING",
      severity: "low", // DII buying is a positive signal, low severity = noteworthy
      description: `DII buying: holding rose ${rise.toFixed(1)}pp (${prev.toFixed(1)}% → ${latest.toFixed(1)}%)`,
      dataPoints: [`Previous: ${prev.toFixed(1)}%`, `Latest: ${latest.toFixed(1)}%`],
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Main aggregator                                                            */
/* -------------------------------------------------------------------------- */

export interface SignalDetectionInput {
  snapshot?: FundamentalsSnapshot;
  statements?: FinancialStatements | null;
  insider?: InsiderActivity;
  epsSurprises?: number[];
  screenerIn?: ScreenerInCompany | null;
}

export function detectAllSignals(input: SignalDetectionInput): DetectedSignal[] {
  const signals: (DetectedSignal | null)[] = [];

  const { snapshot, statements, insider, epsSurprises, screenerIn } = input;

  if (snapshot) {
    signals.push(detectMarginCompression(snapshot, statements ?? null));
    signals.push(detectDebtIncrease(snapshot));
    signals.push(detectFcfDeterioration(snapshot, statements ?? null));
    signals.push(detectValuationStretch(snapshot));
  }
  if (statements) {
    signals.push(detectRevenueDeceleration(statements));
  }
  if (epsSurprises) {
    signals.push(detectEarningsMissStreak(epsSurprises));
  }
  if (insider) {
    signals.push(detectInsiderSelling(insider));
  }
  if (screenerIn) {
    signals.push(detectRoceDrop(screenerIn));
    signals.push(detectInventorySpike(screenerIn));
    signals.push(detectWorkingCapitalDeterioration(screenerIn));
    signals.push(detectFIISelling(screenerIn.shareholding));
    signals.push(detectDIIBuying(screenerIn.shareholding));
  }

  return signals.filter((s): s is DetectedSignal => s !== null);
}
