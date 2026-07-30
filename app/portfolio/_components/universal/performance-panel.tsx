"use client";

/**
 * Performance — money-weighted return, realized vs unrealized, and a true
 * benchmark comparison.
 *
 * ── Why this panel exists ─────────────────────────────────────────────────────
 *
 * `lib/portfolio-performance.ts` (XIRR, realized/unrealized split, per-position
 * returns, and a same-cash-flows-into-the-index benchmark replication) and
 * `/api/portfolio/performance` were fully built, unit-tested, and consumed by
 * exactly ONE caller: the homepage digest, which reads a single headline figure
 * off it. The Portfolio page — the surface the engine was written for — showed
 * none of it.
 *
 * So the page could say "Total return +18.4%" (value against cost) but could not
 * answer any of:
 *
 *   • "Am I actually beating the market?" There was no benchmark anywhere on the
 *     page. Value-vs-cost is not comparable to an index return, because it
 *     ignores WHEN the capital went in.
 *   • "What is my annualized return?" +18.4% over an unstated period is not a
 *     rate. The same figure is excellent over one year and poor over six.
 *   • "How much have I actually banked?" Cost-vs-value cannot see a realized
 *     gain at all: it is computed only over positions still held, so a position
 *     sold at a profit vanishes from the numbers entirely.
 *
 * This is the AGENTS.md "shipped-but-unwired" pattern — the audit's most common
 * finding. Nothing here re-implements any math; it renders what the engine
 * already computed.
 */

import { Card, Badge, StatTile } from "@/app/_components/ui";
import { DataTable, type DataTableColumn } from "@/app/_components/ui";
import { formatCurrency, formatPercent, formatSignedCurrency, toneClass } from "@/lib/format";
import {
  MIN_DAYS_TO_ANNUALIZE,
  type PortfolioPerformance,
  type PositionPerformance,
} from "@/lib/portfolio-performance";

/** `{ empty: true }` for a portfolio with no lot history. */
type PerformanceResponse = PortfolioPerformance | { empty: true };

function isEmpty(r: PerformanceResponse): r is { empty: true } {
  return "empty" in r && r.empty === true;
}

/**
 * An annualized rate is only meaningful over a long enough window.
 *
 * XIRR over 18 days annualizes an 18-day move by a factor of ~20: a 3% gain in a
 * fortnight becomes "+143% annualized", which is arithmetically correct and
 * completely misleading as a forward-looking rate. The engine returns `holdingDays`
 * precisely so this can be flagged rather than presented flat.
 *
 * Imported from the engine rather than declared here. This panel used to own a
 * private copy, and applied it to the Money-Weighted Return tile — printing "Needs
 * 90+ days (have 18)" and a paragraph explaining that annualizing that window
 * multiplies it by ~20× — while the benchmark card two inches below reported
 * "Underperforming by 10.3pp/yr" off the very same 18 days. A gate that one
 * consumer can forget to apply is a gate the page will eventually contradict
 * itself with, and `outperformancePct` is the DIFFERENCE of two rates that were
 * each just declared unfit to show.
 */
const XIRR_MIN_DAYS = MIN_DAYS_TO_ANNUALIZE;

/** A rate as a percentage. The engine returns fractions (0.23 = 23%). */
const rate = (v: number | null): string => (v == null ? "—" : formatPercent(v * 100, 1));

/**
 * `performance` and `totalValue` MUST come from the same report.
 *
 * This panel used to fetch `/api/portfolio/performance` itself. That gave the tab
 * its own `MarketContext`, and since `quotes.batch` lives 15 seconds, its total and
 * the page headline were priced at different instants — $9,262,809.37 against
 * $9,260,734.55, a $2,074.82 gap on the one figure the panel claimed was the
 * portfolio total. Taking both as props from one report makes the drift
 * unrepresentable rather than merely unlikely.
 */
