"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Card,
  Badge,
  ScoreChip,
  DataTable,
  DataTableAction,
  DensityToggle,
  type DataTableColumn,
  type Density,
  type SortDir,
} from "@/app/_components/ui";
import { formatCurrency, formatPercent, formatSignedCurrency, toneClass } from "@/lib/format";
// Import from lib/portfolio/classes (not model/adapter directly) — this module's
// side effect registers all twelve class adapters. Client and server bundles are
// separate module instances in Next.js, so a server-side import of this file does
// NOT populate the registry for client components; this component calls
// getClassAdapter() in the browser, so it must trigger registration itself.
import { getClassAdapter } from "@/lib/portfolio/classes";
import { PORTFOLIO_CLASS_LABEL, LIQUIDITY_LABEL, isIlliquid } from "@/lib/portfolio/model/types";
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

/**
 * The unit every metric arrives in — DECLARED, never inferred.
 *
 * This used to be inferred from magnitude: `Math.abs(value) <= 1 ? value * 100 :
 * value`. That heuristic is correct for the common case and silently wrong by a
 * factor of 100 for exactly the values an analyst most wants to see:
 *
 *   - AAPL `returnOnEquity` 1.4147 rendered as "1.41%" instead of "141%"
 *   - ORLA `revenueGrowth`  1.693  rendered as "1.69%" instead of "+169%"
 *
 * A hypergrowth or buyback-heavy compounder appearing 100x weaker than a slow
 * industrial is not a rounding problem, it is a credibility problem — an analyst
 * who sees Apple at 1.41% ROE beside J&J at 25.74% stops trusting every other
 * number on the screen. Magnitude can never distinguish "0.85 = 85%" from
 * "1.85 = 1.85%", so the only correct fix is to stop guessing.
 *
 * `ratio` means the provider hands back a fraction (0.2574 = 25.74%).
 * `percent` means the value is already in percent units (27.2 = 27.2%) — those
 * keys are named `...Percent` at their source in lib/portfolio/classes/*.
 */
type MetricUnit = "ratio" | "percent" | "currency" | "years" | "multiple" | "count";

const METRIC_UNITS: Record<string, MetricUnit> = {
  // Provider fractions (Yahoo `quoteSummary` conventions).
  returnOnEquity: "ratio",
  revenueGrowth: "ratio",
  operatingMargins: "ratio",
  dividendYield: "ratio",

  // Already percent at the source — see lib/portfolio/classes/*.ts, where these
  // are read from fields explicitly suffixed `...Percent`. `yield` is normalized
  // to percent in bond.ts so it matches cash's APY.
  yield: "percent",
  expenseRatio: "percent",
  volatility: "percent",
  capRate: "percent",
  cashOnCash: "percent",
  rentalYield: "percent",
  appreciation: "percent",
  annualizedReturn: "percent",
  cagr: "percent",
  distanceToBarrier: "percent",
  ownershipPercent: "percent",
  couponRate: "percent",
  barrier: "percent",
  worstOfLevel: "percent",

  marketCap: "currency",
  noi: "currency",
  debtService: "currency",
  impliedOwnershipValue: "currency",

  duration: "years",
  maturity: "years",
  yearsToMaturity: "years",

  peRatio: "multiple",
  priceToBook: "multiple",
  priceToFFO: "multiple",
  moic: "multiple",

  debtToEquity: "count",
};

/** Percent digits: keep 2 for readable values, drop to 0 once the integer part dominates. */
function percentDigits(pct: number): number {
  return Math.abs(pct) >= 100 ? 0 : 2;
}

export function formatMetric(key: string, value: number | null): string {
  // An unavailable metric shows an em-dash. It never shows 0, and it never shows a
  // fabricated midpoint — the two ways the old engine hid a data gap.
  if (value == null || !Number.isFinite(value)) return "—";

  switch (METRIC_UNITS[key]) {
    case "currency":
      return formatCurrency(value);
    case "years":
      return `${value.toFixed(1)}y`;
    case "multiple":
      return `${value.toFixed(1)}×`;
    case "ratio": {
      const pct = value * 100;
      return `${pct.toFixed(percentDigits(pct))}%`;
    }
    case "percent":
      return `${value.toFixed(percentDigits(value))}%`;
    case "count":
      return value.toFixed(0);
    default:
      // An undeclared metric is a number, not a guessed percentage. Adding a new
      // metric to the model means adding it to METRIC_UNITS above.
      return value.toFixed(2);
  }
}

