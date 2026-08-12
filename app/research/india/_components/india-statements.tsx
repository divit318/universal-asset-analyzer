"use client";

/**
 * Indian statement surfaces: Quarterly Results (the section an Indian
 * investor checks first), Balance Sheet, and Cash Flow — all from the
 * screener.in tables parsed in lib/screener-in.ts.
 *
 * Conventions:
 *  - Periods carry Indian fiscal labels ("Q1 FY27", "FY26") with the calendar
 *    month kept as the secondary line — never US calendar-quarter labels.
 *  - Every value is ₹ Cr on the company's stated reporting basis, and the
 *    basis (consolidated/standalone) is shown, not implied.
 *  - Banks/NBFCs render their own rows (Financing Profit / Margin, NPA when
 *    published) instead of industrial OPM.
 */

import type {
  ScreenerInQuarterlyPL,
  ScreenerInStatements,
} from "@/lib/screener-in";
import type { NseResultsMeta } from "@/lib/india-news";
import type { Filing } from "@/lib/types";
import { formatDate, indianFiscalLabel } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function fmtCr(v: number | null | undefined, digits = 0): string {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function deltaChip(pct: number | null, label: string) {
  if (pct == null) return null;
  const tone = pct >= 0 ? "text-positive" : "text-negative";
  return (
    <span className={`font-mono text-xs tabular-nums ${tone}`}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)}% {label}
    </span>
  );
}