export function PerformancePanel({
  performance,
  totalValue,
}: {
  performance: PerformanceResponse;
  /** The page headline's total value, from the same report. */
  totalValue: number;
}) {
  const data = performance;

  if (isEmpty(data)) {
    return (
      <Card className="flex flex-col gap-2 p-8 text-center">
        <p className="text-sm font-semibold text-foreground">No transaction history yet.</p>
        <p className="mx-auto max-w-md text-xs leading-relaxed text-muted">
          Money-weighted return and the benchmark comparison are computed from dated
          buys and sells. Holdings added as a single opening position still show a
          total return above — but a rate of return needs to know when the capital
          went in.
        </p>
      </Card>
    );
  }

  const p = data;
  const xirrReliable = p.holdingDays >= XIRR_MIN_DAYS;
  const years = p.holdingDays / 365;

  // The reconciliation, spelled out — and anchored on the PAGE's total value, not
  // on a second one this panel computed. `totalValue` is the same number the header
  // tile renders, from the same report, so the subtraction below both ties AND
  // matches what the reader sees at the top of the page. The residual is rendered
  // rather than absorbed: a reconciliation that swallows its remainder is
  // indistinguishable from one that balances.
  const excludedTotal = p.excluded.reduce((s, e) => s + e.valueBase, 0);
  const residual = totalValue - excludedTotal - p.currentValue;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Headline ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Money-weighted return"
          value={xirrReliable ? rate(p.xirr) : "—"}
          sublabel={
            xirrReliable
              ? `annualized · ${years.toFixed(1)}y of history`
              : `Needs ${XIRR_MIN_DAYS}+ days (have ${p.holdingDays})`
          }
          tone={!xirrReliable || p.xirr == null ? "default" : p.xirr >= 0 ? "positive" : "negative"}
        />
        {/* The SAME number the Dashboard's "Total return" tile renders — literally
            `report.performance.total`, which `report.totalReturn` is derived from.
            This tile used to show the traded book's P&L over a flow-sum denominator
            and disagreed with the Dashboard on the sign. */}
        <StatTile
          label="Total P&L"
          value={formatSignedCurrency(p.total.pnl)}
          sublabel={`${formatPercent(p.total.pct, 2)} of capital at risk`}
          tone={p.total.pnl >= 0 ? "positive" : "negative"}
        />
        {/* Realized P&L is invisible to a cost-vs-value calculation, which only
            looks at positions still held. A profitable sale simply disappears. */}
        <StatTile
          label="Realized"
          value={formatSignedCurrency(p.realizedPnl)}
          sublabel="Banked — already sold"
          tone={p.realizedPnl > 0 ? "positive" : p.realizedPnl < 0 ? "negative" : "default"}
        />
        <StatTile
          label="Unrealized"
          value={formatSignedCurrency(p.unrealizedPnl)}
          sublabel="Still at risk"
          tone={p.unrealizedPnl >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* ── Scope ────────────────────────────────────────────────────────────
          Stated up front, because this panel's "your portfolio" figure is
          deliberately NOT the page headline's total value and the two will
          differ. Money-weighted return needs DATED transactions, which only the
          lot ledger has; a house or a private stake is carried as a valuation
          with no buy/sell history, so it cannot contribute a cash flow and is out
          of scope here. Two different totals on one page with no explanation is
          precisely the ambiguity the rest of this audit removed. */}
      <p className="text-[11px] leading-relaxed text-muted/70">
        Computed from dated transactions in the trade ledger, so this covers your
        market-priced holdings and cash. Anything without a dated buy/sell history — or
        without a current price — has a valuation but no rate of return to derive, so it
        sits outside these figures. The reconciliation below accounts for every dollar of
        the difference against the portfolio value at the top of the page.
      </p>

      {/* ── Reconciliation ───────────────────────────────────────────────────
          Every exclusion is named AND valued, and the arithmetic is shown.

          The panel used to state one exclusion ("real estate, private markets,
          alternatives"), print "value of holdings" $2,665.81 below the page's Total
          Value, and leave the reader to discover that those assets came to $1,750.
          The rest was an unpriced CHF forex position the prose never mentioned plus
          price drift between two independent quote fetches. A stated exclusion that
          doesn't account for the gap is worse than no explanation, because it
          invites the reader to trust a subtraction that doesn't hold. */}
      <ExclusionReconciliation
        portfolioValue={totalValue}
        excluded={p.excluded}
        inScope={p.currentValue}
        residual={residual}
        unpricedSymbols={p.unpricedSymbols}
        tradedBookPnl={p.totalPnl}
        totalPnl={p.total.pnl}
      />

      {!xirrReliable && (
        <Card className="border-warning/25 bg-warning/[0.04] p-3.5">
          <p className="text-[11px] leading-relaxed text-muted">
            <strong className="text-warning">Too early for a rate of return.</strong> The
            first trade was {p.holdingDays} {p.holdingDays === 1 ? "day" : "days"} ago.
            Annualizing a window that short multiplies it by
            {" "}~{(365 / Math.max(p.holdingDays, 1)).toFixed(0)}×, which turns normal
            short-term noise into an implausible headline rate. The dollar figures above
            are exact; the annualized rate is withheld until there is enough history to
            mean anything.
          </p>
        </Card>
      )}

      {/* ── Benchmark ────────────────────────────────────────────────────────
          The honest comparison, and the reason it needs an engine rather than a
          subtraction: it replays THE PORTFOLIO'S OWN cash flows — same amounts,
          same dates — into the index, then compares terminal values. Simply
          differencing "my total return" against "SPY's 1-year return" answers a
          different question, and flatters anyone who happened to add capital
          before a rally. */}
      {p.benchmark ? (
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                vs {p.benchmark.symbol}
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                Your exact contributions and withdrawals, on the same dates, invested in{" "}
                {p.benchmark.symbol} instead — on a total-return basis, with dividends
                reinvested.
              </p>
            </div>
            {/* Under 90 days the headline is the DOLLAR difference, not a rate.
                `outperformancePct` is portfolioXirr − benchmarkXirr: two annualized
                figures this same panel refuses to print individually, differenced
                and then presented as the card's most prominent claim. The dollar gap
                needs no annualization to be true — it is simply what the two
                terminal values are, today. */}
            {xirrReliable ? (
              p.benchmark.outperformancePct != null && (
                <Badge variant={p.benchmark.outperformancePct >= 0 ? "positive" : "negative"}>
                  {p.benchmark.outperformancePct >= 0 ? "Outperforming" : "Underperforming"} by{" "}
                  {Math.abs(p.benchmark.outperformancePct * 100).toFixed(1)}pp/yr
                </Badge>
              )
            ) : (
              <Badge variant={p.currentValue >= p.benchmark.currentValue ? "positive" : "negative"}>
                {p.currentValue >= p.benchmark.currentValue ? "Ahead" : "Behind"} by{" "}
                {formatCurrency(Math.abs(p.currentValue - p.benchmark.currentValue))} so far
              </Badge>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface/40 p-3">
              <span className="text-[10px] uppercase tracking-wider text-muted/70">Your portfolio</span>
              <span className="font-mono text-base font-bold tabular-nums text-foreground">
                {formatCurrency(p.currentValue)}
              </span>
              {/* Not "value of holdings" — that reads as the whole book and sent a
                  reader hunting for the $2,665.81 it differed from the page total
                  by. Name the subset, and point at the arithmetic above. */}
              <span className="text-[10px] text-muted/70">
                {xirrReliable ? `${rate(p.xirr)} annualized` : "in-scope holdings only"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface/40 p-3">
              <span className="text-[10px] uppercase tracking-wider text-muted/70">
                Same money in {p.benchmark.symbol}
              </span>
              <span className="font-mono text-base font-bold tabular-nums text-foreground">
                {formatCurrency(p.benchmark.currentValue)}
              </span>
              <span className="text-[10px] text-muted/70">
                {xirrReliable ? `${rate(p.benchmark.xirr)} annualized` : "index replication"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface/40 p-3">
              <span className="text-[10px] uppercase tracking-wider text-muted/70">Difference</span>
              <span
                className={`font-mono text-base font-bold tabular-nums ${toneClass(p.currentValue - p.benchmark.currentValue)}`}
              >
                {formatSignedCurrency(p.currentValue - p.benchmark.currentValue)}
              </span>
              <span className="text-[10px] text-muted/70">
                {p.currentValue >= p.benchmark.currentValue
                  ? "ahead of the index"
                  : "behind the index"}
              </span>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[11px] leading-relaxed text-muted">
            No benchmark comparison available — the index price history needed to replay
            your cash flows could not be loaded. Shown rather than silently omitted, so
            an absent comparison is never mistaken for an in-line one.
          </p>
        </Card>
      )}

      {/* ── Per-position ── */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-surface/40 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">By position</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Realized and unrealized split per holding.{" "}
            {xirrReliable
              ? "IRR is each position's own money-weighted return."
              : "Per-position IRR appears once a holding has 90 days of history — the oldest here has " +
                `${p.holdingDays}.`}
          </p>
        </div>
        <DataTable<PositionPerformance>
          rows={p.positions}
          columns={positionColumns(p.positions)}
          rowKey={(r) => r.symbol}
          label="Per-position performance"
          defaultSortKey="totalPnl"
          defaultSortDir="desc"
          empty={<p className="p-6 text-center text-xs text-muted">No positions with trade history.</p>}
        />
      </Card>
    </div>
  );
}

/** One line of the reconciliation: a label, an optional detail, and a figure. */
function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="min-w-0 text-[11px] text-muted">
        {label}
        {note && <span className="text-muted/60"> · {note}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/**
 * The subtraction that ties this panel's total to the page headline.
 *
 * Shown as arithmetic rather than described in prose because prose is exactly what
 * failed here: the panel asserted "manually-valued assets are excluded" and printed
 * a figure $2,665.81 below Total Value when those assets came to $1,750. A reader
 * who checks a stated exclusion and finds it doesn't account for the gap has learned
 * that the page cannot be checked — a worse outcome than saying nothing.
 *
 * Every excluded holding carries its own value, so each line is verifiable, and any
 * residual is rendered instead of absorbed.
 */
function ExclusionReconciliation({
  portfolioValue,
  excluded,
  inScope,
  residual,
  unpricedSymbols,
  tradedBookPnl,
  totalPnl,
}: {
  portfolioValue: number;
  excluded: PortfolioPerformance["excluded"];
  inScope: number;
  residual: number;
  unpricedSymbols: string[];
  /** P&L the per-position table below sums to. */
  tradedBookPnl: number;
  /** Whole-portfolio P&L, as shown in the headline tile and on the Dashboard. */
  totalPnl: number;
}) {
  const manual = excluded.filter((e) => e.reason === "manual");
  const unpriced = excluded.filter((e) => e.reason === "unpriced");
  const sum = (xs: typeof excluded) => xs.reduce((s, e) => s + e.valueBase, 0);
  const excludedPnl = excluded.reduce((s, e) => s + (e.valueBase - e.costBasisBase), 0);

  return (
    <Card className="flex flex-col gap-1.5 p-4">
      {/* "Total value (this page's headline)", not "Total portfolio value".
          The panel is not asserting its own total any more — this IS the header's
          number, passed down from the same report, so the claim is verifiable by
          scrolling up rather than something the reader has to take on trust. */}
      <Row label="Total value (as shown at the top of this page)" value={formatCurrency(portfolioValue)} />

      {manual.length > 0 && (
        <Row
          label={`Less manually-valued assets (${manual.length})`}
          value={`−${formatCurrency(sum(manual))}`}
          note={manual.map((m) => m.label).join(", ")}
        />
      )}

      {/* An unpriced position is excluded rather than valued at zero — which would
          report it as a total loss — and its cost basis is excluded with it so the
          percentages stay internally consistent. It is named here because the
          previous copy listed only real estate / private markets / alternatives, and
          the biggest single exclusion on this book was in fact a forex position. */}
      {unpriced.length > 0 && (
        <Row
          label={`Less positions with no current price (${unpriced.length})`}
          value={`−${formatCurrency(sum(unpriced))}`}
          note={`${unpricedSymbols.join(", ")} · carried at cost, not zero`}
        />
      )}

      {/* Should always be absent. Rendered when it is not, because a reconciliation
          that quietly swallows its remainder is indistinguishable from one that
          balances. */}
      {Math.abs(residual) >= 0.01 && (
        <Row
          label="Unexplained residual"
          value={formatSignedCurrency(residual)}
          note="this is a bug — please report it"
        />
      )}

      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-border pt-1.5">
        <span className="text-[11px] font-semibold text-foreground">
          In scope for the money-weighted return and the table below
        </span>
        <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-foreground">
          {formatCurrency(inScope)}
        </span>
      </div>

      {/* ── And the same reconciliation for P&L ────────────────────────────────
          The headline "Total P&L" covers the WHOLE portfolio so that it agrees
          with the Dashboard; the per-position table covers only the traded book.
          Without this bridge the table would visibly fail to sum to the tile above
          it — the same additive-decomposition failure that hid a closed position's
          −$13,136 realized loss. Stated, not left to be noticed. */}
      {Math.abs(excludedPnl) >= 0.01 && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
          <Row
            label="P&L of the positions below"
            value={formatSignedCurrency(tradedBookPnl)}
            note="realized + unrealized"
          />
          <Row
            label="Plus gain/loss on the excluded holdings above"
            value={formatSignedCurrency(excludedPnl)}
          />
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[11px] font-semibold text-foreground">
              Total P&amp;L (the headline, and the Dashboard&apos;s)
            </span>
            <span
              className={`shrink-0 font-mono text-xs font-bold tabular-nums ${toneClass(totalPnl)}`}
            >
              {formatSignedCurrency(totalPnl)}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Per-position columns.
 *
 * Every `sortValue` returns null for a genuinely unknown figure so DataTable's
 * comparator sinks it in both directions — ranking "worst return first" must not
 * surface the positions whose return simply could not be computed.
 *
 * Built per render rather than declared as a constant so the IRR column can be
 * dropped when no row can populate it — see the note where it is appended.
 */
function positionColumns(rows: PositionPerformance[]): DataTableColumn<PositionPerformance>[] {
  const columns: DataTableColumn<PositionPerformance>[] = [
    {
      key: "symbol",
      label: "Position",
      align: "left",
      firstSortDir: "asc",
      sortValue: (r) => r.symbol,
      render: (r) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-semibold text-foreground">{r.symbol}</span>
            {/* A fully-exited position is in this table because its realized P&L is in
                the total above it. Without the marker its Value and Cost of $0 read as
                a data error rather than as "there is nothing left to hold". */}
            {r.closed && (
              <span className="rounded-control border border-border px-1 py-px text-[9px] uppercase tracking-wider text-muted">
                Closed
              </span>
            )}
          </span>
          <span className="truncate text-[11px] text-muted">{r.name}</span>
        </div>
      ),
    },
    {
      key: "currentValue",
      label: "Value",
      numeric: true,
      sortValue: (r) => r.currentValue,
      render: (r) => (r.closed ? <span className="text-muted">—</span> : formatCurrency(r.currentValue)),
    },
    {
      key: "costBasis",
      label: "Cost",
      help: "Cost basis of the shares STILL held. For a position that has been sold down this is not what the return is measured against — see Deployed.",
      numeric: true,
      hideBelow: "md",
      sortValue: (r) => r.costBasis,
      render: (r) => (r.closed ? <span className="text-muted">—</span> : formatCurrency(r.costBasis)),
    },
    {
      /**
       * The Return column's denominator, made visible.
       *
       * Without it the GLD row read "Value $0.18 · Cost $0.18 · Realized +$2,856 ·
       * Return +0.8%" — four figures that cannot describe one position, since $2,856
       * on a $0.18 basis is not 0.8% but 1,560,000%. Every figure was correct: the
       * return was measured against the $375,026 the position had actually consumed
       * over its life, and that number appeared nowhere on the page. A percentage
       * whose denominator is invisible is not verifiable, and an unverifiable
       * percentage next to a small "Cost" reads as a bug.
       */
      key: "grossInvested",
      label: "Deployed",
      help: "Capital this position consumed — every buy of the instrument, fees included, excluding cash movements and internal rebalancing entries. This is the denominator of Return.",
      numeric: true,
      hideBelow: "lg",
      sortValue: (r) => (r.grossInvested > 0 ? r.grossInvested : null),
      render: (r) =>
        // Cash is HELD, not deployed, so it has no denominator — "—" rather than
        // "$0.00", which would read as a figure. This row used to show $5,267,690
        // against a $1,250,635 balance because every deposit and every internal
        // rebalancing plug was summed into it.
        r.grossInvested > 0 ? (
          formatCurrency(r.grossInvested)
        ) : (
          <span className="text-muted" title="Cash is held, not deployed — it has no capital-deployed figure">
            —
          </span>
        ),
    },
    {
      key: "realizedPnl",
      label: "Realized",
      help: "Gain or loss already banked on shares sold, at average cost.",
      numeric: true,
      hideBelow: "lg",
      sortValue: (r) => r.realizedPnl,
      render: (r) => (
        <span className={toneClass(r.realizedPnl)}>
          {r.realizedPnl === 0 ? "—" : formatSignedCurrency(r.realizedPnl)}
        </span>
      ),
    },
    {
      key: "unrealizedPnl",
      label: "Unrealized",
      numeric: true,
      sortValue: (r) => r.unrealizedPnl,
      render: (r) => (
        <span className={toneClass(r.unrealizedPnl)}>{formatSignedCurrency(r.unrealizedPnl)}</span>
      ),
    },
    {
      key: "totalPnl",
      label: "Total P&L",
      numeric: true,
      sortValue: (r) => r.totalPnl,
      render: (r) => (
        <span className={toneClass(r.totalPnl)}>{formatSignedCurrency(r.totalPnl)}</span>
      ),
    },
    {
      key: "totalReturnPct",
      label: "Return",
      help: "Total P&L as a percent of Deployed — the gross capital this position consumed. Not a percent of Cost, which only covers the shares still held.",
      numeric: true,
      sortValue: (r) => r.totalReturnPct,
      render: (r) =>
        // No denominator ⇒ no percentage. Cash has no deployed capital, so a
        // "0.0%" here would be a number standing in for "not applicable" — and the
        // tooltip would have invited dividing by a figure that does not exist.
        r.grossInvested > 0 ? (
          <span
            className={toneClass(r.totalReturnPct)}
            title={`${formatSignedCurrency(r.totalPnl)} on ${formatCurrency(r.grossInvested)} deployed`}
          >
            {formatPercent(r.totalReturnPct * 100, 1)}
          </span>
        ) : (
          <span className="text-muted" title="No deployed capital to measure a return against">—</span>
        ),
    },
  ];

  /**
   * IRR is appended only when at least one row can show it.
   *
   * The gate itself is correct — annualizing a position held 18 days multiplies its
   * move by ~20 — but on a young book it withholds EVERY row, and a column of 25
   * em-dashes is not a caveat, it is a column that looks broken. Nothing was
   * failing: the whole portfolio's oldest lot was 18 days old, so the answer to
   * "what is my annualized return on this position?" was legitimately "ask again in
   * a quarter". Say that once, in a header note, instead of 25 times in a column.
   *
   * It reappears on its own the day a position crosses the threshold, which is why
   * this is a conditional column rather than a deleted one.
   */
  if (rows.some((r) => r.holdingDays >= XIRR_MIN_DAYS)) {
    columns.push({
      key: "xirr",
      label: "IRR",
      help: "Annualized money-weighted return for this position. Withheld under 90 days of history, where annualizing amplifies noise into an implausible rate.",
      numeric: true,
      // The guard belongs in sortValue as well as in render: a position held nine
      // days must not top an "IRR descending" ranking on a number the UI refuses to
      // display.
      sortValue: (r) => (r.holdingDays >= XIRR_MIN_DAYS ? r.xirr : null),
      render: (r) =>
        r.holdingDays < XIRR_MIN_DAYS ? (
          <span className="text-muted" title={`Only ${r.holdingDays} days of history`}>—</span>
        ) : (
          <span className={toneClass(r.xirr)}>{rate(r.xirr)}</span>
        ),
    });
  }

  return columns;
}
