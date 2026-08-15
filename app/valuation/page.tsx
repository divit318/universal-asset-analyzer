"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ValuationCaseResponse } from "@/app/api/valuation/route";
import type { RefreshResponse } from "@/app/api/valuation/refresh/route";
import { downloadBlob } from "@/lib/download";
import { formatCurrency } from "@/lib/format";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { useIOSSafe } from "@/lib/ios-context";
import { useFocusSafe } from "@/lib/focus-context";
import { PageShell } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { useBootReady } from "@/app/_components/boot-context";
import {
  ASSUMPTION_KEYS,
  ASSUMPTION_LABEL,
  applyUserEdits,
  assumptionsToDcf,
  caseFreshness,
  computeCaseResult,
  type AssumptionKey,
  type ValuationCase,
  type ValuationEvent,
} from "@/lib/valuation/case";
import {
  DCF_INVALID_MESSAGE,
  TERMINAL_GROWTH_RANGE,
  buildScenarios,
  buildSensitivity,
  describeScenario,
} from "@/lib/valuation/dcf";
import { VALUATION_METHOD_LABEL, VALUATION_METHOD_SCOPE } from "@/lib/valuation/case";
import type { DeliveredGrowth } from "@/lib/valuation/prefill";
import { AssumptionRow } from "./_components/assumption-row";
import { MarketExpectation } from "./_components/market-expectation";
import { CaseHistory } from "./_components/case-history";

/**
 * The Valuation workspace.
 *
 * Not a calculator. It reads and writes one persisted ValuationCase per symbol —
 * the single place in the app that answers "what is this worth" — so the Research
 * Hub and the IC Report can display a valuation without computing one of their own.
 *
 * Two behaviours are deliberate. Edits recompute locally and instantly, then
 * persist in the background, because an assumption you cannot re-evaluate at once
 * is not interactive. And the user never names or manages a version: they edit, a
 * version appears in the log, and the history is an audit trail rather than
 * something to administer.
 */

/** Shown while facts are still loading, or when the symbol has no history at all. */
const NO_DELIVERED_GROWTH: DeliveredGrowth = {
  value: null, basis: "none", window: null, label: "No growth history", isProxy: false,
};

