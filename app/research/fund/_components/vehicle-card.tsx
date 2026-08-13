"use client";

import { useMemo } from "react";
import type { FundProfileData, HistoryPoint } from "@/lib/types";
import { assessVehicle, type LiquidityTier } from "@/lib/research-engines/fund/vehicle";
import { formatCompactCurrency } from "@/lib/format";
import { BasisMark, BasisLegend } from "./basis";

/**
 * Vehicle quality — the implementation question, kept separate from the
 * exposure question on purpose. "Is this bet worth making" and "is this a good
 * way to make it" have different answers, and a fund page that blends them lets
 * a cheap wrapper flatter a bad mandate.
 *
 * Only fields the data actually supports appear. What is missing is stated
 * rather than quietly omitted — the footer names the four things a professional
 * would look for that our source doesn't carry, so an absent row reads as "not
 * known" instead of "not applicable".
 */

const LIQUIDITY_COPY: Record<LiquidityTier, { label: string; className: string }> = {
  deep:      { label: "Deep",      className: "text-positive" },
  adequate:  { label: "Adequate",  className: "text-foreground" },
  thin:      { label: "Thin",      className: "text-warning" },
  illiquid:  { label: "Illiquid",  className: "text-negative" },
};

export function VehicleCard({
  fund,
  history,
  perShareClass = false,
}: {
  fund: FundProfileData;
  history: HistoryPoint[];
  /**
   * Morningstar reports a mutual fund's net assets per SHARE CLASS (the plan
   * being viewed), not per scheme. The label has to say so, or the figure reads
   * roughly 10x low against the scheme-level AUM published on AMFI or Groww.
   */
  perShareClass?: boolean;
}) {
  const v = useMemo(() => assessVehicle(fund, history), [fund, history]);

  const rows: { label: string; value: string; note?: string; basis: "source" | "calc" }[] = [];

  if (v.expenseRatioPct != null) {
    rows.push({
      label: "Expense ratio",
      value: `${v.expenseRatioPct.toFixed(2)}%${v.expenseRatioSource === "amfi" ? " · AMFI" : ""}`,
      note: v.annualCostPer10k != null ? `${v.annualCostPer10k} a year per 10,000 held` : undefined,
      basis: "source",
    });
  }
  if (v.aum != null) {
    rows.push({
      label: perShareClass ? "Plan net assets" : "Fund size",
      // Net assets travel in the fund's own reporting currency (₹ for Indian
      // funds); a hardcoded "$" would mislabel them by the FX rate.
      value: formatCompactCurrency(v.aum, v.currency),
      note: perShareClass ? "this share class, not the whole scheme" : undefined,
      basis: "source",
    });
  }
  if (v.medianDailyValue != null && v.liquidity) {
    rows.push({
      label: "Liquidity",
      value: LIQUIDITY_COPY[v.liquidity].label,
      note: `${formatCompactCurrency(v.medianDailyValue, v.currency)} traded on a median day`,
      basis: "calc",
    });
  }
  if (v.turnoverPct != null) {
    rows.push({
      label: "Turnover",
      value: `${v.turnoverPct.toFixed(0)}%`,
      note: v.turnoverPct >= 75 ? "the portfolio is largely rebuilt each year" : "a low-churn portfolio",
      basis: "source",
    });
  }
  if (v.trackRecordYears != null) {
    rows.push({
      label: "Track record",
      value: `${v.trackRecordYears.toFixed(1)} yrs`,
      note: v.shortTrackRecord ? "shorter than a full market cycle" : undefined,
      basis: "calc",
    });
  }
  if (v.morningstarRating != null) {
    rows.push({ label: "Morningstar", value: "★".repeat(v.morningstarRating), basis: "source" });
  }

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Is this a good vehicle?</h3>
        <p className="text-caption text-muted">Cost, size and tradability — separate from whether the exposure is worth owning</p>
      </div>

      {v.summary && (
        <p className="text-sm leading-6 text-muted">
          {v.summary}
          <BasisMark basis="read" />
        </p>
      )}

      {/* The hairline grid is a bg-border sheet showing through 1px gaps, so a
          part-filled last row leaves a bare slab of border colour. Filler cells
          complete it; hidden below `sm`, where the grid is a single column and
          they would just be trailing blanks. */}
      <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 bg-surface p-3">
            <dt className="text-micro font-semibold uppercase tracking-widest text-faint">{r.label}</dt>
            <dd className={`font-mono text-sm tabular-nums ${r.label === "Liquidity" && v.liquidity ? LIQUIDITY_COPY[v.liquidity].className : "text-foreground"}`}>
              {r.value}
              <BasisMark basis={r.basis} />
            </dd>
            {r.note && <p className="text-micro leading-4 text-muted">{r.note}</p>}
          </div>
        ))}
        {Array.from({ length: (3 - (rows.length % 3)) % 3 }, (_, i) => (
          <div key={`filler-${i}`} aria-hidden="true" className="hidden bg-surface sm:block" />
        ))}
      </dl>

      <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
        <p className="text-micro leading-5 text-faint">
          Not shown, because our data source doesn&apos;t carry {v.omissions.join(", ")}. Tracking error in particular
          needs the fund&apos;s own index; measuring it against the chart&apos;s market benchmark would be a real number
          answering the wrong question.
        </p>
        <BasisLegend />
      </div>
    </section>
  );
}
