"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
// Import from lib/portfolio/classes (not model/adapter directly) — this module's
// side effect registers all twelve class adapters. Client and server bundles are
// separate module instances in Next.js, so a server-side import of this file does
// NOT populate the registry for client components; this component calls
// getClassAdapter() in the browser, so it must trigger registration itself.
import { getClassAdapter } from "@/lib/portfolio/classes";
import { PORTFOLIO_CLASS_LABEL, LIQUIDITY_LABEL } from "@/lib/portfolio/model/types";
import type { Holding, PortfolioAssetClass } from "@/lib/portfolio/model/types";
import { WhyOwnThis } from "./why-own-this";
import { ManageHoldingModal } from "./manage-holding-modal";

/**
 * Holdings, grouped by asset class, each row showing the metrics that class is
 * actually judged on.
 *
 * The old table had one set of columns for everything: P/E, ROE, revenue growth. A
 * bond fund rendered three em-dashes and a fabricated composite of 50. Here a bond
 * shows duration and yield, a REIT shows P/FFO and its dividend, a house shows cap
 * rate and cash-on-cash — because each class's adapter declares its own row.
 */

/** Human formatting for a class-native metric. Driven by the key, not by a switch on class. */
const METRIC_LABEL: Record<string, string> = {
  peRatio: "P/E",
  priceToBook: "P/B",
  priceToFFO: "P/FFO",
  returnOnEquity: "ROE",
  revenueGrowth: "Rev growth",
  operatingMargins: "Op margin",
  debtToEquity: "D/E",
  dividendYield: "Yield",
  marketCap: "Mkt cap",
  beta: "Beta",
  equityBeta: "Equity β",
  expenseRatio: "Expense",
  duration: "Duration",
  maturity: "Maturity",
  yield: "Yield",
  volatility: "Volatility",
  capRate: "Cap rate",
  cashOnCash: "Cash-on-cash",
  rentalYield: "Rental yield",
  noi: "NOI",
  appreciation: "Appreciation",
  debtService: "Debt service",
  moic: "MOIC",
  annualizedReturn: "Ann. return",
  ownershipPercent: "Ownership",
  impliedOwnershipValue: "Implied value",
  cagr: "CAGR",
  distanceToBarrier: "To barrier",
  worstOfLevel: "Worst-of",
  yearsToMaturity: "To maturity",
  couponRate: "Coupon",
  barrier: "Barrier",
};

const PERCENT_KEYS = new Set([
  "returnOnEquity", "revenueGrowth", "operatingMargins", "dividendYield", "yield",
  "expenseRatio", "volatility", "capRate", "cashOnCash", "rentalYield", "appreciation",
  "annualizedReturn", "cagr", "distanceToBarrier", "ownershipPercent", "couponRate",
  "barrier", "worstOfLevel",
]);
const CURRENCY_KEYS = new Set(["marketCap", "noi", "debtService", "impliedOwnershipValue"]);
const YEAR_KEYS = new Set(["duration", "maturity", "yearsToMaturity"]);
const MULTIPLE_KEYS = new Set(["peRatio", "priceToBook", "priceToFFO", "moic"]);

function formatMetric(key: string, value: number | null): string {
  // An unavailable metric shows an em-dash. It never shows 0, and it never shows a
  // fabricated midpoint — the two ways the old engine hid a data gap.
  if (value == null || !Number.isFinite(value)) return "—";

  if (CURRENCY_KEYS.has(key)) return formatCurrency(value);
  if (YEAR_KEYS.has(key)) return `${value.toFixed(1)}y`;
  if (MULTIPLE_KEYS.has(key)) return `${value.toFixed(1)}×`;
  if (PERCENT_KEYS.has(key)) {
    // Yahoo hands back fractions for some fields and percentages for others.
    const pct = Math.abs(value) <= 1 && !["capRate", "cashOnCash", "distanceToBarrier", "ownershipPercent", "expenseRatio", "volatility", "worstOfLevel", "barrier"].includes(key)
      ? value * 100
      : value;
    return `${pct.toFixed(pct >= 100 ? 0 : 2)}%`;
  }
  if (key === "debtToEquity") return value.toFixed(0);
  return value.toFixed(2);
}

