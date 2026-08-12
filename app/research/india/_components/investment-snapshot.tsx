"use client";

import type { ScreenerInCompany } from "@/lib/screener-in";
import { computeIndiaSnapshot, type IndiaDerivedFundamentals } from "@/lib/india-snapshot";
import { CountUp } from "@/app/_components/count-up";
import { Reveal } from "@/app/_components/reveal";
import { ScoreRing } from "@/app/_components/score-ring";
import { ValueBar } from "@/app/_components/value-bar";

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

function ScorePill({ label, score, index }: { label: string; score: number | null; index: number }) {
  if (score == null) {
    return (
      <Reveal index={index} className="flex flex-col gap-2 rounded-lg border bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
          <span className="rounded border px-2 py-0.5 text-[10px] font-semibold text-muted">No data</span>
        </div>
        <ValueBar value={0} height="h-1.5" trackClassName="bg-surface-3" barClassName="bg-surface-3" />
        <span className="font-mono text-sm font-semibold tabular-nums text-muted">—</span>
      </Reveal>
    );
  }
  const grade = toGrade(score);
  return (
    <Reveal index={index} className="flex flex-col gap-2 rounded-lg border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${grade.bg} ${grade.color}`}>
          {grade.label}
        </span>
      </div>
      <ValueBar
        value={score}
        height="h-1.5"
        trackClassName="bg-surface-3"
        barClassName={score >= 65 ? "bg-positive" : score >= 45 ? "bg-warning" : "bg-negative"}
      />
      <span className="font-mono text-sm font-semibold tabular-nums">
        <CountUp value={score} format={(v) => String(Math.round(v))} durationMs={800} />
        <span className="text-xs text-muted">/100</span>
      </span>
    </Reveal>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                              */
/* -------------------------------------------------------------------------- */

interface InvestmentSnapshotProps {
  company: ScreenerInCompany;
  derived: IndiaDerivedFundamentals;
}

export function InvestmentSnapshot({ company, derived }: InvestmentSnapshotProps) {
  const { quality, valuation, growth, capitalAllocation: capAlloc, composite, verdict, strengths, risks, dataQuality } =
    computeIndiaSnapshot(company, derived);
  const basisLabel = derived.basis === "standalone" ? "Standalone" : derived.basis === "consolidated" ? "Consolidated" : null;

  return (
    <section className="card-lift flex flex-col gap-5 rounded-xl border border-border bg-surface p-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Investment Snapshot</h2>
          <p className="text-xs text-muted">
            {basisLabel ? `${basisLabel} figures (₹ Cr) from screener.in` : "Derived from screener.in fundamentals"} — not a recommendation
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Composite ring */}
          <ScoreRing
            score={composite}
            size={64}
            strokeWidth={4}
            arcClassName={composite >= 65 ? "text-positive" : composite >= 45 ? "text-warning" : "text-negative"}
            valueClassName="text-xl font-bold"
            caption="/100"
            label={`Composite score ${composite} out of 100`}
          />
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
        <ScorePill index={0} label="Quality" score={quality} />
        <ScorePill index={1} label="Valuation" score={valuation} />
        <ScorePill index={2} label="Growth" score={growth} />
        <ScorePill index={3} label="Capital Allocation" score={capAlloc} />
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
                  <Reveal key={i} as="li" index={i} className="flex items-start gap-2 text-xs text-muted">
                    <span className="mt-0.5 shrink-0 text-positive">+</span>
                    {s}
                  </Reveal>
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
                  <Reveal key={i} as="li" index={i} className="flex items-start gap-2 text-xs text-muted">
                    <span className="mt-0.5 shrink-0 text-negative">−</span>
                    {r}
                  </Reveal>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Data completeness — say what the score is (and isn't) built on. */}
      {(dataQuality.missing.length > 0 || dataQuality.notApplicable.length > 0) && (
        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
          {dataQuality.missing.length > 0 && (
            <>Score excludes (no data): {dataQuality.missing.join(", ")}. </>
          )}
          {dataQuality.notApplicable.length > 0 && (
            <>Not applicable to this company: {dataQuality.notApplicable.join(", ")}.</>
          )}
        </p>
      )}
    </section>
  );
}