function pctChange(current: number | null | undefined, prior: number | null | undefined): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function BasisBadge({ basis }: { basis: "consolidated" | "standalone" | null }) {
  if (!basis) return null;
  return (
    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
      {basis}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Quarterly Results                                                          */
/* -------------------------------------------------------------------------- */

interface QuarterlyResultsProps {
  data: ScreenerInQuarterlyPL[];
  statementKind: "industrial" | "financial";
  basis: "consolidated" | "standalone" | null;
  /** Bundle filings — used to link the official results announcement. */
  filings?: Filing[];
  /** Official NSE results metadata — reported-on date, bank asset quality. */
  resultsMeta?: NseResultsMeta | null;
  /** Next scheduled results date from NSE's event calendar (never estimated). */
  upcoming?: { date: string; purpose: string } | null;
}

/** True when an NSE filing period ("2026-06-30") is the same month as a screener period ("Jun 2026"). */
function sameQuarter(periodEndIso: string | null | undefined, screenerPeriod: string): boolean {
  if (!periodEndIso) return false;
  const d = new Date(periodEndIso);
  const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");
  return label === screenerPeriod;
}

export function QuarterlyResultsCard({ data, statementKind, basis, filings, resultsMeta, upcoming }: QuarterlyResultsProps) {
  if (data.length === 0) return null;
  const financial = statementKind === "financial";

  const latest = data.at(-1)!;
  const prior = data.at(-2) ?? null;                       // QoQ
  const yearAgo = data.length >= 5 ? data.at(-5)! : null;  // YoY (4 quarters back)
  const yoyAligned = yearAgo && yearAgo.period.slice(0, 3) === latest.period.slice(0, 3) ? yearAgo : null;

  const salesYoY = pctChange(latest.sales, yoyAligned?.sales);
  const salesQoQ = pctChange(latest.sales, prior?.sales);
  const npYoY = pctChange(latest.netProfit, yoyAligned?.netProfit);
  const npQoQ = pctChange(latest.netProfit, prior?.netProfit);

  const resultsFiling = filings?.find(
    (f) => /result/i.test(`${f.form} ${f.description}`),
  ) ?? null;

  // "Reported on": prefer the NSE results-API timestamp when its period
  // matches the quarter displayed; otherwise fall back to the results-category
  // announcement's filing date, but only when it lands in the plausible
  // reporting window after the period end (0–90 days). The NSE results API
  // lags several quarters, and a wrong date is worse than none.
  const periodEndMs = Date.parse(`01 ${latest.period} UTC`);
  const filingMs = resultsFiling ? Date.parse(resultsFiling.filedAt) : NaN;
  const filingInWindow =
    Number.isFinite(periodEndMs) && Number.isFinite(filingMs) &&
    filingMs > periodEndMs && filingMs - periodEndMs < 100 * 86_400_000;
  const reportedAt = resultsMeta && sameQuarter(resultsMeta.periodEnd, latest.period)
    ? resultsMeta.reportedAt
    : filingInWindow
      ? resultsFiling!.filedAt
      : null;
  const reportedAudited = resultsMeta && sameQuarter(resultsMeta.periodEnd, latest.period);

  // Bank asset quality from the NSE standalone XBRL, when screener.in's own
  // NPA columns are login-gated. Rendered with ITS OWN period label so a
  // lagging filing is never passed off as the latest quarter — and suppressed
  // entirely once it trails the displayed quarter by more than a year.
  const npaAgeMs = resultsMeta?.periodEnd && Number.isFinite(periodEndMs)
    ? periodEndMs - Date.parse(resultsMeta.periodEnd)
    : Infinity;
  const showNseAssetQuality =
    financial &&
    latest.grossNpaPercent == null &&
    resultsMeta != null &&
    (resultsMeta.grossNpaPercent != null || resultsMeta.netNpaPercent != null) &&
    npaAgeMs < 366 * 86_400_000;

  const cols = data.slice(-5);

  const rows: { label: string; get: (q: ScreenerInQuarterlyPL) => string }[] = financial
    ? [
        { label: "Revenue", get: (q) => fmtCr(q.sales) },
        { label: "Interest expended", get: (q) => fmtCr(q.interest) },
        { label: "Financing profit", get: (q) => fmtCr(q.financingProfit) },
        { label: "Financing margin", get: (q) => (q.financingMarginPercent != null ? `${q.financingMarginPercent}%` : "—") },
        { label: "Other income", get: (q) => fmtCr(q.otherIncome) },
        { label: "Net profit", get: (q) => fmtCr(q.netProfit) },
        { label: "EPS (₹)", get: (q) => (q.eps != null ? q.eps.toLocaleString("en-IN") : "—") },
        ...(cols.some((q) => q.grossNpaPercent != null)
          ? [
              { label: "Gross NPA", get: (q: ScreenerInQuarterlyPL) => (q.grossNpaPercent != null ? `${q.grossNpaPercent}%` : "—") },
              { label: "Net NPA", get: (q: ScreenerInQuarterlyPL) => (q.netNpaPercent != null ? `${q.netNpaPercent}%` : "—") },
            ]
          : []),
      ]
    : [
        { label: "Revenue", get: (q) => fmtCr(q.sales) },
        { label: "Operating profit", get: (q) => fmtCr(q.operatingProfit) },
        { label: "OPM", get: (q) => (q.opmPercent != null ? `${q.opmPercent}%` : "—") },
        { label: "Other income", get: (q) => fmtCr(q.otherIncome) },
        { label: "Interest", get: (q) => fmtCr(q.interest) },
        { label: "Net profit", get: (q) => fmtCr(q.netProfit) },
        { label: "EPS (₹)", get: (q) => (q.eps != null ? q.eps.toLocaleString("en-IN") : "—") },
      ];

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Quarterly Results</h3>
            <BasisBadge basis={basis} />
          </div>
          <p className="text-xs text-muted">₹ Cr · Indian fiscal year (Apr–Mar) · screener.in</p>
        </div>
        {resultsFiling && (
          <a
            href={resultsFiling.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand hover:underline"
          >
            Results announcement (NSE) ↗
          </a>
        )}
      </div>

      {/* Latest-quarter hero */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-lg bg-surface-2 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted">Latest quarter</span>
          <span className="text-base font-semibold">
            {indianFiscalLabel(latest.period)}
            <span className="ml-2 text-xs font-normal text-muted">(period ended {latest.period})</span>
          </span>
          {reportedAt && (
            <span className="text-[10px] text-muted">
              Reported {formatDate(reportedAt)}
              {reportedAudited && resultsMeta ? ` · ${resultsMeta.audited ? "audited" : "un-audited"}` : ""} · NSE
            </span>
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted">Revenue</span>
          <span className="font-mono text-sm font-semibold tabular-nums">
            ₹{fmtCr(latest.sales)} Cr
            <span className="ml-2 space-x-2">
              {deltaChip(salesYoY, "YoY")}
              {deltaChip(salesQoQ, "QoQ")}
            </span>
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted">Net profit</span>
          <span className="font-mono text-sm font-semibold tabular-nums">
            ₹{fmtCr(latest.netProfit)} Cr
            <span className="ml-2 space-x-2">
              {deltaChip(npYoY, "YoY")}
              {deltaChip(npQoQ, "QoQ")}
            </span>
          </span>
        </div>
        {latest.eps != null && (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wide text-muted">EPS</span>
            <span className="font-mono text-sm font-semibold tabular-nums">₹{latest.eps.toLocaleString("en-IN")}</span>
          </div>
        )}
        {upcoming && (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wide text-muted">Next results</span>
            <span className="text-sm font-semibold">{formatDate(upcoming.date)}</span>
            <span className="text-[10px] text-muted">NSE board-meeting calendar</span>
          </div>
        )}
      </div>

      {/* Bank asset quality from the official NSE filing when screener.in
          login-gates the NPA rows. Carries its own period — see comment above. */}
      {showNseAssetQuality && resultsMeta && (
        <p className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-xs text-muted">
          <span className="font-semibold text-foreground">Asset quality</span>
          {resultsMeta.grossNpaPercent != null && <> · Gross NPA <span className="font-mono text-foreground">{resultsMeta.grossNpaPercent}%</span></>}
          {resultsMeta.netNpaPercent != null && <> · Net NPA <span className="font-mono text-foreground">{resultsMeta.netNpaPercent}%</span></>}
          {resultsMeta.capitalAdequacyPercent != null && <> · CAR <span className="font-mono text-foreground">{resultsMeta.capitalAdequacyPercent}%</span></>}
          <span className="block text-[10px] text-muted/80">
            Standalone figures from the NSE results filing for the quarter ended {resultsMeta.periodEnd ? formatDate(resultsMeta.periodEnd) : "—"}
            {sameQuarter(resultsMeta.periodEnd, latest.period) ? "" : " (an earlier quarter than the table above — NSE publishes with a lag)"}.
          </span>
        </p>
      )}

      {/* Last five quarters */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium" />
              {cols.map((q) => (
                <th key={q.period} className={`px-3 py-2 text-right font-medium ${q === latest ? "text-foreground" : ""}`}>
                  {indianFiscalLabel(q.period)}
                  <span className="block text-[10px] font-normal normal-case text-muted/70">{q.period}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-2 pr-3 text-xs text-muted">{r.label}</td>
                {cols.map((q) => (
                  <td
                    key={q.period}
                    className={`px-3 py-2 text-right font-mono text-xs tabular-nums ${q === latest ? "font-semibold" : ""}`}
                  >
                    {r.get(q)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Statement tables (Balance Sheet / Cash Flow)                               */
/* -------------------------------------------------------------------------- */

interface StatementTableProps {
  title: string;
  stmt: ScreenerInStatements;
  basis: "consolidated" | "standalone" | null;
  /** Row names rendered emphasized (totals, FCF). */
  strongRows?: string[];
  /** Number of most-recent periods to show (all rows keep full history in data). */
  maxPeriods?: number;
}

export function StatementTable({ title, stmt, basis, strongRows = [], maxPeriods = 6 }: StatementTableProps) {
  if (stmt.rows.length === 0) return null;
  const start = Math.max(0, stmt.periods.length - maxPeriods);
  const periods = stmt.periods.slice(start);
  const strong = new Set(strongRows.map((s) => s.toLowerCase()));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <BasisBadge basis={basis} />
        </div>
        <p className="text-xs text-muted">₹ Cr · fiscal-year end (March) · screener.in</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium" />
              {periods.map((p) => (
                <th key={p} className="px-3 py-2 text-right font-medium">
                  {indianFiscalLabel(p, true)}
                  <span className="block text-[10px] font-normal normal-case text-muted/70">{p}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {stmt.rows.map((row) => {
              const emphasized = strong.has(row.name.toLowerCase());
              return (
                <tr key={row.name} className={emphasized ? "bg-surface-2/50" : undefined}>
                  <td className={`py-2 pr-3 text-xs ${emphasized ? "font-semibold text-foreground" : "text-muted"}`}>
                    {row.name}
                  </td>
                  {row.values.slice(start).map((v, i) => (
                    <td
                      key={periods[i]}
                      className={`px-3 py-2 text-right font-mono text-xs tabular-nums ${emphasized ? "font-semibold" : ""} ${v != null && v < 0 ? "text-negative" : ""}`}
                    >
                      {v == null ? "—" : v.toLocaleString("en-IN")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
