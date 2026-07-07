"use client";

import type { ScreenerInCompany } from "@/lib/screener-in";
import { computeIndiaSnapshot } from "@/lib/india-snapshot";

/* -------------------------------------------------------------------------- */
/* Scoring lives in lib/india-snapshot.ts (single source of truth, shared with */
/* the research page's DecisionHero). This file is presentation only.          */
/* -------------------------------------------------------------------------- */

function toGrade(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: "Excellent", color: "text-positive", bg: "bg-positive/10 border-positive/30" };
  if (score >= 65) return { label: "Good", color: "text-positive", bg: "bg-positive/8 border-positive/20" };
  if (score >= 48) return { label: "Fair", color: "text-warning", bg: "bg-warning/10 border-warning/30" };
  if (score >= 32) return { label: "Weak", color: "text-negative", bg: "bg-negative/8 border-negative/20" };
  return { label: "Poor", color: "text-negative", bg: "bg-negative/10 border-negative/30" };
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
            score >= 65 ? "bg-positive" : score >= 45 ? "bg-warning" : "bg-negative"
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
  const { quality, valuation, growth, capitalAllocation: capAlloc, composite, verdict, strengths, risks } =
    computeIndiaSnapshot(company, derived);

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
              composite >= 65 ? "border-positive" : composite >= 45 ? "border-warning/70" : "border-negative"
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
