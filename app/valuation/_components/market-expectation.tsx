"use client";

import { formatCurrency } from "@/lib/format";
import { impliedGrowthGap } from "@/lib/valuation/reverse";
import {
  IMPLIED_GROWTH_CAVEAT,
  IMPLIED_GROWTH_LABEL,
  IMPLIED_GROWTH_SHORT_CAVEAT,
} from "@/lib/valuation/case";
import type { DeliveredGrowth } from "@/lib/valuation/prefill";

/**
 * What today's price would have to assume, stated before anything the user fills in.
 *
 * This is the workspace's opening move rather than a result buried under seven
 * empty inputs, because it is the one valuation figure that needs no opinion:
 * price plus the balance sheet is enough to back out a growth rate. Everything
 * the user does afterwards is a disagreement with it.
 *
 * The label is deliberately "priced-in growth", not "the market expects": the
 * figure is conditional on the case's own WACC and terminal growth, and reads as
 * an objective market statistic if you let it.
 */

interface Props {
  currency: string;
  price: number | null;
  /** Growth implied by the price, percent — conditional on the case's WACC/TG. */
  impliedGrowth: number | null;
  /** What the business actually delivered, and on what basis. */
  delivered: DeliveredGrowth;
  /** The case's current stage-one growth assumption, percent. */
  caseGrowth: number;
  /** Whether the user has authored that assumption — decides its label. */
  caseGrowthOwned: boolean;
}

export function MarketExpectation({ currency, price, impliedGrowth, delivered, caseGrowth, caseGrowthOwned }: Props) {
  const gap = impliedGrowthGap(impliedGrowth, delivered.value);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-label font-semibold uppercase tracking-widest text-muted/60">
          What the price implies
        </p>
        <p className="text-[11px] text-muted">{IMPLIED_GROWTH_SHORT_CAVEAT}</p>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Figure label="Price" value={price != null ? formatCurrency(price, currency) : "—"} />
        <Figure
          label={IMPLIED_GROWTH_LABEL}
          value={impliedGrowth != null ? `${impliedGrowth.toFixed(1)}%` : "—"}
          tone="brand"
          hint="FCF growth Y1–5 that would justify this price"
          title={IMPLIED_GROWTH_CAVEAT}
        />
        <Figure
          label="Delivered"
          value={delivered.value != null ? `${delivered.value.toFixed(1)}%` : "—"}
          hint={delivered.label}
          warn={delivered.isProxy}
        />
        {/* A seeded assumption is the machine's, not the user's — labelling it
            "Your case" before they have touched it is how this workspace once
            manufactured personal valuations out of a page view. */}
        <Figure
          label={caseGrowthOwned ? "Your case" : "Seeded case"}
          value={`${caseGrowth.toFixed(1)}%`}
          tone="strong"
        />
      </div>

      {gap != null ? (
        <p className="text-sm leading-6">
          {gap > 0.2 ? (
            <>
              At today&apos;s price, and given the case&apos;s discount rate, this business would need to{" "}
              <span className="font-semibold text-warning">grow {gap.toFixed(1)}pp faster</span>{" "}
              than it has ({delivered.label}).
            </>
          ) : gap < -0.2 ? (
            <>
              Today&apos;s price only requires{" "}
              <span className="font-semibold text-positive">{Math.abs(gap).toFixed(1)}pp less</span>{" "}
              growth than this business has delivered ({delivered.label}).
            </>
          ) : (
            <>Today&apos;s price roughly requires what this business has already delivered.</>
          )}
        </p>
      ) : impliedGrowth == null ? (
        <p className="text-sm text-muted">
          A priced-in growth rate cannot be solved for this symbol — it needs a positive trailing free
          cash flow and a live price.
        </p>
      ) : (
        <p className="text-sm text-muted">
          No growth history is available to compare the priced-in rate against.
        </p>
      )}

      {delivered.isProxy ? (
        <p className="text-[11px] leading-4 text-warning">
          Delivered growth is standing in for cash-flow growth here: this name has no usable free
          cash flow history, so trailing revenue growth is being used instead.
        </p>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone, hint, warn, title }: {
  label: string; value: string; tone?: "brand" | "strong";
  hint?: string; warn?: boolean; title?: string;
}) {
  const color = tone === "brand" ? "text-brand" : tone === "strong" ? "text-foreground" : "text-foreground/80";
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-2xl font-bold ${color}`}>{value}</span>
      {hint ? (
        <span className={`text-[10px] ${warn ? "text-warning" : "text-muted"}`}>{hint}</span>
      ) : null}
    </div>
  );
}
