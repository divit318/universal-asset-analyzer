"use client";

import type { ScreenerInCompany } from "@/lib/screener-in";

/* -------------------------------------------------------------------------- */
/* Scoring helpers                                                             */
/* -------------------------------------------------------------------------- */

function scoreQuality(c: ScreenerInCompany, debtToEquity: number | null, interestCoverage: number | null): number {
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

function scoreValuation(c: ScreenerInCompany, evToEbitda: number | null, priceToBook: number | null): number {
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

function scoreGrowth(c: ScreenerInCompany): number {
  // Derive from 10-year ratio history if available
  const growthRatio = c.ratios.find(
    (r) => r.name.toLowerCase().includes("sales growth") || r.name.toLowerCase().includes("revenue growth"),
  );
  const profitGrowthRatio = c.ratios.find(
    (r) => r.name.toLowerCase().includes("profit growth") || r.name.toLowerCase().includes("net profit"),
  );

  // Also check annual P&L trend
  const annualSales = c.annualPL.map((d) => d.sales).filter((v): v is number => v != null);
  const annualProfit = c.annualPL.map((d) => d.netProfit).filter((v): v is number => v != null);

  let score = 50; // start neutral

  // Use ratio history growth values
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

  // Bonus for profit growth momentum
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

function scoreCapitalAllocation(c: ScreenerInCompany, debtToEquity: number | null, interestCoverage: number | null): number {
  let score = 50;
  // ROCE trend (key signal of capital efficiency)
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
  // D/E improvement
  if (debtToEquity != null) {
    if (debtToEquity <= 0.5) score += 15;
    else if (debtToEquity <= 1) score += 5;
    else score -= 10;
  }
  // Dividend policy
  if (c.dividendYield != null && c.dividendYield > 1) score += 10;
  // ROCE absolute level
  if (c.roce != null && c.roce >= 15) score += 10;

  return Math.min(100, Math.max(0, score));
}

function toGrade(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: "Excellent", color: "text-positive", bg: "bg-positive/10 border-positive/30" };
  if (score >= 65) return { label: "Good", color: "text-positive", bg: "bg-positive/8 border-positive/20" };
  if (score >= 48) return { label: "Fair", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30" };
  if (score >= 32) return { label: "Weak", color: "text-negative", bg: "bg-negative/8 border-negative/20" };
  return { label: "Poor", color: "text-negative", bg: "bg-negative/10 border-negative/30" };
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
  const revenueGrowth = c.ratios.find((r) => r.name.toLowerCase().includes("sales growth"));
  if (revenueGrowth) {
    const recent = parseFloat(revenueGrowth.values.at(-1)?.value ?? "");
    if (isFinite(recent) && recent < 5) r.push("Slowing revenue momentum");
  }
  return r.slice(0, 5);
}

function overallVerdict(q: number, v: number, g: number, ca: number): { label: string; style: string } {
  const avg = (q * 0.35 + v * 0.25 + g * 0.25 + ca * 0.15);
  if (avg >= 78) return { label: "Strong Buy", style: "text-positive border-positive/40 bg-positive/12" };
  if (avg >= 62) return { label: "Accumulate", style: "text-positive border-positive/30 bg-positive/8" };
  if (avg >= 46) return { label: "Hold", style: "text-amber-400 border-amber-400/40 bg-amber-400/10" };
  if (avg >= 30) return { label: "Reduce", style: "text-negative border-negative/30 bg-negative/8" };
  return { label: "Avoid", style: "text-negative border-negative/40 bg-negative/12" };
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function ScorePill({ label, score }: { label: string; score: number }) {
  const grade = toGrade(score);
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${grade.bg} ${grade.color}`}>
          {grade.label}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            score >= 65 ? "bg-positive" : score >= 45 ? "bg-amber-400" : "bg-negative"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums">{score}<span className="text-xs text-muted">/100</span></span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                              */
/* -------------------------------------------------------------------------- */

interface InvestmentSnapshotProps {
  company: ScreenerInCompany;
  derived: {
    promoterHolding: number | null;
    fiiHolding: number | null;
    diiHolding: number | null;
    evToEbitda: number | null;
    priceToSales: number | null;
    priceToBook: number | null;
    debtToEquity: number | null;
    interestCoverage: number | null;
  };
}

export function InvestmentSnapshot({ company, derived }: InvestmentSnapshotProps) {
  const quality = scoreQuality(company, derived.debtToEquity, derived.interestCoverage);
  const valuation = scoreValuation(company, derived.evToEbitda, derived.priceToBook);
  const growth = scoreGrowth(company);
  const capAlloc = scoreCapitalAllocation(company, derived.debtToEquity, derived.interestCoverage);
  const verdict = overallVerdict(quality, valuation, growth, capAlloc);
  const strengths = computeStrengths(company, derived.debtToEquity, derived.interestCoverage, derived.evToEbitda);
  const risks = computeRisks(company, derived.debtToEquity, derived.interestCoverage, derived.evToEbitda);

  const composite = Math.round(quality * 0.35 + valuation * 0.25 + growth * 0.25 + capAlloc * 0.15);

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Investment Snapshot</h2>
          <p className="text-xs text-muted">Derived from screener.in fundamentals — not a recommendation</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Composite ring */}
          <div
            className={`relative flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-2 ${
              composite >= 65 ? "border-positive" : composite >= 45 ? "border-amber-400/70" : "border-negative"
            }`}
          >
            <span className="text-xl font-bold leading-none tabular-nums">{composite}</span>
            <span className="text-[9px] font-medium uppercase tracking-wide text-muted">/100</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={`inline-flex items-center rounded-lg border px-3 py-1 text-sm font-semibold ${verdict.style}`}>
              {verdict.label}
            </span>
            <span className="text-xs text-muted">Overall Rating</span>
          </div>
        </div>
      </div>

      {/* Score grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ScorePill label="Quality" score={quality} />
        <ScorePill label="Valuation" score={valuation} />
        <ScorePill label="Growth" score={growth} />
        <ScorePill label="Capital Allocation" score={capAlloc} />
      </div>

      {/* Strengths & Risks */}
      {(strengths.length > 0 || risks.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {strengths.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-positive/80">
                Strengths
              </span>
              <ul className="flex flex-col gap-1.5">
                {strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted">
                    <span className="mt-0.5 shrink-0 text-positive">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {risks.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-negative/80">
                Risks
              </span>
              <ul className="flex flex-col gap-1.5">
                {risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted">
                    <span className="mt-0.5 shrink-0 text-negative">−</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
