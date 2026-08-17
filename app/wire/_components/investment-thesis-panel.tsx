"use client";

import Link from "next/link";
import type { InvestmentThesis } from "@/lib/types";
import { modelReadTier, MODEL_READ_TITLE } from "@/lib/wire/labels";

const HORIZON_LABEL: Record<InvestmentThesis["timeHorizon"], string> = {
  days:     "Days",
  weeks:    "Weeks",
  months:   "Months",
  quarters: "Quarters",
  years:    "Years",
};

function BulletList({
  items,
  variant = "neutral",
}: {
  items: string[];
  variant?: "bull" | "bear" | "neutral";
}) {
  const color =
    variant === "bull"
      ? "text-positive"
      : variant === "bear"
        ? "text-negative"
        : "text-muted";
  const dot =
    variant === "bull" ? "▲" : variant === "bear" ? "▼" : "•";
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-xs leading-5">
          <span className={`mt-0.5 shrink-0 text-[10px] ${color}`}>{dot}</span>
          <span className="text-muted">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function InvestmentThesisPanel({
  thesis,
  ticker,
}: {
  thesis: InvestmentThesis;
  ticker: string;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Summary */}
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent">
          Thesis
        </h3>
        <p className="text-xs leading-5 text-muted">{thesis.summary}</p>
      </div>

      {/* Bull / Bear in 2 columns */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-positive">
            Bull Case
          </h4>
          <BulletList items={thesis.bullCase} variant="bull" />
        </div>
        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-negative">
            Bear Case
          </h4>
          <BulletList items={thesis.bearCase} variant="bear" />
        </div>
      </div>

      {/* Catalysts + Risks */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
            Key Catalysts
          </h4>
          <BulletList items={thesis.keyCatalysts} />
        </div>
        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
            Key Risks
          </h4>
          <BulletList items={thesis.keyRisks} />
        </div>
      </div>

      {/* Horizon + Confidence */}
      <div className="flex items-center gap-4 border-t border-border pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted/60">
            Time Horizon
          </span>
          <span className="text-xs font-semibold">{HORIZON_LABEL[thesis.timeHorizon]}</span>
        </div>
        <div className="flex flex-col gap-0.5" title={MODEL_READ_TITLE}>
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted/60">
            Model read
          </span>
          <span className="text-xs font-semibold capitalize">
            {modelReadTier(thesis.confidence) ?? "—"}
          </span>
        </div>
        <div className="ml-auto flex gap-1.5">
          <Link
            href={`/ledger?symbol=${encodeURIComponent(ticker)}`}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent transition-colors"
          >
            Journal
          </Link>
          <Link
            href={`/ic-report?symbol=${encodeURIComponent(ticker)}`}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent transition-colors"
          >
            IC Report
          </Link>
          <Link
            href={`/research?symbol=${encodeURIComponent(ticker)}`}
            className="rounded-md bg-accent-strong px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 transition-opacity"
          >
            Research Hub →
          </Link>
        </div>
      </div>

      {/* Potential winners/losers */}
      {(thesis.potentialWinners.length > 0 || thesis.potentialLosers.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2 border-t border-border pt-3">
          {thesis.potentialWinners.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-positive/80">
                Potential Winners
              </h4>
              <BulletList items={thesis.potentialWinners} />
            </div>
          )}
          {thesis.potentialLosers.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-negative/80">
                Potential Losers
              </h4>
              <BulletList items={thesis.potentialLosers} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
