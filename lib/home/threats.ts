/**
 * Threat Center — the portfolio's vulnerabilities, ranked.
 *
 * A pure projection of `UniversalPortfolioReport.risk`, `.concentration` and
 * `.scenarios` onto a ranked threat list. Like every other home engine it
 * *reads* measured numbers and adds no risk model of its own: duration is the
 * risk engine's duration, VaR is its VaR, the worst case is the harshest
 * scenario it already ran.
 *
 * On `probability`: it is populated only where the source genuinely expresses a
 * likelihood — a 95% VaR is by construction a 5%-tail event, so that one threat
 * carries `probability: 0.05`. Everywhere else the honest answer is "we measured
 * exposure, not odds", and the field is null rather than a fabricated percentage.
 * Severity (from measured magnitude) is the ranking key, not invented odds.
 *
 * Pure — no I/O. Unit-tested in tests/home-threats.test.ts.
 */

import type { UniversalPortfolioReport } from "../portfolio/report";
import type { UniversalRisk } from "../portfolio/engines/risk";
import type { ScenarioResult } from "../portfolio/engines/scenario";
import type { ConcentrationFinding } from "../portfolio/engines/allocation";
import type { ThreatCenter, ThreatItem, ThreatCategory } from "./contracts";

const PORTFOLIO_HREF = "/portfolio?tab=risk";

type Sev = "high" | "medium" | "low";

/** Picks a severity band from a magnitude and two thresholds. */
function band(magnitude: number, mediumAt: number, highAt: number): Sev {
  const m = Math.abs(magnitude);
  if (m >= highAt) return "high";
  if (m >= mediumAt) return "medium";
  return "low";
}

const SEV_RANK: Record<Sev, number> = { high: 0, medium: 1, low: 2 };

/** Threats from the quantified cross-asset risk metrics. */
function riskThreats(risk: UniversalRisk): ThreatItem[] {
  const out: ThreatItem[] = [];

  // Rates. Effective duration ≈ % price fall per 1pp rise in rates — the risk
  // engine's own number, used with its own textbook interpretation.
  if (risk.duration != null && risk.duration >= 1) {
    const sev = band(risk.duration, 4, 7);
    out.push({
      id: "threat-rates",
      title: "Interest-rate sensitivity",
      category: "rates",
      severity: sev,
      probability: null,
      impactPct: -risk.duration,
      detail: `Effective duration of ${risk.duration.toFixed(1)} yrs — a 1pp rise in rates costs roughly ${risk.duration.toFixed(1)}% of the rate-sensitive book.`,
      mitigation: "Shorten duration: rotate long bonds toward the front end or floating-rate exposure.",
      href: PORTFOLIO_HREF,
    });
  }

  // Inflation. Negative sensitivity = value falls when inflation surprises up.
  if (risk.inflationSensitivity != null && risk.inflationSensitivity < -0.2) {
    const sev = band(risk.inflationSensitivity, 1, 2.5);
    out.push({
      id: "threat-inflation",
      title: "Inflation exposure",
      category: "inflation",
      severity: sev,
      probability: null,
      impactPct: risk.inflationSensitivity,
      detail: `Net inflation sensitivity of ${risk.inflationSensitivity.toFixed(1)}% per 1pp surprise — little real-asset ballast against a hot print.`,
      mitigation: "Add real assets (TIPS, commodities, or real estate) to hedge purchasing-power risk.",
      href: PORTFOLIO_HREF,
    });
  }

  // Credit spreads.
  if (risk.creditSensitivity != null && risk.creditSensitivity >= 0.5) {
    out.push({
      id: "threat-credit",
      title: "Credit-spread risk",
      category: "credit",
      severity: band(risk.creditSensitivity, 1.5, 3),
      probability: null,
      impactPct: -risk.creditSensitivity,
      detail: `A 1pp widening in spreads costs about ${risk.creditSensitivity.toFixed(1)}% — meaningful lower-quality credit exposure.`,
      mitigation: "Lift average credit quality or trim high-yield weight.",
      href: PORTFOLIO_HREF,
    });
  }

  // Currency.
  if (risk.foreignCurrencyPct >= 15) {
    out.push({
      id: "threat-currency",
      title: "Currency concentration",
      category: "currency",
      severity: band(risk.foreignCurrencyPct, 30, 55),
      probability: null,
      impactPct: null,
      detail: `${Math.round(risk.foreignCurrencyPct)}% of value sits in non-base currencies — FX moves flow straight into returns.`,
      mitigation: "Hedge the largest currency exposure or diversify across currency blocs.",
      href: PORTFOLIO_HREF,
    });
  }

  // Liquidity.
  if (risk.illiquidPct >= 10) {
    out.push({
      id: "threat-liquidity",
      title: "Liquidity risk",
      category: "liquidity",
      severity: band(risk.illiquidPct, 25, 45),
      probability: null,
      impactPct: null,
      detail: `${Math.round(risk.illiquidPct)}% of the book can't be liquidated within days — slow to reposition in a shock.`,
      mitigation: "Keep a liquid sleeve sized to your likely near-term needs.",
      href: PORTFOLIO_HREF,
    });
  }

  // Tail loss. 95% VaR is a 5%-probability threshold by construction — the one
  // threat with a genuinely sourced probability.
  if (risk.var95Pct != null && risk.var95Pct > 0) {
    out.push({
      id: "threat-drawdown",
      title: "Daily tail loss (VaR)",
      category: "drawdown",
      severity: band(risk.var95Pct, 2.5, 5),
      probability: 0.05,
      impactPct: -risk.var95Pct,
      detail: `1-in-20 days the book is modelled to lose at least ${risk.var95Pct.toFixed(1)}%${risk.cvar95Pct != null ? `, and ${risk.cvar95Pct.toFixed(1)}% on average when it does` : ""}.`,
      mitigation: "Size positions to the tail, not the average — trim what drives the worst days.",
      href: PORTFOLIO_HREF,
    });
  }

  // Correlation — one shock hits everything at once.
  if (risk.correlation && risk.correlation.avgCorrelation != null && risk.correlation.avgCorrelation >= 0.55) {
    out.push({
      id: "threat-correlation",
      title: "High cross-holding correlation",
      category: "correlation",
      severity: band(risk.correlation.avgCorrelation, 0.65, 0.8),
      probability: null,
      impactPct: null,
      detail: `Average pairwise correlation of ${risk.correlation.avgCorrelation.toFixed(2)} — diversification is thinner than the holding count suggests.`,
      mitigation: "Add genuinely uncorrelated exposures (duration, real assets, or defensive sectors).",
      href: PORTFOLIO_HREF,
    });
  }

  return out;
}