/**
 * The holding's own asset-class score, rendered as the `quality` kind.
 *
 * Naming it matters here more than anywhere else in the app: this column headed
 * "SCORE" is what disagreed with /research's Conviction — AAPL read 76 here and
 * 57 there. Both are right (an excellent business at a full price), but neither
 * screen said which question it was answering. `quality` is explicitly NOT
 * banded, so it no longer implies a buy/sell call it was never measuring.
 *
 * A null score still renders as "no basis", never as 50 — the visible face of the
 * model's central rule that unknown must read as unknown.
 */
function HoldingScoreCell({ holding }: { holding: Holding }) {
  return (
    <span className="flex items-baseline justify-end">
      <ScoreChip
        kind="quality"
        score={holding.score?.score ?? null}
        confidence={holding.score?.confidence ?? null}
        why={holding.score?.why}
        size="sm"
        showLabel={false}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Row detail                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The expanded panel for one holding: the class's secondary metrics, the
 * valuation basis, and the "why own this" thesis.
 *
 * Rendered through DataTable's `renderDetail`, which is what makes it reachable
 * by keyboard. It previously lived in a hand-rolled `<tr onClick>` with no
 * tabIndex, role, key handler or aria-expanded, so every fact in here — cost
 * basis, income, whether the value was a live price or the user's own estimate —
 * was mouse-only and invisible to a screen reader.
 */
function HoldingDetail({ h }: { h: Holding }) {
  const secondary = getClassAdapter(h.assetClass).row.secondary;

  return (
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
        <span>
          <span className="text-muted/70">Unrealized: </span>
          <span className={`font-mono tabular-nums ${toneClass(h.unrealizedPL)}`}>
            {formatSignedCurrency(h.unrealizedPL)}
          </span>
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
        {h.valuation.fxRate !== 1 && (
          <span>
            <span className="text-muted/70">FX ({h.currency}→base): </span>
            <span className="font-mono tabular-nums text-foreground">{h.valuation.fxRate.toFixed(4)}</span>
          </span>
        )}
      </div>

      {h.score && h.score.why.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted">{h.score.why.join(". ")}.</p>
      )}

      <WhyOwnThis holdingId={h.id} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Columns for one asset class.
 *
 * The class-agnostic columns are sortable; the class-native metric columns are
 * NOT. A "sort by P/E" control that silently means "sort by duration" in the
 * bond group would be worse than having no sort at all — these are different
 * quantities in different units, declared per class by the adapter.
 *
 * Every `sortValue` returns null rather than 0 for a missing figure, so
 * DataTable's comparator sinks it in both directions. "Worst P&L first" must not
 * fill the top of the table with positions whose P&L is merely unknown.
 */
function columnsFor(assetClass: PortfolioAssetClass): DataTableColumn<Holding>[] {
  const adapter = getClassAdapter(assetClass);

  return [
    {
      key: "name",
      label: "Holding",
      align: "left",
      firstSortDir: "asc",
      sortValue: (h) => (h.symbol ?? h.name).toUpperCase(),
      render: (h) => (
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
            {/* Illiquidity is a first-class property of the row, not a footnote.
                The predicate is shared with the Risk Lab's illiquid weight and
                count (isIlliquid), so a badge here is always one of the holdings
                that card counts. */}
            {isIlliquid(h.liquidity) && (
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
            {/* Fresh (non-stale) marks that still aren't a live market price get their
                own glanceable tag — the portfolio-level valuation-basis disclosure,
                extended to the row it's actually about, not just the aggregate. */}
            {!h.valuation.stale && h.valuation.mode !== "market" && (
              <span
                className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted/70"
                title={`Valuation basis: ${
                  h.valuation.mode === "manual" ? "your estimate"
                  : h.valuation.mode === "derived" ? "derived from terms"
                  : "face value"
                } — not a live market price.`}
              >
                {h.valuation.mode === "manual" ? "est." : h.valuation.mode === "derived" ? "derived" : "face"}
              </span>
            )}
          </span>
          {h.symbol && <span className="truncate text-[11px] text-muted">{h.name}</span>}
        </div>
      ),
    },
    {
      key: "quantity",
      label: "Qty",
      numeric: true,
      hideBelow: "md",
      sortValue: (h) => h.quantity,
      render: (h) => (
        <>
          {h.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          <span className="ml-1 text-[10px] text-muted/60">{h.unit}</span>
        </>
      ),
    },
    {
      key: "value",
      label: "Value",
      numeric: true,
      sortValue: (h) => h.valuation.valueBase,
      render: (h) => (
        <>
          {formatCurrency(h.valuation.valueBase)}
          {/* Show the original currency when it isn't the base — FX is not invisible. */}
          {h.valuation.fxRate !== 1 && (
            <span className="ml-1 text-[10px] text-muted/60">{h.currency}</span>
          )}
        </>
      ),
    },
    {
      key: "weight",
      label: "Weight",
      help: "Share of TOTAL portfolio value, not of this asset class.",
      numeric: true,
      sortValue: (h) => h.weight,
      render: (h) => `${h.weight.toFixed(1)}%`,
    },
    {
      key: "pnlPct",
      label: "P&L %",
      help: "Unrealized gain or loss as a percent of cost basis.",
      numeric: true,
      sortValue: (h) => h.unrealizedPct,
      render: (h) => (
        <span className={toneClass(h.unrealizedPct)}>
          {h.unrealizedPct == null ? "—" : formatPercent(h.unrealizedPct, 1)}
        </span>
      ),
    },
    {
      // Both figures, as separate sortable columns.
      //
      // A single column headed "P&L" showing only a percentage forced the user to
      // open the row and do the arithmetic to learn what a position had actually
      // made or lost in money — the one number a P&L column exists to give. The
      // percent and the amount also answer different questions ("how good a
      // trade?" vs "how much does this move the portfolio?"), and ranking by one
      // is not ranking by the other: a +180% gain on a 0.4% position matters far
      // less than a −12% loss on a 30% one.
      key: "pnlAbs",
      label: "P&L",
      help: "Unrealized gain or loss in base currency. Sort by this to find the positions that actually move the portfolio.",
      numeric: true,
      sortValue: (h) => h.unrealizedPL,
      render: (h) => (
        <span className={toneClass(h.unrealizedPL)}>{formatSignedCurrency(h.unrealizedPL)}</span>
      ),
    },
    // Columns are declared BY THE CLASS ADAPTER, not hardcoded here.
    ...adapter.row.primary.map((k): DataTableColumn<Holding> => ({
      key: `metric:${k}`,
      label: METRIC_LABEL[k] ?? k,
      numeric: true,
      hideBelow: "lg",
      render: (h) => formatMetric(k, h.metrics[k] ?? null),
    })),
    {
      // "Quality", not "Score": this column measures the asset, not the decision,
      // and calling it Score is what made it look like it contradicted the
      // Conviction score on /research.
      key: "quality",
      label: "Quality",
      help: "How good the underlying asset is, setting price aside. Not a buy/sell call.",
      align: "right",
      sortValue: (h) => h.score?.score ?? null,
      render: (h) => <HoldingScoreCell holding={h} />,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Group                                                                       */
/* -------------------------------------------------------------------------- */

function ClassGroup({ assetClass, holdings, totalValue, sortKey, sortDir, onSortChange, density, onManage }: {
  assetClass: PortfolioAssetClass;
  holdings: Holding[];
  totalValue: number;
  sortKey: string;
  sortDir: SortDir;
  onSortChange: (key: string, dir: SortDir) => void;
  density: Density;
  onManage: (h: Holding) => void;
}) {
  const value = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);
  const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;

  // Group-level cost and P&L. The header showed value and weight only, so a
  // class's aggregate gain/loss — the first thing anyone asks of a grouped
  // table — had to be summed by eye across its rows. Cost of 0 yields null
  // rather than "+100%": a class with no recorded basis has an UNKNOWN return,
  // and `(value - 0) / 0` is not a gain of the entire position.
  const cost = holdings.reduce((s, h) => s + h.costBasisBase, 0);
  const pnl = cost > 0 ? value - cost : null;
  const pnlPct = cost > 0 ? ((value - cost) / cost) * 100 : null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/40 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {PORTFOLIO_CLASS_LABEL[assetClass]}
          </h3>
          <span className="text-[11px] text-muted">
            {holdings.length} {holdings.length === 1 ? "holding" : "holdings"}
          </span>
        </div>
        <div className="flex items-baseline gap-2.5">
          {pnl != null && (
            <span className={`font-mono text-[11px] tabular-nums ${toneClass(pnl)}`}>
              {formatSignedCurrency(pnl)}
              {pnlPct != null && ` (${formatPercent(pnlPct, 1)})`}
            </span>
          )}
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatCurrency(value)}
          </span>
          <Badge variant="neutral">{weight.toFixed(1)}%</Badge>
        </div>
      </div>

      {/* The shared grid, not a bespoke table: it already guarantees the two
          things this panel was missing — sortable headers whose nulls sink in
          both directions, and a detail row reachable by Tab/Enter. */}
      <DataTable<Holding>
        rows={holdings}
        columns={columnsFor(assetClass)}
        rowKey={(h) => h.id}
        label={`${PORTFOLIO_CLASS_LABEL[assetClass]} holdings`}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={onSortChange}
        // Density is applied here but CONTROLLED by the panel — see the single
        // toggle in HoldingsPanel's header for why it is not per table.
        density={density}
        showDensityToggle={false}
        renderDetail={(h) => <HoldingDetail h={h} />}
        actions={(h) => (
          <>
            <DataTableAction onClick={() => onManage(h)}>Manage position…</DataTableAction>
            {h.symbol && (
              <>
                <DataTableAction href={`/research?symbol=${encodeURIComponent(h.symbol)}`}>Research</DataTableAction>
                <DataTableAction href={`/valuation?symbol=${encodeURIComponent(h.symbol)}`}>Valuation</DataTableAction>
              </>
            )}
          </>
        )}
      />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

export function HoldingsPanel({ holdings, totalValue, onChanged }: { holdings: Holding[]; totalValue: number; onChanged: () => void }) {
  // Owned here, not inside a row: a Sell All (or a background refresh landing
  // mid-transaction) can make the holding this modal is open for disappear
  // from the next `holdings` prop entirely. State scoped to a row would
  // unmount the modal — and its success screen — the instant that happens.
  // Kept at the panel level, it survives regardless of what the refreshed
  // holdings list contains.
  const [managingHolding, setManagingHolding] = useState<Holding | null>(null);

  // Sorting and filtering: the table had NEITHER. Rows were hard-sorted by value
  // descending with no way to change it, so "which position is hurting me most?"
  // and "where is AAPL?" both meant reading every row of every group by eye.
  // Workable at eight holdings, unusable at eighty.
  //
  // Sort state is LIFTED so every class group ranks by the same column. Left to
  // each DataTable's own uncontrolled state, clicking "P&L" on the equity group
  // would leave the bond group sorted by value, and the page would show two
  // different rankings claiming to be one table.
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Density is lifted for the same reason as the sort, and rendered as ONE
  // control above the groups. It was already a single value shared by every
  // group, but each grid drew its own toggle for it — so ten controls moved in
  // lockstep, and setting Bonds to Roomy silently re-drew Equities too. Either
  // the toggles or the state had to give, and a per-class density is not a
  // preference anyone holds: the groups are one table split by asset class, and
  // comparing across them requires they share a row height.
  const [density, setDensity] = useState<Density>("compact");

  const onSortChange = useCallback((key: string, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
  }, []);

  const needle = query.trim().toUpperCase();
  const filtered = useMemo(
    () =>
      needle === ""
        ? holdings
        : holdings.filter(
            (h) =>
              (h.symbol ?? "").toUpperCase().includes(needle) ||
              h.name.toUpperCase().includes(needle) ||
              (h.attributes.sector ?? "").toUpperCase().includes(needle) ||
              PORTFOLIO_CLASS_LABEL[h.assetClass].toUpperCase().includes(needle),
          ),
    [holdings, needle],
  );

  const groups = useMemo(() => {
    const byClass = new Map<PortfolioAssetClass, Holding[]>();
    for (const h of filtered) {
      const list = byClass.get(h.assetClass) ?? [];
      list.push(h);
      byClass.set(h.assetClass, list);
    }
    return [...byClass.entries()].sort((a, b) => {
      const va = a[1].reduce((s, h) => s + h.valuation.valueBase, 0);
      const vb = b[1].reduce((s, h) => s + h.valuation.valueBase, 0);
      return vb - va;
    });
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2">
          <span className="sr-only">Filter holdings by symbol, name, sector or asset class</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by symbol, name, sector or class…"
            className="w-72 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-3">
          <span aria-live="polite" className="text-[11px] text-muted">
            {needle === ""
              ? `${holdings.length} ${holdings.length === 1 ? "holding" : "holdings"}`
              : `${filtered.length} of ${holdings.length} shown`}
          </span>
          <DensityToggle density={density} onChange={setDensity} />
        </div>
      </div>

      {groups.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-xs text-muted">No holding matches “{query.trim()}”.</p>
        </Card>
      )}

      {groups.map(([cls, hs]) => (
        <ClassGroup
          key={cls}
          assetClass={cls}
          holdings={hs}
          // Weights and group shares stay relative to the WHOLE portfolio, never
          // to the filtered subset — a filter is a view, not a different book.
          totalValue={totalValue}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={onSortChange}
          density={density}
          onManage={setManagingHolding}
        />
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
