/**
 * Model Validation — the former standalone /backtest page, now the desk's closing
 * section.
 *
 * Explicitly opt-in. The study fetches price history for every name the engine has
 * flagged, so it is dozens of network round trips and must never fire just because
 * someone scrolled this far. Until the user asks, this section explains what
 * validation does and shows the last cached run — which is more useful than a
 * spinner and strictly more honest than a stale number with no timestamp.
 *
 * Aggregation is `lib/backtest.ts`, unchanged and still unit-tested; this is only
 * the trigger and the presentation.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadingMark } from "@/app/_components/loading-mark";
import { Reveal } from "@/app/_components/reveal";
import { Button, StatTile } from "@/app/_components/ui";
import { signalTone, SIGNAL_LABEL } from "@/lib/engine-desk";
import type { BacktestResult } from "@/lib/backtest";
import { Derivation, Rule } from "./desk-primitives";

interface ValidationRun {
  result: BacktestResult;
  window: { from: string; to: string };
  cohortSize: number;
  priced: number;
  ranAt: string;
}

type Response =
  | ({ cached: true } & ValidationRun)
  | { cached: false }
  | { empty: true; reason: string }
  | { error: string };

const pct = (f: number | null | undefined, d = 2) =>
  f == null || Number.isNaN(f) ? "—" : `${f > 0 ? "+" : ""}${(f * 100).toFixed(d)}%`;
/** Unsigned, for prose where the direction is already carried by the sentence
 *  ("trailed bearish by 1.23%") — a signed "+1.23%" there reads as a gain. */
const mag = (f: number | null | undefined, d = 2) =>
  f == null || Number.isNaN(f) ? "—" : `${(Math.abs(f) * 100).toFixed(d)}%`;
const tone = (v: number | null | undefined) =>
  v == null ? "text-muted" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted";