/** Threats from the concentration findings the allocation engine already ranks. */
function concentrationThreats(findings: ConcentrationFinding[]): ThreatItem[] {
  return findings.slice(0, 3).map((f, i) => ({
    id: `threat-conc-${f.type}-${i}`,
    title: `${f.label} concentration`,
    category: "concentration" as ThreatCategory,
    severity: f.severity as Sev,
    probability: null,
    impactPct: null,
    detail: f.message,
    mitigation:
      f.type === "holding"
        ? "Trim the position toward a target weight and redeploy into underweight sleeves."
        : "Rebalance toward the optimizer's target weights to spread single-factor risk.",
    href: PORTFOLIO_HREF,
  }));
}

export function buildThreats(report: UniversalPortfolioReport | null): ThreatCenter {
  if (!report || report.holdingCount === 0) {
    return { status: "empty", threats: [], worstCasePct: null };
  }

  // The harshest modelled scenario — the "what happens if it all goes wrong" line.
  const worst = [...report.scenarios]
    .filter((s: ScenarioResult) => s.portfolioImpactPct != null)
    .sort((a, b) => a.portfolioImpactPct - b.portfolioImpactPct)[0] ?? null;

  const collected = [...riskThreats(report.risk), ...concentrationThreats(report.concentration)];

  // Dedup by category (risk + concentration can both flag the same theme), keep
  // the more severe, then rank by severity and measured impact.
  const byCategory = new Map<ThreatCategory, ThreatItem>();
  for (const t of collected) {
    const existing = byCategory.get(t.category);
    if (!existing || SEV_RANK[t.severity] < SEV_RANK[existing.severity]) byCategory.set(t.category, t);
  }

  const threats = [...byCategory.values()].sort((a, b) => {
    if (SEV_RANK[a.severity] !== SEV_RANK[b.severity]) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    return Math.abs(b.impactPct ?? 0) - Math.abs(a.impactPct ?? 0);
  });

  return {
    status: threats.length > 0 ? "ok" : "empty",
    threats,
    worstCasePct: worst ? worst.portfolioImpactPct : null,
  };
}
