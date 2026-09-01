"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RegisterResponse, RegisterRow } from "@/app/api/valuation/register/route";
import type { RevalueResponse, RevaluationSummary } from "@/app/api/valuation/revalue/route";
import { formatCurrency } from "@/lib/format";
import { PageShell } from "@/app/_components/ui";
import { useBootReady } from "@/app/_components/boot-context";
import {
  IMPLIED_GROWTH_LABEL,
  IMPLIED_GROWTH_SHORT_CAVEAT,
  VALUATION_METHOD_SCOPE,
} from "@/lib/valuation/case";
import { CASE_FLAG_DETAIL, CASE_FLAG_LABEL, type CaseFlag } from "@/lib/valuation/summary";

/**
 * The Valuation Register — your book of cases.
 *
 * This is the counterpart to the workspace, and it belongs under Portfolio rather
 * than Research because the question it answers is a portfolio question: which of
 * my valuations have broken, gone stale, or were never really mine? A calculator
 * is somewhere you go when you remember to. A list of broken cases comes to you.
 *
 * Sorted by what needs attention rather than by upside — ranking ideas is the
 * Screener's job, and conflating the two would turn this into a second screener.
 */

const FLAG_TONE: Record<CaseFlag, string> = {
  unvaluable: "border-negative/40 bg-negative/10 text-negative",
  negative_margin: "border-negative/40 bg-negative/10 text-negative",
  stale: "border-warning/40 bg-warning/10 text-warning",
  untouched: "border-brand/40 bg-brand/10 text-brand",
  engine_divergence: "border-warning/40 bg-warning/10 text-warning",
};

