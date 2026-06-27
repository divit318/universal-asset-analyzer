"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DcfPrefill } from "../api/dcf/route";
import { formatCurrency, formatCompact } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* DCF math engine                                                             */
/* -------------------------------------------------------------------------- */

interface DcfInputs {
  baseFcf: number;          // starting FCF ($)
  growthRate1: number;      // Y1-5 annual growth (%)
  growthRate2: number;      // Y6-10 annual growth (%)
  terminalGrowth: number;   // perpetuity growth (%)
  discountRate: number;     // WACC (%)
  sharesOutstanding: number; // shares count
  netDebt: number;          // $, positive = net debt, negative = net cash
}

function runDcf(inp: DcfInputs): number {
  const wacc = inp.discountRate / 100;
  const g = inp.terminalGrowth / 100;
  const g1 = inp.growthRate1 / 100;
  const g2 = inp.growthRate2 / 100;

  let totalPV = 0;
  let fcf = inp.baseFcf;

  for (let yr = 1; yr <= 10; yr++) {
    const growth = yr <= 5 ? g1 : g1 + ((g2 - g1) * (yr - 5)) / 5;
    fcf = fcf * (1 + growth);
    totalPV += fcf / Math.pow(1 + wacc, yr);
  }

  // Terminal value at year 10
  const tv = (fcf * (1 + g)) / (wacc - g);
  const pvTv = tv / Math.pow(1 + wacc, 10);
  totalPV += pvTv;

  const equity = totalPV - inp.netDebt;
  return inp.sharesOutstanding > 0 ? equity / inp.sharesOutstanding : 0;
}

function buildScenarios(base: DcfInputs) {
  const bull: DcfInputs = {
    ...base,
    growthRate1: base.growthRate1 * 1.5,
    growthRate2: base.growthRate2 * 1.5,
    discountRate: base.discountRate - 1,
  };
  const bear: DcfInputs = {
    ...base,
    growthRate1: base.growthRate1 * 0.5,
    growthRate2: base.growthRate2 * 0.5,
    discountRate: base.discountRate + 2,
  };
  return {
    bull: Math.max(0, runDcf(bull)),
    base: Math.max(0, runDcf(base)),
    bear: Math.max(0, runDcf(bear)),
  };
}

/** Sensitivity matrix: rows = WACC, cols = terminal growth */
const WACC_RANGE = [8, 9, 10, 11, 12, 13, 14];
const TG_RANGE = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

