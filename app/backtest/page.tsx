"use client";

import { useEffect, useState } from "react";
import { PageShell, PageHeader, StatTile, Card, SectionHeader } from "@/app/_components/ui";
import type { BacktestResult } from "@/lib/backtest";

interface BacktestResponse {
  result: BacktestResult;
  window: { from: string; to: string };
  cohortSize: number;
  priced: number;
  empty?: boolean;
  reason?: string;
  error?: string;
}

const pct = (f: number | null | undefined, d = 2) =>
  f == null || Number.isNaN(f) ? "—" : `${f > 0 ? "+" : ""}${(f * 100).toFixed(d)}%`;
const tone = (v: number | null | undefined) =>
  v == null ? "text-muted" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted";

const TIER_TONE: Record<string, string> = {
  STRONG_BUY: "text-positive",
  BUY: "text-positive/80",
  HOLD: "text-muted",
  SELL: "text-negative/80",
  STRONG_SELL: "text-negative",
};

export default function BacktestPage() {
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    void fetch("/api/backtest")
      .then(async (r) => {
        const json = (await r.json()) as BacktestResponse;
        if (!alive) return;
        setData(json);
        setState(json.error ? "error" : "ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  const r = data?.result;
  const edge = r?.longShortSpread ?? null;

  return (
    <PageShell gap="gap-6">
      <PageHeader
        title="Signal Backtest"
        description="Does the Quant Engine's scorecard actually predict returns? Every actionable signal, joined to what the stock did next."
      />

      {state === "loading" && <div className="h-40 animate-pulse rounded-card border border-border bg-surface" />}
      {state === "error" && (
        <div className="rounded-card border border-negative/40 bg-negative/10 px-5 py-4 text-sm text-negative">
          {data?.error ?? "Backtest failed. Ensure the quant engine has produced a signal log."}
        </div>
      )}

      {state === "ready" && r && (
        <>
          {/* Verdict */}
          <Card>
            <div className="flex flex-col gap-1">
              <span className="text-micro font-semibold uppercase tracking-widest text-faint">Verdict</span>
              <p className="text-lg font-semibold">
                {edge == null ? (
                  "Not enough long and short signals to compare."
                ) : edge > 0.005 ? (
                  <>
                    Bullish signals beat bearish by <span className="text-positive">{pct(edge)}</span> — the engine showed
                    an edge over this window.
                  </>
                ) : edge < -0.005 ? (
                  <>
                    Bullish signals <span className="text-negative">trailed</span> bearish by {pct(Math.abs(edge))} — no
                    edge over this window.
                  </>
                ) : (
                  <>The engine&apos;s signals were roughly a coin-flip over this window ({pct(edge)} spread).</>
                )}
              </p>
              <p className="text-xs text-muted">
                {data!.priced} of {data!.cohortSize} actionable signals priced · {data!.window.from} → {data!.window.to} ·
                short window — treat as directional, not conclusive.
              </p>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Long-Short Spread" tone={(edge ?? 0) >= 0 ? "positive" : "negative"} value={pct(edge)} sublabel="bullish − bearish" />
            <StatTile
              label="Score ↔ Return"
              tone={(r.scoreReturnCorrelation ?? 0) >= 0 ? "positive" : "negative"}
              value={r.scoreReturnCorrelation == null ? "—" : r.scoreReturnCorrelation.toFixed(2)}
              sublabel="correlation"
            />
            <StatTile label="Hit Rate" value={`${Math.round(r.overall.hitRate * 100)}%`} sublabel="directionally correct" />
            <StatTile label="Signals" value={String(r.evaluated)} sublabel="actionable, priced" />
          </div>

          {/* By tier */}
          <div className="flex flex-col gap-2">
            <SectionHeader label="By signal tier" description="Did stronger calls earn more?" />
            <Card>
              <div className="flex flex-col divide-y divide-border">
                <div className="grid grid-cols-4 gap-2 pb-2 text-micro font-semibold uppercase tracking-widest text-faint">
                  <span>Signal</span>
                  <span className="text-right">Count</span>
                  <span className="text-right">Avg Return</span>
                  <span className="text-right">Hit Rate</span>
                </div>
                {r.byTier.map((t) => (
                  <div key={t.signal} className="grid grid-cols-4 gap-2 py-2 text-sm">
                    <span className={`font-medium ${TIER_TONE[t.signal] ?? "text-foreground"}`}>
                      {t.signal.replace("_", " ")}
                    </span>
                    <span className="text-right font-mono text-muted">{t.count}</span>
                    <span className={`text-right font-mono ${tone(t.avgReturn)}`}>{pct(t.avgReturn)}</span>
                    <span className="text-right font-mono text-muted">{Math.round(t.hitRate * 100)}%</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* By score quintile */}
          <div className="flex flex-col gap-2">
            <SectionHeader label="By score quintile" description="Return by composite-score bucket (Q5 = highest score)" />
            <Card>
              <div className="flex flex-col gap-2">
                {r.byScoreQuintile.map((q) => (
                  <div key={q.quintile} className="flex items-center gap-3 text-xs">
                    <span className="w-8 shrink-0 font-mono text-muted">Q{q.quintile}</span>
                    <span className="w-28 shrink-0 font-mono text-faint">
                      {q.scoreRange[0].toFixed(2)} … {q.scoreRange[1].toFixed(2)}
                    </span>
                    <div className="flex h-2 flex-1 items-center">
                      <div
                        className={`h-full rounded-full ${q.avgReturn >= 0 ? "bg-positive" : "bg-negative"}`}
                        style={{ width: `${Math.min(100, Math.abs(q.avgReturn) * 100 * 6 + 4)}%` }}
                      />
                    </div>
                    <span className={`w-16 shrink-0 text-right font-mono ${tone(q.avgReturn)}`}>{pct(q.avgReturn)}</span>
                    <span className="w-10 shrink-0 text-right text-faint">n={q.count}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}