export default function ValuationRegisterPage() {
  const [data, setData] = useState<RegisterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [revaluation, setRevaluation] = useState<RevalueResponse | null>(null);

  useBootReady(!loading, "portfolio");

  // `loading` starts true, so the initial fetch never has to set state
  // synchronously inside the effect — every state write happens in a callback
  // after the request settles.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/valuation/register")
      .then(async (res) => {
        const json = (await res.json()) as RegisterResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Could not load the register");
        return json;
      })
      .then((json) => { if (!cancelled) { setData(json); setLoading(false); } })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Could not load the register");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  /**
   * Re-run every case against the latest reported figures. Facts the user has
   * not claimed are refreshed; their own judgments are left alone and reported as
   * disagreements instead.
   */
  async function checkAgainstReported() {
    setChecking(true);
    setErr(null);
    try {
      const res = await fetch("/api/valuation/revalue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as RevalueResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not revalue");
      setRevaluation(json);
      // Rows are stale once facts have moved, so pull the register again.
      const refreshed = await fetch("/api/valuation/register");
      if (refreshed.ok) setData((await refreshed.json()) as RegisterResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not revalue");
    } finally {
      setChecking(false);
    }
  }

  const rows = data?.rows ?? [];
  const needingAttention = rows.filter((r) => r.flags.length > 0).length;
  const broken = revaluation?.results.filter((r) => r.severity !== "intact") ?? [];

  return (
    <PageShell py="py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Valuation Register</h1>
          <p className="text-sm text-muted">
            Every valuation case you hold, ordered by what needs attention rather than by upside.
            Margins of safety are recomputed against live prices.
          </p>
        </div>
        {rows.length > 0 ? (
          <button
            onClick={() => void checkAgainstReported()}
            disabled={checking}
            className="shrink-0 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
            title="Refresh each case's reported figures and report which cases no longer hold"
          >
            {checking ? "Checking…" : "↻ Check against reported figures"}
          </button>
        ) : null}
      </div>

      {err ? <p className="text-sm text-negative">{err}</p> : null}
      {data?.priceWarning ? (
        <p className="rounded-lg border border-yellow-500/40 light:border-yellow-700/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-400 light:text-yellow-700">
          ⚠ {data.priceWarning}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface py-14 text-center">
          <p className="text-sm font-semibold">No valuation cases yet</p>
          <p className="max-w-md text-xs leading-5 text-muted">
            A case is created the first time you open a company in the Valuation workspace. It only
            covers cash-generating operating companies — {VALUATION_METHOD_SCOPE.dcf_fcf.toLowerCase()}
          </p>
          <Link
            href="/valuation"
            className="rounded-lg bg-brand-strong px-4 py-2 text-sm font-medium text-background"
          >
            Open the workspace
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {revaluation ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
              <p className="text-label font-semibold uppercase tracking-widest text-muted/60">
                Checked against reported figures
              </p>
              {broken.length === 0 ? (
                <p className="text-sm text-muted">
                  Every case still holds against the latest reported numbers.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {broken.map((r) => <RevaluationLine key={r.symbol} result={r} />)}
                </ul>
              )}
              {revaluation.skipped.length > 0 ? (
                <p className="text-[11px] text-muted">
                  Could not refresh: {revaluation.skipped.join(", ")}.
                </p>
              ) : null}
              <p className="border-t border-border pt-2 text-[11px] leading-4 text-muted">
                <span className="font-medium text-foreground/80">Your calibration.</span>{" "}
                {revaluation.calibration.summary}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              {rows.length} case{rows.length === 1 ? "" : "s"}
              {needingAttention > 0 ? ` · ${needingAttention} needing attention` : " · all current"}
            </span>
            <span>
              {data?.hasEnginePriors
                ? "Compared against the quant engine's Monte Carlo prior"
                : "No engine priors published — run the quant engine to enable comparison"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  {/* "Fair value", not "Your value": the Yours? column says whose it is,
                      and most rows start life as machine seeds nobody owns. */}
                  <th className="px-3 py-2 text-right font-medium">Fair value</th>
                  <th className="px-3 py-2 text-right font-medium">Margin of safety</th>
                  <th className="px-3 py-2 text-right font-medium" title={IMPLIED_GROWTH_SHORT_CAVEAT}>
                    {IMPLIED_GROWTH_LABEL}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Engine p50</th>
                  <th className="px-3 py-2 text-left font-medium">Yours?</th>
                  <th className="px-3 py-2 text-left font-medium">Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RegisterTableRow key={row.symbol} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] leading-4 text-muted">
            {IMPLIED_GROWTH_LABEL} is the FCF growth rate that would justify each price{" "}
            <em>given that case&apos;s own WACC and terminal growth</em> — it moves when you change
            them, and is not a market observation. Engine p50 is the median of a 50,000-path Monte
            Carlo DCF run by the quant engine, shown as a systematic prior rather than a target.
          </p>
        </div>
      )}
    </PageShell>
  );
}

function RevaluationLine({ result }: { result: RevaluationSummary }) {
  const tone = result.severity === "broken"
    ? "border-negative/40 bg-negative/10 text-negative"
    : "border-warning/40 bg-warning/10 text-warning";
  return (
    <li className="flex flex-wrap items-baseline gap-2 text-xs leading-5">
      <span className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-medium ${tone}`}>
        {result.severity === "broken" ? "Broken" : "Weakened"}
      </span>
      <Link href={`/valuation?symbol=${result.symbol}`} className="font-mono text-brand hover:underline">
        {result.symbol}
      </Link>
      <span className="text-foreground/80">{result.headline}</span>
    </li>
  );
}

function RegisterTableRow({ row }: { row: RegisterRow }) {
  // A margin of safety is only meaningful against a fair value someone
  // believes. Until the user owns at least one assumption the row's number is
  // the machine seed's, so the cell abstains instead of printing a huge red
  // percentage the user never expressed.
  const owned = row.ownedKeys.length > 0;
  const mos = owned ? row.result.marginOfSafety : null;
  const mosTone = mos == null ? "text-muted"
    : mos >= 20 ? "text-positive"
    : mos >= 0 ? "text-yellow-500 light:text-yellow-700"
    : "text-negative";

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-2">
      <td className="px-3 py-2">
        <Link href={`/valuation?symbol=${row.symbol}`} className="font-mono font-medium text-brand hover:underline">
          {row.symbol}
        </Link>
        <span className="ml-2 text-[10px] text-muted">v{row.version}</span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {formatCurrency(row.price, row.currency)}
        {!row.priceIsLive ? <span className="ml-1 text-[10px] text-muted">stored</span> : null}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {row.result.invalidReason ? "—" : formatCurrency(row.result.fairValue, row.currency)}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono text-xs font-semibold ${mosTone}`}
        title={owned ? undefined : "Margin of safety applies once at least one assumption is yours — this case is still the machine seed."}
      >
        {mos == null ? "—" : `${mos >= 0 ? "+" : ""}${mos.toFixed(1)}%`}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-muted">
        {row.result.impliedGrowth != null ? `${row.result.impliedGrowth.toFixed(1)}%` : "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-muted">
        {row.enginePrior?.p50 != null ? (
          <span title={row.engineSpread != null ? `Case is ${(row.engineSpread * 100).toFixed(0)}% vs the engine` : undefined}>
            {formatCurrency(row.enginePrior.p50, row.currency)}
          </span>
        ) : "—"}
      </td>
      <td className="px-3 py-2 text-left text-xs text-muted">
        {row.ownedKeys.length === 0
          ? <span className="text-muted">none</span>
          : <span className="text-foreground/80">{row.ownedKeys.length} of 7</span>}
      </td>
      <td className="px-3 py-2 text-left">
        {row.flags.length === 0 ? (
          <span className="text-[11px] text-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.flags.map((flag) => (
              <span
                key={flag}
                title={CASE_FLAG_DETAIL[flag]}
                className={`rounded border px-1.5 py-px text-[10px] ${FLAG_TONE[flag]}`}
              >
                {CASE_FLAG_LABEL[flag]}
              </span>
            ))}
          </span>
        )}
      </td>
    </tr>
  );
}