function buildSensitivity(base: DcfInputs): number[][] {
  return WACC_RANGE.map((wacc) =>
    TG_RANGE.map((tg) => Math.max(0, runDcf({ ...base, discountRate: wacc, terminalGrowth: tg })))
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function DcfPage() {
  const [symbol, setSymbol] = useState("");
  const [input, setInput] = useState("");
  const [prefill, setPrefill] = useState<DcfPrefill | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // DCF inputs — controlled
  const [fcf, setFcf] = useState("");
  const [shares, setShares] = useState("");
  const [netDebt, setNetDebt] = useState("");
  const [growthRate1, setGrowthRate1] = useState("15");
  const [growthRate2, setGrowthRate2] = useState("8");
  const [terminalGrowth, setTerminalGrowth] = useState("3");
  const [discountRate, setDiscountRate] = useState("10");

  const lookup = useCallback(async (sym: string) => {
    if (!sym.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/dcf?symbol=${encodeURIComponent(sym.trim().toUpperCase())}`);
      const json = await res.json() as DcfPrefill & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Lookup failed");
      setPrefill(json);
      setSymbol(json.symbol);
      // Pre-fill from Yahoo data
      if (json.freeCashflow != null) setFcf(String(Math.round(json.freeCashflow)));
      if (json.sharesOutstanding != null) setShares(String(Math.round(json.sharesOutstanding)));
      if (json.netDebt != null) setNetDebt(String(Math.round(json.netDebt)));
      setDiscountRate(String(json.discountRateSuggestion));
      // Suggest growth from trailing revenue growth
      if (json.revenueGrowth != null) {
        const g = Math.max(1, Math.min(50, json.revenueGrowth * 100));
        setGrowthRate1(g.toFixed(1));
        setGrowthRate2((g * 0.5).toFixed(1));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sym = new URLSearchParams(window.location.search).get("symbol");
    if (sym) { setInput(sym); void lookup(sym); }
  }, [lookup]);

  // Compute DCF results
  const fcfNum = parseFloat(fcf);
  const sharesNum = parseFloat(shares);
  const netDebtNum = parseFloat(netDebt) || 0;
  const g1Num = parseFloat(growthRate1) || 15;
  const g2Num = parseFloat(growthRate2) || 8;
  const tgNum = parseFloat(terminalGrowth) || 3;
  const waccNum = parseFloat(discountRate) || 10;

  const hasInputs = Number.isFinite(fcfNum) && fcfNum > 0 && Number.isFinite(sharesNum) && sharesNum > 0;

  const baseInputs: DcfInputs = {
    baseFcf: fcfNum || 0,
    growthRate1: g1Num,
    growthRate2: g2Num,
    terminalGrowth: tgNum,
    discountRate: waccNum,
    sharesOutstanding: sharesNum || 1,
    netDebt: netDebtNum,
  };

  const scenarios = hasInputs ? buildScenarios(baseInputs) : null;
  const sensitivity = hasInputs ? buildSensitivity(baseInputs) : null;
  const price = prefill?.price ?? null;
  const mos = (scenarios && price && scenarios.base > 0)
    ? ((scenarios.base - price) / scenarios.base) * 100
    : null;

  const mosColor = mos == null ? "" : mos >= 20 ? "text-positive" : mos >= 0 ? "text-yellow-500" : "text-negative";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">DCF Calculator</h1>
        <p className="text-sm text-muted">
          Estimate intrinsic value via discounted free cash flow. Data pre-fills from Yahoo Finance — adjust every assumption.
        </p>
      </div>

      {/* Symbol lookup */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") void lookup(input); }}
          placeholder="Enter ticker — e.g. AAPL"
          className="flex-1 rounded-lg border border-border bg-surface-2 px-4 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          onClick={() => void lookup(input)}
          disabled={loading}
          className="rounded-lg bg-accent-strong px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>
      {err ? <p className="text-sm text-negative">{err}</p> : null}

      {/* Two-column layout: inputs left, results right */}
      {symbol ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Inputs panel */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{prefill?.name ?? symbol}</h2>
              {price ? (
                <span className="font-mono text-sm text-muted">
                  Current: <span className="text-foreground">{formatCurrency(price)}</span>
                </span>
              ) : null}
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Starting FCF</legend>
              <DcfField
                label="Trailing FCF ($)"
                value={fcf}
                onChange={setFcf}
                hint={prefill?.freeCashflow != null ? `Yahoo: ${formatCompact(prefill.freeCashflow)}` : ""}
                placeholder="e.g. 100000000000"
              />
              <DcfField label="Shares outstanding" value={shares} onChange={setShares}
                hint={prefill?.sharesOutstanding != null ? formatCompact(prefill.sharesOutstanding) : ""}
                placeholder="e.g. 15500000000" />
              <DcfField label="Net debt ($, negative = net cash)" value={netDebt} onChange={setNetDebt}
                hint={prefill?.netDebt != null ? formatCompact(prefill.netDebt) : ""}
                placeholder="e.g. 50000000000" />
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Growth Assumptions</legend>
              <DcfField label="FCF growth Y1–5 (%)" value={growthRate1} onChange={setGrowthRate1} placeholder="15" />
              <DcfField label="FCF growth Y6–10 (%)" value={growthRate2} onChange={setGrowthRate2} placeholder="8" />
              <DcfField label="Terminal growth rate (%)" value={terminalGrowth} onChange={setTerminalGrowth} placeholder="3" />
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Discount Rate</legend>
              <DcfField
                label="WACC (%)"
                value={discountRate}
                onChange={setDiscountRate}
                hint={`Suggested: ${prefill?.discountRateSuggestion ?? 10}% (beta-adjusted)`}
                placeholder="10"
              />
            </fieldset>
          </div>

          {/* Results panel */}
          <div className="flex flex-col gap-4">
            {/* Scenario cards */}
            {scenarios ? (
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
                <ScenarioCard label="Bear" value={scenarios.bear} price={price} bg="bg-surface" />
                <ScenarioCard label="Base" value={scenarios.base} price={price} bg="bg-surface" highlight />
                <ScenarioCard label="Bull" value={scenarios.bull} price={price} bg="bg-surface" />
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Enter a ticker and FCF to see valuation
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
                  {mos >= 30
                    ? "Stock appears significantly undervalued."
                    : mos >= 10
                    ? "Modest margin of safety — check assumptions."
                    : mos >= 0
                    ? "Little margin of safety at current price."
                    : "Stock appears overvalued vs this DCF."}
                </p>
              </div>
            ) : null}

            {/* Sensitivity table */}
            {sensitivity ? (
              <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  Sensitivity — Fair Value / Share (WACC × Terminal Growth)
                </p>
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
                    {WACC_RANGE.map((wacc, ri) => (
                      <tr key={wacc} className="border-t border-border">
                        <td className="px-2 py-1 font-mono text-muted">{wacc}%</td>
                        {TG_RANGE.map((_, ci) => {
                          const val = sensitivity[ri][ci];
                          const bg = price
                            ? val > price * 1.3
                              ? "text-positive font-semibold"
                              : val > price
                              ? "text-yellow-500"
                              : "text-negative"
                            : "";
                          const isBase = wacc === Math.round(waccNum) && TG_RANGE[ci] === parseFloat(terminalGrowth);
                          return (
                            <td
                              key={ci}
                              className={`px-2 py-1 text-right font-mono ${bg} ${isBase ? "rounded bg-accent/10" : ""}`}
                            >
                              {formatCurrency(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">Green = &gt;30% above price · Yellow = above price · Red = below price</p>
              </div>
            ) : null}

            {symbol ? (
              <Link
                href={`/research?symbol=${symbol}`}
                className="text-center text-sm text-accent hover:underline"
              >
                Full research report for {symbol} →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function DcfField({
  label, value, onChange, hint, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
      />
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function ScenarioCard({
  label, value, price, bg, highlight,
}: {
  label: string;
  value: number;
  price: number | null;
  bg: string;
  highlight?: boolean;
}) {
  const upside = price && value > 0 ? ((value - price) / price) * 100 : null;
  const color = upside == null ? "" : upside >= 0 ? "text-positive" : "text-negative";
  return (
    <div className={`${bg} flex flex-col gap-1 p-4 ${highlight ? "ring-inset ring-1 ring-accent/30" : ""}`}>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono text-lg font-semibold">{formatCurrency(value)}</dd>
      {upside != null ? (
        <dd className={`font-mono text-xs ${color}`}>
          {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% vs price
        </dd>
      ) : null}
    </div>
  );
}