export function ModelValidation() {
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [status, setStatus] = useState<"idle" | "loading-cache" | "running" | "error" | "empty">("loading-cache");
  const [message, setMessage] = useState<string | null>(null);

  // Only ever reads the cache on mount — cheap, and never triggers the study.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/engine/validation", { signal: controller.signal });
        const json = (await res.json()) as Response;
        if (controller.signal.aborted) return;
        if ("cached" in json && json.cached) {
          setRun(json);
          setStatus("idle");
        } else {
          setStatus("idle");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("idle");
      }
    })();
    return () => controller.abort();
  }, []);

  const runValidation = useCallback(async () => {
    setStatus("running");
    setMessage(null);
    try {
      const res = await fetch("/api/engine/validation", { method: "POST" });
      const json = (await res.json()) as Response;
      if ("error" in json) {
        setStatus("error");
        setMessage(json.error);
        return;
      }
      if ("empty" in json) {
        setStatus("empty");
        setMessage(json.reason);
        return;
      }
      if ("cached" in json && json.cached) {
        setRun(json);
        setStatus("idle");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Validation failed");
    }
  }, []);

  const running = status === "running";
  const r = run?.result;
  const edge = r?.longShortSpread ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* What this does, and the trigger. Never auto-runs. */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-card border border-border bg-surface-2/40 p-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <span className="text-sm font-semibold">Does the engine&apos;s own ranking actually pay?</span>
          <p className="text-xs leading-relaxed text-muted">
            Takes every actionable signal the engine has ever logged, joins each to the return the name
            actually delivered since that signal fired, and checks the only thing that matters: did
            more bullish calls earn more? Reports the long-short spread, per-tier returns, and whether
            the composite score is monotonic in realized return.
          </p>
          <p className="text-caption text-faint">
            Fetches price history for every flagged name, so it takes a while and runs only when you
            ask. Results are cached until you run it again.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button variant="primary" onClick={() => void runValidation()} disabled={running}>
            {running ? (
              <>
                <LoadingMark size={14} />
                Validating…
              </>
            ) : run ? (
              "Re-run validation"
            ) : (
              "Run validation"
            )}
          </Button>
          {run && (
            <span className="text-label text-faint">
              last run {new Date(run.ranAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {status === "error" && message && (
        <p className="rounded-card border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {message}
        </p>
      )}
      {status === "empty" && message && (
        <p className="rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-muted">{message}</p>
      )}

      {running && !run && (
        <div className="flex flex-col items-center gap-3 py-10">
          <LoadingMark size={28} />
          <span className="text-sm text-muted">Pricing every logged signal…</span>
        </div>
      )}

      {r && run && (
        <div className={`flex flex-col gap-5 ${running ? "opacity-60 transition-opacity" : ""}`}>
          {/* Verdict */}
          <Reveal index={0} className="flex flex-col gap-1">
            <p className="text-base font-semibold leading-relaxed">
              {edge == null ? (
                "Not enough long and short signals to compare — validation needs both sides."
              ) : edge > 0.005 ? (
                <>
                  Bullish signals beat bearish by <span className="text-positive">{mag(edge)}</span> — the
                  engine showed an edge over this window.
                </>
              ) : edge < -0.005 ? (
                <>
                  Bullish signals <span className="text-negative">trailed</span> bearish by {mag(edge)} — no
                  edge over this window.
                </>
              ) : (
                <>The engine&apos;s calls were roughly a coin-flip over this window ({pct(edge)} spread).</>
              )}
            </p>
            <p className="text-xs text-muted">
              {run.priced} of {run.cohortSize} actionable signals priced · {run.window.from} →{" "}
              {run.window.to} · short window, so treat as directional rather than conclusive.
            </p>
          </Reveal>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Long-short spread"
              tone={(edge ?? 0) >= 0 ? "positive" : "negative"}
              value={pct(edge)}
              sublabel="bullish − bearish"
            />
            <StatTile
              label="Score ↔ return"
              tone={(r.scoreReturnCorrelation ?? 0) >= 0 ? "positive" : "negative"}
              value={r.scoreReturnCorrelation == null ? "—" : r.scoreReturnCorrelation.toFixed(2)}
              sublabel="correlation"
            />
            <StatTile
              label="Hit rate"
              value={`${Math.round(r.overall.hitRate * 100)}%`}
              sublabel="directionally correct"
            />
            <StatTile label="Signals" value={String(r.evaluated)} sublabel="actionable, priced" />
          </div>

          {/* Per tier — the monotonicity check. */}
          <div className="flex flex-col gap-2">
            <Rule>By signal tier</Rule>
            <Derivation>
              If the engine works, average return should fall monotonically down this list.
            </Derivation>
            <div className="flex flex-col divide-y divide-border">
              <div className="grid grid-cols-4 gap-2 pb-1.5 text-label font-semibold uppercase tracking-widest text-muted/60">
                <span>Signal</span>
                <span className="text-right">Count</span>
                <span className="text-right">Avg return</span>
                <span className="text-right">Hit rate</span>
              </div>
              {r.byTier.map((t, i) => (
                <Reveal key={t.signal} index={i} className="grid grid-cols-4 gap-2 py-2 text-sm">
                  <span className={`font-medium ${signalTone(t.signal).text}`}>
                    {SIGNAL_LABEL[t.signal] ?? t.signal}
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted">{t.count}</span>
                  <span className={`text-right font-mono tabular-nums ${tone(t.avgReturn)}`}>
                    {pct(t.avgReturn)}
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted">
                    {Math.round(t.hitRate * 100)}%
                  </span>
                </Reveal>
              ))}
            </div>
          </div>

          {/* Score quintiles */}
          <div className="flex flex-col gap-2">
            <Rule>By composite quintile</Rule>
            <Derivation>Q5 is the highest-scoring fifth of signals. A rising staircase is the pass condition.</Derivation>
            <div className="flex flex-col gap-1.5">
              {r.byScoreQuintile.map((q, i) => (
                <Reveal key={q.quintile} index={i} className="flex items-center gap-3 text-xs">
                  <span className="w-7 shrink-0 font-mono text-muted">Q{q.quintile}</span>
                  <span className="w-24 shrink-0 font-mono tabular-nums text-faint">
                    {q.scoreRange[0].toFixed(2)} … {q.scoreRange[1].toFixed(2)}
                  </span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`absolute inset-y-0 left-0 animate-bar-fill rounded-full ${q.avgReturn >= 0 ? "bg-positive" : "bg-negative"}`}
                      style={{
                        ["--bar-value" as string]: `${Math.min(100, Math.abs(q.avgReturn) * 600 + 4)}%`,
                      } as React.CSSProperties}
                    />
                  </div>
                  <span className={`w-16 shrink-0 text-right font-mono tabular-nums ${tone(q.avgReturn)}`}>
                    {pct(q.avgReturn)}
                  </span>
                  <span className="w-10 shrink-0 text-right text-faint">n={q.count}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      )}

      {!run && !running && status !== "error" && status !== "empty" && (
        <p className="py-4 text-center text-sm text-faint">
          No validation run on file yet.
        </p>
      )}
    </div>
  );
}
