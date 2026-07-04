"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DcfPrefill } from "../api/dcf/route";
import { downloadBlob } from "@/lib/download";
import { formatCurrency, formatCompact } from "@/lib/format";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { useIOSSafe } from "@/lib/ios-context";

/* -------------------------------------------------------------------------- */
/* Number shorthand parser — accepts "93.7B", "15.2M", "500K", raw integers  */
/* -------------------------------------------------------------------------- */

function parseShorthand(s: string): number {
  const clean = s.trim().replace(/,/g, "");
  if (!clean) return NaN;
  const match = /^([+-]?\d+\.?\d*)([KkMmBbTt]?)$/.exec(clean);
  if (!match) return parseFloat(clean);
  const n = parseFloat(match[1]);
  const suffix = match[2].toUpperCase();
  const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return suffix ? n * (mult[suffix] ?? 1) : n;
}

function formatShorthand(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return String(n);
}

/* -------------------------------------------------------------------------- */
/* DCF math engine                                                             */
/* -------------------------------------------------------------------------- */

interface DcfInputs {
  baseFcf: number;
  growthRate1: number;
  growthRate2: number;
  terminalGrowth: number;
  discountRate: number;
  sharesOutstanding: number;
  netDebt: number;
}

function runDcf(inp: DcfInputs): number {
  const wacc = inp.discountRate / 100;
  const g = inp.terminalGrowth / 100;
  const g1 = inp.growthRate1 / 100;
  const g2 = inp.growthRate2 / 100;
  if (wacc <= g) return 0;
  let totalPV = 0;
  let fcf = inp.baseFcf;
  for (let yr = 1; yr <= 10; yr++) {
    const growth = yr <= 5 ? g1 : g1 + ((g2 - g1) * (yr - 5)) / 5;
    fcf = fcf * (1 + growth);
    totalPV += fcf / Math.pow(1 + wacc, yr);
  }
  const tv = (fcf * (1 + g)) / (wacc - g);
  totalPV += tv / Math.pow(1 + wacc, 10);
  const equity = totalPV - inp.netDebt;
  return inp.sharesOutstanding > 0 ? equity / inp.sharesOutstanding : 0;
}

/** Year-by-year FCF projection for display */
function buildProjection(inp: DcfInputs): { year: number; fcf: number; pv: number }[] {
  const wacc = inp.discountRate / 100;
  const g1 = inp.growthRate1 / 100;
  const g2 = inp.growthRate2 / 100;
  let fcf = inp.baseFcf;
  const rows = [];
  for (let yr = 1; yr <= 10; yr++) {
    const growth = yr <= 5 ? g1 : g1 + ((g2 - g1) * (yr - 5)) / 5;
    fcf = fcf * (1 + growth);
    rows.push({ year: yr, fcf, pv: fcf / Math.pow(1 + wacc, yr) });
  }
  return rows;
}

function buildScenarios(base: DcfInputs) {
  const bull: DcfInputs = { ...base, growthRate1: base.growthRate1 * 1.5, growthRate2: base.growthRate2 * 1.5, discountRate: base.discountRate - 1 };
  const bear: DcfInputs = { ...base, growthRate1: base.growthRate1 * 0.5, growthRate2: base.growthRate2 * 0.5, discountRate: base.discountRate + 2 };
  return {
    bull: Math.max(0, runDcf(bull)),
    base: Math.max(0, runDcf(base)),
    bear: Math.max(0, runDcf(bear)),
    bullInputs: bull,
    bearInputs: bear,
  };
}

const TG_RANGE = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

function buildWaccRange(centerWacc: number): number[] {
  const center = Math.round(Math.max(5, Math.min(25, centerWacc)));
  return [-3, -2, -1, 0, 1, 2, 3].map((delta) => center + delta);
}

function buildSensitivity(base: DcfInputs): { table: number[][]; waccRange: number[] } {
  const waccRange = buildWaccRange(base.discountRate);
  const table = waccRange.map((wacc) =>
    TG_RANGE.map((tg) => Math.max(0, runDcf({ ...base, discountRate: wacc, terminalGrowth: tg })))
  );
  return { table, waccRange };
}

const LS_KEY = "uaa_dcf_inputs";