function ScoreChip({ holding }: { holding: Holding }) {
  // A null score renders as "no basis", NOT as 50. This is the visible face of the
  // model's central rule: unknown must read as unknown.
  if (!holding.score) {
    return (
      <span className="font-mono text-[11px] text-muted/50" title="This asset class has no scoreable data from our providers.">
        no basis
      </span>
    );
  }

  const { score, confidence } = holding.score;
  const tone = score >= 65 ? "text-positive" : score >= 40 ? "text-foreground" : "text-negative";

  return (
    <span className="flex items-baseline justify-end gap-1" title={holding.score.why.join(". ")}>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{score}</span>
      {/* Confidence is shown next to every score. A 70 at 20% confidence must not
          look like a 70 at 90%. */}
      <span className="font-mono text-[10px] tabular-nums text-muted/60">/{confidence}%</span>
    </span>
  );
}

function HoldingRow({ h, onManage }: { h: Holding; onManage: (h: Holding) => void }) {
  const adapter = getClassAdapter(h.assetClass);
  const [open, setOpen] = useState(false);

  const primary = adapter.row.primary;
  const secondary = adapter.row.secondary;

  return (
    <>
      <tr
        data-arrival-target={h.symbol ?? h.id}
        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-2/40"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="py-2.5 pl-4 pr-2">
          <div className="flex flex-col">
            <span className="flex items-center gap-1.5">
              {h.symbol ? (
                <Link
                  href={`/research?symbol=${encodeURIComponent(h.symbol)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono text-sm font-semibold text-foreground hover:text-brand hover:underline"
                >
                  {h.symbol}
                </Link>
              ) : (
                <span className="text-sm font-semibold text-foreground">{h.name}</span>
              )}
              {/* Illiquidity is a first-class property of the row, not a footnote. */}
              {(h.liquidity === "illiquid" || h.liquidity === "t2") && (
                <span
                  className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted/70"
                  title={`Liquidity: ${LIQUIDITY_LABEL[h.liquidity]}`}
                >
                  {LIQUIDITY_LABEL[h.liquidity]}
                </span>
              )}
              {h.valuation.stale && (
                <span
                  className="rounded border border-warning/40 bg-warning/10 px-1 text-[9px] uppercase tracking-wide text-warning"
                  title={`Valued ${new Date(h.valuation.asOf).toLocaleDateString()} — this is a self-reported mark, not a market price.`}
                >
                  stale
                </span>
              )}
            </span>
            {h.symbol && <span className="truncate text-[11px] text-muted">{h.name}</span>}
          </div>
        </td>

        <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
          {h.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          <span className="ml-1 text-[10px] text-muted/60">{h.unit}</span>
        </td>

        <td className="px-2 py-2.5 text-right font-mono text-sm tabular-nums text-foreground">
          {formatCurrency(h.valuation.valueBase)}
          {/* Show the original currency when it isn't the base — FX is not invisible. */}
          {h.valuation.fxRate !== 1 && (
            <span className="ml-1 text-[10px] text-muted/60">{h.currency}</span>
          )}
        </td>

        <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
          {h.weight.toFixed(1)}%
        </td>

        <td className={`px-2 py-2.5 text-right font-mono text-xs tabular-nums ${
          h.unrealizedPL == null ? "text-muted" : h.unrealizedPL >= 0 ? "text-positive" : "text-negative"
        }`}>
          {h.unrealizedPct == null
            ? "—"
            : `${h.unrealizedPct >= 0 ? "+" : ""}${h.unrealizedPct.toFixed(1)}%`}
        </td>

        {primary.map((k) => (
          <td key={k} className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
            {formatMetric(k, h.metrics[k] ?? null)}
          </td>
        ))}

        <td className="px-2 py-2.5 text-right">
          <ScoreChip holding={h} />
        </td>

        <td className="py-2.5 pl-2 pr-4 text-right">
          <button
            onClick={(e) => { e.stopPropagation(); onManage(h); }}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
          >
            Manage
          </button>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-border/50 bg-surface/30">
          <td colSpan={7 + primary.length} className="px-4 py-3">
            <div className="flex flex-col gap-2.5">
              {secondary.length > 0 && (
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {secondary.map((k) => (
                    <span key={k} className="text-[11px]">
                      <span className="text-muted/70">{METRIC_LABEL[k] ?? k}: </span>
                      <span className="font-mono tabular-nums text-foreground">
                        {formatMetric(k, h.metrics[k] ?? null)}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
                <span>
                  <span className="text-muted/70">Cost basis: </span>
                  <span className="font-mono tabular-nums text-foreground">{formatCurrency(h.costBasisBase)}</span>
                </span>
                {h.income && (
                  <span>
                    <span className="text-muted/70">Income ({h.income.kind}): </span>
                    <span className="font-mono tabular-nums text-positive">
                      {formatCurrency(h.income.annual)}/yr · {h.income.yieldPct.toFixed(2)}%
                    </span>
                  </span>
                )}
                <span>
                  <span className="text-muted/70">Valued: </span>
                  <span className="text-foreground">
                    {h.valuation.mode === "market" ? "live market price"
                      : h.valuation.mode === "manual" ? "your estimate"
                      : h.valuation.mode === "derived" ? "derived from terms"
                      : "face value"}
                    {" · "}
                    {new Date(h.valuation.asOf).toLocaleDateString()}
                  </span>
                </span>
              </div>

              {h.score && h.score.why.length > 0 && (
                <p className="text-[11px] leading-relaxed text-muted">
                  {h.score.why.join(". ")}.
                </p>
              )}

              <WhyOwnThis holdingId={h.id} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ClassGroup({ assetClass, holdings, totalValue, onManage }: {
  assetClass: PortfolioAssetClass;
  holdings: Holding[];
  totalValue: number;
  onManage: (h: Holding) => void;
}) {
  const adapter = getClassAdapter(assetClass);
  const value = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);
  const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface/40 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {PORTFOLIO_CLASS_LABEL[assetClass]}
          </h3>
          <span className="text-[11px] text-muted">
            {holdings.length} {holdings.length === 1 ? "holding" : "holdings"}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatCurrency(value)}
          </span>
          <Badge variant="neutral">{weight.toFixed(1)}%</Badge>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted/70">
              <th className="py-2 pl-4 pr-2 text-left font-semibold">Holding</th>
              <th className="px-2 py-2 text-right font-semibold">Qty</th>
              <th className="px-2 py-2 text-right font-semibold">Value</th>
              <th className="px-2 py-2 text-right font-semibold">Weight</th>
              <th className="px-2 py-2 text-right font-semibold">P&L</th>
              {/* Columns are declared BY THE CLASS ADAPTER, not hardcoded here. */}
              {adapter.row.primary.map((k) => (
                <th key={k} className="px-2 py-2 text-right font-semibold">
                  {METRIC_LABEL[k] ?? k}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Score</th>
              <th className="py-2 pl-2 pr-4 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {holdings
              .sort((a, b) => b.valuation.valueBase - a.valuation.valueBase)
              .map((h) => <HoldingRow key={h.id} h={h} onManage={onManage} />)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function HoldingsPanel({ holdings, totalValue, onChanged }: { holdings: Holding[]; totalValue: number; onChanged: () => void }) {
  // Owned here, not inside a row: a Sell All (or a background refresh landing
  // mid-transaction) can make the holding this modal is open for disappear
  // from the next `holdings` prop entirely. State scoped to a <tr> would
  // unmount the modal — and its success screen — the instant that happens.
  // Kept at the panel level, it survives regardless of what the refreshed
  // holdings list contains.
  const [managingHolding, setManagingHolding] = useState<Holding | null>(null);

  const byClass = new Map<PortfolioAssetClass, Holding[]>();
  for (const h of holdings) {
    const list = byClass.get(h.assetClass) ?? [];
    list.push(h);
    byClass.set(h.assetClass, list);
  }

  const groups = [...byClass.entries()].sort((a, b) => {
    const va = a[1].reduce((s, h) => s + h.valuation.valueBase, 0);
    const vb = b[1].reduce((s, h) => s + h.valuation.valueBase, 0);
    return vb - va;
  });

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([cls, hs]) => (
        <ClassGroup key={cls} assetClass={cls} holdings={hs} totalValue={totalValue} onManage={setManagingHolding} />
      ))}

      {managingHolding && (
        <ManageHoldingModal
          holding={managingHolding}
          onClose={() => setManagingHolding(null)}
          // Refresh immediately so every other tab is current right away, but
          // don't close the modal — the user still needs to see the success
          // screen, and closes it themselves (Done / X).
          onSuccess={onChanged}
        />
      )}
    </div>
  );
}