export default function ValuationPage() {
  const ios = useIOSSafe();
  const focus = useFocusSafe();

  const [symbol, setSymbol] = useState("");
  const [input, setInput] = useState("");
  const [data, setData] = useState<ValuationCaseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [events, setEvents] = useState<ValuationEvent[] | null>(null);
  const [eventsAt, setEventsAt] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refinement, setRefinement] = useState<RefreshResponse | null>(null);

  useBootReady(!loading, "valuation");

  const lookup = useCallback(async (sym: string) => {
    if (!sym.trim()) return;
    setLoading(true);
    setErr(null);
    setEvents(null);
    setRefinement(null);
    try {
      const res = await fetch(`/api/valuation?symbol=${encodeURIComponent(sym.trim().toUpperCase())}`);
      const json = (await res.json()) as ValuationCaseResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Lookup failed");
      setData(json);
      setSymbol(json.facts.symbol);
      focus?.recordFocus(json.facts.symbol);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
    // `focus.recordFocus` is stable; adding `focus` (whose identity changes on
    // each record) would re-create lookup and re-fetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sym = new URLSearchParams(window.location.search).get("symbol");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sym) { setInput(sym); void lookup(sym); }
  }, [lookup]);

  // Seed the box from the focus spine when opened without a symbol of its own.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !focus?.mostRecent) return;
    if (new URLSearchParams(window.location.search).get("symbol") || input) {
      prefilledRef.current = true;
      return;
    }
    prefilledRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(focus.mostRecent);
  }, [focus?.mostRecent, input]);

  useEffect(() => {
    document.title = symbol ? `${symbol} Valuation · UAA` : "Valuation · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [symbol]);

  const vcase = data?.case ?? null;
  const facts = data?.facts ?? null;
  const currency = vcase?.currency ?? facts?.currency ?? "USD";
  const price = facts?.price ?? vcase?.priceAt ?? null;

  /**
   * Apply an edit optimistically, then persist. The local recompute is what makes
   * the control feel live; the POST is what makes it survive a reload. On failure
   * the server's copy is restored, so the screen never keeps a value the log does
   * not have.
   */
  const commitEdit = useCallback(
    async (key: AssumptionKey, value: number, rationale: string | null) => {
      if (!vcase) return;
      const previous = vcase;
      const assumptions = applyUserEdits(vcase.assumptions, [{ key, value, rationale }]);
      const optimistic: ValuationCase = {
        ...vcase,
        assumptions,
        result: computeCaseResult(assumptions, price),
      };
      setData((d) => (d ? { ...d, case: optimistic } : d));
      setSaving(true);
      setErr(null);
      try {
        const res = await fetch("/api/valuation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: previous.symbol, edits: [{ key, value, rationale }] }),
        });
        const json = (await res.json()) as { case?: ValuationCase; error?: string };
        if (!res.ok || !json.case) throw new Error(json.error ?? "Could not save");
        setData((d) => (d ? { ...d, case: json.case! } : d));
        setEvents(null);     // the history is stale now
        setRefinement(null); // AI's assessment referred to the value just changed
      } catch (e) {
        setData((d) => (d ? { ...d, case: previous } : d));
        setErr(e instanceof Error ? e.message : "Could not save");
      } finally {
        setSaving(false);
      }
    },
    [vcase, price],
  );

  /**
   * Ask AI to refine the case. It may only move assumptions the user has not
   * claimed; anything owned comes back as an objection instead, which is why the
   * response reports `respected` separately from `applied`.
   */
  const refreshWithAi = useCallback(async () => {
    if (!vcase) return;
    setRefreshing(true);
    setErr(null);
    try {
      const res = await fetch("/api/valuation/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: vcase.symbol }),
      });
      const json = (await res.json()) as RefreshResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "AI refinement failed");
      setData((d) => (d ? { ...d, case: json.case } : d));
      setRefinement(json);
      setEvents(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI refinement failed");
    } finally {
      setRefreshing(false);
    }
  }, [vcase]);

  /**
   * Exports the persisted case — assumptions with provenance and reasoning,
   * AI's objections, and the full version history — rather than just the seven
   * numbers it currently resolves to. Guarded against double-clicks: a second
   * export of the same case adds nothing but server load.
   */
  const exportCase = useCallback(async () => {
    if (!symbol || exporting) return;
    setExporting(true);
    setExportErr(null);
    try {
      await downloadBlob(
        "/api/export/valuation",
        `valuation-${symbol}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        "POST",
        { symbol },
      );
    } catch (e) {
      console.error("[valuation] export failed:", e);
      setExportErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [symbol, exporting]);

  const loadHistory = useCallback(async () => {
    if (!symbol) return;
    try {
      const res = await fetch(`/api/valuation?symbol=${encodeURIComponent(symbol)}&history=1`);
      const json = (await res.json()) as { events?: ValuationEvent[] };
      setEvents(json.events ?? []);
      setEventsAt(Date.now());
    } catch {
      setEvents([]);
      setEventsAt(Date.now());
    }
  }, [symbol]);

  // Opening the history is an event, not state to synchronize — so it fetches
  // on the click rather than from an effect watching the toggle.
  const toggleHistory = useCallback(() => {
    setShowHistory((open) => {
      if (!open && events === null) void loadHistory();
      return !open;
    });
  }, [events, loadHistory]);

  const dcf = vcase ? assumptionsToDcf(vcase.assumptions) : null;
  const invalidReason = vcase?.result.invalidReason ?? null;
  const computable = dcf !== null && invalidReason === null;
  const scenarios = computable && dcf ? buildScenarios(dcf) : null;
  const sensitivity = computable && dcf ? buildSensitivity(dcf) : null;
  const mos = vcase?.result.marginOfSafety ?? null;
  const mosColor = mos == null ? "" : mos >= 20 ? "text-positive" : mos >= 0 ? "text-yellow-500 light:text-yellow-700" : "text-negative";
  const fresh = vcase ? caseFreshness(vcase.updatedAt) : null;

  const iosFit = ios?.profileReady && symbol
    ? ios.getPortfolioFit({
        symbol, sector: null, marketCap: null, scoreResult: null,
        dividendYield: null, geography: "US", isOnWatchlist: false,
      })
    : null;

  return (
    <PageShell py="py-10">
      <Reveal index={0} className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Valuation</h1>
        <p className="text-sm text-muted">
          One living valuation case per company — seeded from what today&apos;s price implies,
          corrected by you, versioned every time it changes.{" "}
          <span title={VALUATION_METHOD_SCOPE.dcf_fcf}>
            Method: {VALUATION_METHOD_LABEL.dcf_fcf.toLowerCase()}.
          </span>
        </p>
      </Reveal>

      <Reveal index={1} className="flex gap-2">
        <SymbolSearch
          value={input}
          onChange={setInput}
          onSelect={(sym) => { setInput(sym); void lookup(sym); }}
          loading={loading}
        />
        <button
          onClick={() => void lookup(input)}
          disabled={loading}
          className="shrink-0 rounded-lg bg-brand-strong px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Open case"}
        </button>
        {vcase ? (
          <button
            onClick={() => void exportCase()}
            disabled={exporting}
            aria-busy={exporting}
            className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "↓ Export case"}
          </button>
        ) : null}
      </Reveal>

      {err ? <p className="text-sm text-negative">{err}</p> : null}
      {exportErr ? <p className="text-sm text-negative">{exportErr}</p> : null}
      {data?.unvaluable ? (
        <p className="rounded-lg border border-yellow-500/40 light:border-yellow-700/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-400 light:text-yellow-700">
          ⚠ {data.unvaluable}
        </p>
      ) : null}
      {invalidReason ? (
        <p className="rounded-lg border border-yellow-500/40 light:border-yellow-700/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-400 light:text-yellow-700">
          ⚠ {DCF_INVALID_MESSAGE[invalidReason]} The case is saved — adjust an assumption to value it again.
        </p>
      ) : null}

      {!symbol ? (
        <Reveal index={2} className="flex flex-col items-center gap-6 rounded-xl border border-border bg-surface py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17V7m4 10V3m4 14V9m4 8V5" />
            </svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">Search a ticker to open its case</p>
            <p className="max-w-sm text-xs leading-5 text-muted">
              A case is created automatically from the price and balance sheet — no setup. It opens on
              what the market is already assuming.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"].map((sym) => (
              <button
                key={sym}
                onClick={() => { setInput(sym); void lookup(sym); }}
                className="rounded-lg border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:border-brand hover:text-brand"
              >
                {sym}
              </button>
            ))}
          </div>
        </Reveal>
      ) : vcase ? (
        <Reveal index={2} className="flex flex-col gap-6">
          <MarketExpectation
            currency={currency}
            price={price}
            impliedGrowth={vcase.result.impliedGrowth}
            delivered={facts?.deliveredGrowth ?? NO_DELIVERED_GROWTH}
            yourGrowth={vcase.assumptions.growthRate1.value}
          />

          <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
            {/* ── Assumptions ── */}
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{facts?.name ?? symbol}</h2>
                <span className="text-[11px] text-muted">
                  v{vcase.version} · {fresh?.label}{saving ? " · saving…" : ""}
                </span>
              </div>
              <p className="text-[11px] leading-4 text-muted">
                Every value carries where it came from. Once you set one it becomes yours — AI may
                object to it, but will never overwrite it.
              </p>

              <button
                onClick={() => void refreshWithAi()}
                disabled={refreshing || saving}
                className="self-start rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
              >
                {refreshing ? "Reviewing…" : "↻ Review with AI"}
              </button>

              {refinement ? (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
                  {refinement.assessment ? (
                    <p className="text-[11px] leading-4">{refinement.assessment}</p>
                  ) : null}
                  {refinement.applied.length > 0 ? (
                    <p className="text-[11px] text-muted">
                      Updated{" "}
                      {refinement.applied.map((k) => ASSUMPTION_LABEL[k]).join(", ")}.
                    </p>
                  ) : null}
                  {refinement.respected.length > 0 ? (
                    <p className="text-[11px] text-brand">
                      Deferred to you on{" "}
                      {refinement.respected.map((k) => ASSUMPTION_LABEL[k]).join(", ")} — see the
                      objection on each.
                    </p>
                  ) : null}
                  {refinement.weakest.length > 0 ? (
                    <p className="text-[11px] text-muted">
                      Least supported:{" "}
                      {refinement.weakest.map((k) => ASSUMPTION_LABEL[k]).join(", ")}.
                    </p>
                  ) : null}
                  {refinement.applied.length === 0 && refinement.respected.length === 0 ? (
                    <p className="text-[11px] text-muted">No changes proposed.</p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                {ASSUMPTION_KEYS.map((key) => (
                  <AssumptionRow
                    // The saved value is part of the key so the row remounts —
                    // and re-seeds its draft — whenever the case changes under it.
                    key={`${key}:${vcase.assumptions[key].updatedAt}:${vcase.assumptions[key].value}`}
                    assumptionKey={key}
                    assumption={vcase.assumptions[key]}
                    currency={currency}
                    saving={saving}
                    onCommit={(value, rationale) => void commitEdit(key, value, rationale)}
                  />
                ))}
              </div>

              <button
                onClick={toggleHistory}
                className="self-start text-xs text-brand hover:underline"
              >
                {showHistory ? "▾ Hide" : "▸ Show"} case history
              </button>
              {showHistory ? (
                <div className="overflow-hidden rounded-lg border border-border">
                  {events === null
                    ? <p className="px-3 py-2 text-xs text-muted">Loading…</p>
                    : <CaseHistory events={events} currency={currency} now={eventsAt} />}
                </div>
              ) : null}
            </div>

            {/* ── Result ── */}
            <div className="flex flex-col gap-4">
              {scenarios && dcf ? (
                <>
                  <div className="rounded-xl border border-border bg-surface p-5">
                    <p className="text-label font-semibold uppercase tracking-widest text-muted/60">
                      Your case
                    </p>
                    <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] uppercase tracking-wide text-muted">Fair value</span>
                        <span className="font-mono text-3xl font-bold">
                          {formatCurrency(vcase.result.fairValue, currency)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] uppercase tracking-wide text-muted">Margin of safety</span>
                        <span className={`font-mono text-3xl font-bold ${mosColor}`}>
                          {mos == null ? "—" : `${mos >= 0 ? "+" : ""}${mos.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] uppercase tracking-wide text-muted">From perpetuity</span>
                        <span className="font-mono text-xl font-semibold text-muted">
                          {(vcase.result.terminalValueShare * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    {mos != null ? (
                      <p className="mt-2 text-xs text-muted">
                        {mos >= 30 ? "Significantly below your estimate of value."
                          : mos >= 10 ? "Modest margin of safety — check the assumptions."
                          : mos >= 0 ? "Little margin of safety at this price."
                          : "Priced above your own case."}
                      </p>
                    ) : null}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="grid grid-cols-3 gap-px bg-border">
                      <ScenarioCard label="Bear" value={scenarios.bear.fairValuePerShare} price={price}
                        currency={currency} assumption={describeScenario(dcf, scenarios.bearAssumptions)} />
                      <ScenarioCard label="Base" value={scenarios.base.fairValuePerShare} price={price}
                        currency={currency} highlight assumption="Your assumptions as saved" />
                      <ScenarioCard label="Bull" value={scenarios.bull.fairValuePerShare} price={price}
                        currency={currency} assumption={describeScenario(dcf, scenarios.bullAssumptions)} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                  Adjust the assumptions to value this case.
                </div>
              )}

              {iosFit && !iosFit.isGeneric ? (
                <div className="rounded-xl border border-border bg-surface p-4">
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted">Portfolio context</p>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs text-muted">Portfolio fit</span>
                      <p className="font-mono text-lg font-bold">
                        {iosFit.fitScore}<span className="text-xs font-normal text-muted">/100</span>
                      </p>
                    </div>
                    {iosFit.suggestedAllocationPct != null ? (
                      <div className="text-right">
                        <span className="text-xs text-muted">Suggested allocation</span>
                        <p className="font-mono text-lg font-bold text-positive">
                          {iosFit.suggestedAllocationPct.toFixed(1)}%
                        </p>
                      </div>
                    ) : null}
                  </div>
                  {iosFit.reasons[0] ? <p className="text-xs text-foreground/70">{iosFit.reasons[0]}</p> : null}
                </div>
              ) : null}

              {sensitivity ? (
                <div className="rounded-xl border border-border bg-surface p-4">
                  <button
                    onClick={() => setShowSensitivity((v) => !v)}
                    className="text-xs text-brand hover:underline"
                  >
                    {showSensitivity ? "▾ Hide" : "▸ Show"} sensitivity to WACC and terminal growth
                  </button>
                  {showSensitivity ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <th className="px-2 py-1 text-left text-muted">WACC \ TG</th>
                            {TERMINAL_GROWTH_RANGE.map((tg) => (
                              <th key={tg} className="px-2 py-1 text-right font-mono text-muted">{tg}%</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sensitivity.waccRange.map((wacc, ri) => (
                            <tr key={wacc} className="border-t border-border">
                              <td className="px-2 py-1 font-mono text-muted">{wacc}%</td>
                              {TERMINAL_GROWTH_RANGE.map((_, ci) => {
                                const val = sensitivity.table[ri][ci];
                                const cls = val == null || !price ? "text-muted"
                                  : val > price * 1.3 ? "text-positive font-semibold"
                                  : val > price ? "text-yellow-500 light:text-yellow-700"
                                  : "text-negative";
                                return (
                                  <td key={ci} className={`px-2 py-1 text-right font-mono ${cls}`}>
                                    {val == null ? "—" : formatCurrency(val, currency)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <Link href={`/research?symbol=${symbol}`} className="text-center text-sm text-brand hover:underline">
                Full research report for {symbol} →
              </Link>
            </div>
          </div>
        </Reveal>
      ) : null}
    </PageShell>
  );
}

function ScenarioCard({ label, value, price, currency, highlight, assumption }: {
  label: string; value: number | null; price: number | null;
  currency: string; highlight?: boolean; assumption: string;
}) {
  const upside = value != null && price != null && price > 0 ? ((value - price) / price) * 100 : null;
  const color = upside == null ? "" : upside >= 0 ? "text-positive" : "text-negative";
  return (
    <div className={`flex flex-col gap-1.5 bg-surface p-4 ${highlight ? "ring-inset ring-1 ring-brand/30" : ""}`}>
      <dt className={`text-label font-semibold uppercase tracking-widest ${
        label === "Bull" ? "text-positive" : label === "Bear" ? "text-negative" : "text-brand"
      }`}>{label}</dt>
      <dd className="font-mono text-xl font-bold">{formatCurrency(value, currency)}</dd>
      {upside != null ? (
        <dd className={`font-mono text-xs font-medium ${color}`}>
          {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
        </dd>
      ) : null}
      <dd className="mt-1 text-caption leading-snug text-muted">{assumption}</dd>
    </div>
  );
}