interface SavedInputs { fcf: string; shares: string; netDebt: string; growthRate1: string; growthRate2: string; terminalGrowth: string; discountRate: string; symbol: string; }

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function DcfPage() {
  const ios = useIOSSafe();
  const [symbol, setSymbol] = useState("");
  const [input, setInput] = useState("");
  const [prefill, setPrefill] = useState<DcfPrefill | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [showProjection, setShowProjection] = useState(false);

  const [fcf,          setFcf]          = useState("");
  const [shares,       setShares]       = useState("");
  const [netDebt,      setNetDebt]      = useState("");
  const [growthRate1,  setGrowthRate1]  = useState("15");
  const [growthRate2,  setGrowthRate2]  = useState("8");
  const [terminalGrowth, setTerminalGrowth] = useState("3");
  const [discountRate, setDiscountRate] = useState("10");

  // Restore from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(LS_KEY);
      if (saved) {
        const p = JSON.parse(saved) as SavedInputs;
        /* eslint-disable react-hooks/set-state-in-effect */
        if (p.fcf)          setFcf(p.fcf);
        if (p.shares)       setShares(p.shares);
        if (p.netDebt)      setNetDebt(p.netDebt);
        if (p.growthRate1)  setGrowthRate1(p.growthRate1);
        if (p.growthRate2)  setGrowthRate2(p.growthRate2);
        if (p.terminalGrowth) setTerminalGrowth(p.terminalGrowth);
        if (p.discountRate) setDiscountRate(p.discountRate);
        if (p.symbol)       { setSymbol(p.symbol); setInput(p.symbol); }
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch { /* ignore */ }
  }, []);

  // Persist to sessionStorage whenever inputs change
  useEffect(() => {
    try {
      const data: SavedInputs = { fcf, shares, netDebt, growthRate1, growthRate2, terminalGrowth, discountRate, symbol };
      sessionStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }, [fcf, shares, netDebt, growthRate1, growthRate2, terminalGrowth, discountRate, symbol]);

  const applyPrefill = useCallback((p: DcfPrefill) => {
    if (p.freeCashflow   != null) setFcf(formatShorthand(Math.round(p.freeCashflow)));
    if (p.sharesOutstanding != null) setShares(formatShorthand(Math.round(p.sharesOutstanding)));
    if (p.netDebt        != null) setNetDebt(formatShorthand(Math.round(p.netDebt)));
    setDiscountRate(String(p.discountRateSuggestion));
    if (p.revenueGrowth  != null) {
      const g = Math.max(1, Math.min(50, p.revenueGrowth * 100));
      setGrowthRate1(g.toFixed(1));
      setGrowthRate2((g * 0.5).toFixed(1));
    }
  }, []);

  const lookup = useCallback(async (sym: string) => {
    if (!sym.trim()) return;
    setLoading(true); setErr(null);
    try {
      const res  = await fetch(`/api/dcf?symbol=${encodeURIComponent(sym.trim().toUpperCase())}`);
      const json = await res.json() as DcfPrefill & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Lookup failed");
      setPrefill(json);
      setSymbol(json.symbol);
      applyPrefill(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [applyPrefill]);

  useEffect(() => {
    const sym = new URLSearchParams(window.location.search).get("symbol");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sym) { setInput(sym); void lookup(sym); }
  }, [lookup]);

  useEffect(() => {
    document.title = symbol ? `${symbol} DCF · UAA` : "DCF Calculator · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [symbol]);

  // Computed values
  const fcfNum   = parseShorthand(fcf);
  const sharesNum = parseShorthand(shares);
  const netDebtNum = parseShorthand(netDebt) || 0;
  const g1Num    = parseFloat(growthRate1)   || 15;
  const g2Num    = parseFloat(growthRate2)   || 8;
  const tgNum    = parseFloat(terminalGrowth) || 3;
  const waccNum  = parseFloat(discountRate)  || 10;

  const waccInvalid = Number.isFinite(waccNum) && Number.isFinite(tgNum) && waccNum <= tgNum;

  const hasInputs = Number.isFinite(fcfNum) && fcfNum > 0 && Number.isFinite(sharesNum) && sharesNum > 0;

  const baseInputs: DcfInputs = {
    baseFcf: fcfNum || 0,
    growthRate1: g1Num, growthRate2: g2Num,
    terminalGrowth: tgNum, discountRate: waccNum,
    sharesOutstanding: sharesNum || 1, netDebt: netDebtNum,
  };

  const scenarios = hasInputs && !waccInvalid ? buildScenarios(baseInputs) : null;
  const sensitivityResult = hasInputs && !waccInvalid ? buildSensitivity(baseInputs) : null;
  const sensitivity = sensitivityResult?.table ?? null;
  const waccRange = sensitivityResult?.waccRange ?? [];
  const projection  = hasInputs && !waccInvalid ? buildProjection(baseInputs) : null;
  const price = prefill?.price ?? null;
  const mos = (scenarios && price && scenarios.base > 0) ? ((scenarios.base - price) / scenarios.base) * 100 : null;
  const mosColor = mos == null ? "" : mos >= 20 ? "text-positive" : mos >= 0 ? "text-yellow-500" : "text-negative";

  // IOS — portfolio fit and suggested allocation for the current symbol.
  const iosFit = ios?.profileReady && symbol
    ? ios.getPortfolioFit({
        symbol,
        sector: null,
        marketCap: null,
        scoreResult: null,
        dividendYield: null,
        geography: "US",
        isOnWatchlist: false,
      })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">DCF Valuation</h1>
          <p className="text-sm text-muted">
            Discounted free cash flow model. Data pre-fills from Yahoo Finance — every assumption is editable. Inputs persist between sessions.
          </p>
        </div>
      </div>

      {/* Symbol lookup */}
      <div className="flex gap-2">
        <SymbolSearch
          value={input}
          onChange={setInput}
          onSelect={(sym) => { setInput(sym); void lookup(sym); }}
          loading={loading}
        />
        <button
          onClick={() => void lookup(input)}
          disabled={loading}
          className="shrink-0 rounded-lg bg-accent-strong px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Analyse"}
        </button>
        {hasInputs && scenarios && sensitivity && (
          <button
            onClick={() => {
              setExportErr(null);
              void downloadBlob("/api/export/dcf", `dcf-${symbol}-${new Date().toISOString().slice(0, 10)}.xlsx`, "POST", {
                symbol, companyName: prefill?.name ?? symbol, currentPrice: prefill?.price ?? null,
                inputs: baseInputs, scenarios, sensitivity,
                waccRange, tgRange: TG_RANGE,
              }).catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
            }}
            className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            ↓ Export Excel
          </button>
        )}
      </div>
      {err        ? <p className="text-sm text-negative">{err}</p>       : null}
      {exportErr  ? <p className="text-sm text-negative">{exportErr}</p> : null}
      {waccInvalid ? (
        <p className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600 dark:text-yellow-400">
          ⚠ WACC ({waccNum}%) must be greater than terminal growth rate ({tgNum}%) — the Gordon Growth Model breaks down otherwise. Increase WACC or lower terminal growth.
        </p>
      ) : null}

      {!symbol ? (
        <div className="flex flex-col items-center gap-6 rounded-xl border border-border bg-surface py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17V7m4 10V3m4 14V9m4 8V5" />
            </svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">Search a ticker to start</p>
            <p className="max-w-sm text-xs leading-5 text-muted">
              FCF, shares outstanding, net debt, and WACC suggestion will pre-fill from Yahoo Finance. Every input is editable and saved between sessions.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"].map((sym) => (
              <button
                key={sym}
                onClick={() => { setInput(sym); void lookup(sym); }}
                className="rounded-lg border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:border-accent hover:text-accent"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
          {/* ── Inputs panel ── */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-semibold">{prefill?.name ?? symbol}</h2>
              <div className="flex items-center gap-2">
                {price ? (
                  <span className="font-mono text-sm text-muted">
                    Current: <span className="text-foreground">{formatCurrency(price)}</span>
                  </span>
                ) : null}
                {prefill && (
                  <button
                    onClick={() => applyPrefill(prefill)}
                    className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                    title="Overwrite all inputs with Yahoo Finance data"
                  >
                    ↑ Use Yahoo data
                  </button>
                )}
              </div>
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Starting FCF</legend>
              <DcfField label="Trailing FCF" value={fcf} onChange={setFcf}
                hint={prefill?.freeCashflow != null ? `Yahoo: ${formatCompact(prefill.freeCashflow)}` : ""}
                placeholder="e.g. 93.7B or 93700000000" />
              <DcfField label="Shares outstanding" value={shares} onChange={setShares}
                hint={prefill?.sharesOutstanding != null ? formatCompact(prefill.sharesOutstanding) : ""}
                placeholder="e.g. 15.5B" />
              <DcfField label="Net debt (negative = net cash)" value={netDebt} onChange={setNetDebt}
                hint={prefill?.netDebt != null ? formatCompact(prefill.netDebt) : ""}
                placeholder="e.g. -60B (net cash) or 50B" />
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Growth Assumptions</legend>
              <DcfField label="FCF growth Y1–5 (%)" value={growthRate1} onChange={setGrowthRate1} placeholder="15" isPercent />
              <DcfField label="FCF growth Y6–10 (%)" value={growthRate2} onChange={setGrowthRate2} placeholder="8" isPercent />
              <DcfField label="Terminal growth rate (%) — long-run perpetuity" value={terminalGrowth} onChange={setTerminalGrowth} placeholder="3" isPercent />
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Discount Rate</legend>
              <DcfField label="WACC (%)" value={discountRate} onChange={setDiscountRate}
                hint={`Suggested: ${prefill?.discountRateSuggestion ?? 10}% (beta-adjusted CAPM)`}
                placeholder="10" isPercent />
            </fieldset>

            {/* FCF Projection toggle */}
            {projection && (
              <div>
                <button
                  onClick={() => setShowProjection((v) => !v)}
                  className="text-xs text-accent hover:underline"
                >
                  {showProjection ? "▾ Hide" : "▸ Show"} year-by-year FCF projection
                </button>
                {showProjection && (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-2">
                        <tr>
                          <th className="px-2 py-1.5 text-left text-muted">Year</th>
                          <th className="px-2 py-1.5 text-right text-muted">FCF</th>
                          <th className="px-2 py-1.5 text-right text-muted">PV of FCF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projection.map((r) => (
                          <tr key={r.year} className="border-t border-border">
                            <td className="px-2 py-1 font-mono text-muted">{r.year}</td>
                            <td className="px-2 py-1 text-right font-mono">{formatCompact(r.fcf)}</td>
                            <td className="px-2 py-1 text-right font-mono text-muted">{formatCompact(r.pv)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Results panel ── */}
          <div className="flex flex-col gap-4">
            {/* Scenario cards — the primary output */}
            {scenarios ? (
              <div className="flex flex-col gap-3">
                {/* Valuation range bar */}
                {price && scenarios.bear > 0 && scenarios.bull > 0 && (
                  <ValuationRangeBar
                    bear={scenarios.bear}
                    base={scenarios.base}
                    bull={scenarios.bull}
                    price={price}
                  />
                )}
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="grid grid-cols-3 gap-px bg-border">
                    <ScenarioCard label="Bear" value={scenarios.bear} price={price} bg="bg-surface"
                      assumption={`Growth ×0.5, WACC +2% → ${scenarios.bearInputs.growthRate1.toFixed(1)}%/${scenarios.bearInputs.growthRate2.toFixed(1)}% @ ${scenarios.bearInputs.discountRate.toFixed(1)}%`} />
                    <ScenarioCard label="Base" value={scenarios.base} price={price} bg="bg-surface" highlight
                      assumption={`Y1–5: ${g1Num}% · Y6–10: ${g2Num}% · WACC: ${waccNum}% · TG: ${tgNum}%`} />
                    <ScenarioCard label="Bull" value={scenarios.bull} price={price} bg="bg-surface"
                      assumption={`Growth ×1.5, WACC −1% → ${scenarios.bullInputs.growthRate1.toFixed(1)}%/${scenarios.bullInputs.growthRate2.toFixed(1)}% @ ${scenarios.bullInputs.discountRate.toFixed(1)}%`} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                {waccInvalid ? "Fix WACC / terminal growth to see valuation." : "Enter FCF and shares to see valuation."}
              </div>
            )}

            {/* Margin of safety */}
            {mos != null ? (
              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-xs uppercase tracking-wide text-muted">Margin of Safety (base case)</p>
                <p className={`mt-1 font-mono text-2xl font-bold ${mosColor}`}>
                  {mos >= 0 ? "+" : ""}{mos.toFixed(1)}%
                </p>
                <p className="mt-1 text-xs text-muted">
                  {mos >= 30 ? "Stock appears significantly undervalued."
                    : mos >= 10 ? "Modest margin of safety — check assumptions."
                    : mos >= 0  ? "Little margin of safety at current price."
                    : "Stock appears overvalued vs this DCF."}
                </p>
              </div>
            ) : null}

            {/* IOS — portfolio fit + suggested allocation */}
            {iosFit && !iosFit.isGeneric && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-xs uppercase tracking-wide text-muted mb-2">Portfolio Context</p>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <span className="text-xs text-muted">Portfolio Fit</span>
                    <p className="font-mono text-lg font-bold">{iosFit.fitScore}<span className="text-xs text-muted font-normal">/100</span></p>
                  </div>
                  {iosFit.suggestedAllocationPct != null && (
                    <div className="text-right">
                      <span className="text-xs text-muted">Suggested Allocation</span>
                      <p className="font-mono text-lg font-bold text-positive">{iosFit.suggestedAllocationPct.toFixed(1)}%</p>
                      {iosFit.suggestedAmount != null && (
                        <p className="text-xs text-muted">{formatCurrency(iosFit.suggestedAmount)}</p>
                      )}
                    </div>
                  )}
                </div>
                {iosFit.reasons[0] && (
                  <p className="text-xs text-foreground/70">{iosFit.reasons[0]}</p>
                )}
                {iosFit.concentrationWarning && (
                  <p className="mt-1 text-xs text-amber-500">⚠ Would create concentration risk at full suggested size</p>
                )}
              </div>
            )}

            {/* Sensitivity table */}
            {sensitivity ? (
              <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted/60">
                      Sensitivity Analysis
                    </p>
                    <p className="text-xs text-muted">Fair value per share · Rows = WACC · Columns = Terminal growth</p>
                  </div>
                </div>
                {price && (
                  <p className="mb-3 text-xs text-muted">
                    <span className="text-positive font-medium">Green</span> = &gt;30% above current price ·{" "}
                    <span className="text-yellow-500">Yellow</span> = above price ·{" "}
                    <span className="text-negative">Red</span> = below price ·{" "}
                    <span className="rounded bg-accent/15 px-1 text-accent">Highlighted</span> = your base case
                  </p>
                )}
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left text-muted">WACC \ TG</th>
                      {TG_RANGE.map((tg) => (
                        <th key={tg} className="px-2 py-1 text-right font-mono text-muted">{tg}%</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {waccRange.map((wacc, ri) => (
                      <tr key={wacc} className="border-t border-border">
                        <td className={`px-2 py-1 font-mono ${Math.round(waccNum) === wacc ? "text-accent font-semibold" : "text-muted"}`}>{wacc}%</td>
                        {TG_RANGE.map((tg, ci) => {
                          const val = sensitivity[ri][ci];
                          const colorClass = price
                            ? val > price * 1.3 ? "text-positive font-semibold"
                            : val > price ? "text-yellow-500"
                            : "text-negative"
                            : "";
                          const isBase = Math.round(waccNum) === wacc && Math.abs(tg - tgNum) < 0.01;
                          return (
                            <td key={ci} className={`px-2 py-1 text-right font-mono ${colorClass} ${isBase ? "rounded bg-accent/15" : ""}`}>
                              {formatCurrency(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {symbol ? (
              <Link href={`/research?symbol=${symbol}`} className="text-center text-sm text-accent hover:underline">
                Full research report for {symbol} →
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                               */
/* -------------------------------------------------------------------------- */

function DcfField({ label, value, onChange, hint, placeholder, isPercent }: {
  label: string; value: string; onChange: (v: string) => void;
  hint?: string; placeholder?: string; isPercent?: boolean;
}) {
  const parsed = isPercent ? parseFloat(value) : parseShorthand(value);
  const invalid = value !== "" && !Number.isFinite(parsed);
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="text"
        inputMode={isPercent ? "decimal" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`rounded-lg border px-3 py-1.5 font-mono text-sm outline-none placeholder:text-muted focus:border-accent ${invalid ? "border-negative/60 bg-negative/5" : "border-border bg-surface-2"}`}
      />
      {hint   ? <span className="text-xs text-muted">{hint}</span>                    : null}
      {invalid ? <span className="text-xs text-negative">Enter a number (e.g. 93.7B, 15M)</span> : null}
      {!isPercent && !invalid && value && Number.isFinite(parsed) && Math.abs(parsed) >= 1e6
        ? <span className="text-xs text-accent/80">{formatCompact(parsed)}</span>
        : null}
    </label>
  );
}

function ValuationRangeBar({ bear, base, bull, price }: { bear: number; base: number; bull: number; price: number }) {
  const min = Math.min(bear, price) * 0.85;
  const max = Math.max(bull, price) * 1.1;
  const range = max - min;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / range) * 100));
  const priceColor = price >= base ? "bg-positive" : price <= bear ? "bg-negative" : "bg-warning";

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted/60">Fair Value Range</p>
      <div className="relative h-8">
        {/* Range band */}
        <div
          className="absolute top-2 h-4 rounded-full bg-accent/15 border border-accent/25"
          style={{ left: `${pct(bear)}%`, width: `${pct(bull) - pct(bear)}%` }}
        />
        {/* Bear marker */}
        <div className="absolute top-0 flex flex-col items-center -translate-x-1/2" style={{ left: `${pct(bear)}%` }}>
          <div className="h-2 w-px bg-negative" />
          <div className="mt-1 h-4 w-px bg-negative" />
        </div>
        {/* Base marker */}
        <div className="absolute top-1 flex flex-col items-center -translate-x-1/2" style={{ left: `${pct(base)}%` }}>
          <div className="h-6 w-0.5 rounded-full bg-accent" />
        </div>
        {/* Bull marker */}
        <div className="absolute top-0 flex flex-col items-center -translate-x-1/2" style={{ left: `${pct(bull)}%` }}>
          <div className="h-2 w-px bg-positive" />
          <div className="mt-1 h-4 w-px bg-positive" />
        </div>
        {/* Current price marker */}
        <div className="absolute top-1 flex flex-col items-center -translate-x-1/2" style={{ left: `${pct(price)}%` }}>
          <div className={`h-6 w-1 rounded-full ${priceColor}`} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted">
        <span className="text-negative font-mono">{formatCurrency(bear)} bear</span>
        <span className="text-accent font-mono font-semibold">{formatCurrency(base)} base</span>
        <span className="text-positive font-mono">{formatCurrency(bull)} bull</span>
      </div>
      <div className="mt-1 text-center text-[10px] text-muted">
        Current price: <span className={`font-mono font-semibold ${priceColor.replace("bg-", "text-")}`}>{formatCurrency(price)}</span>
      </div>
    </div>
  );
}

function ScenarioCard({ label, value, price, bg, highlight, assumption }: {
  label: string; value: number; price: number | null;
  bg: string; highlight?: boolean; assumption: string;
}) {
  const upside = price && value > 0 ? ((value - price) / price) * 100 : null;
  const color  = upside == null ? "" : upside >= 0 ? "text-positive" : "text-negative";
  const borderAccent = highlight ? "ring-inset ring-1 ring-accent/30" : "";
  return (
    <div className={`${bg} flex flex-col gap-1.5 p-4 ${borderAccent}`}>
      <dt className={`text-[10px] font-semibold uppercase tracking-widest ${
        label === "Bull" ? "text-positive" : label === "Bear" ? "text-negative" : "text-accent"
      }`}>{label}</dt>
      <dd className="font-mono text-xl font-bold text-foreground">{formatCurrency(value)}</dd>
      {upside != null ? (
        <dd className={`font-mono text-xs font-medium ${color}`}>{upside >= 0 ? "+" : ""}{upside.toFixed(1)}%</dd>
      ) : null}
      <dd className="mt-1 text-[11px] leading-snug text-muted">{assumption}</dd>
    </div>
  );
}
