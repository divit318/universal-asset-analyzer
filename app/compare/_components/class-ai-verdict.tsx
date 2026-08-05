"use client";

import { useEffect, useRef, useState } from "react";
import { GroundingBadge } from "@/app/_components/grounding-badge";
import { AiBadge } from "@/app/_components/ai-badge";
import type { AssetClassId } from "@/lib/assets/types";
import type { ClassCompareEntry } from "@/lib/compare/types";
import type { ClassComparisonResult } from "@/lib/compare/class-ai-compare";
import type { RankedAsset } from "@/lib/ai-compare";
import { useHoverHandlers, useSymbolEmphasis, emphasisClassName } from "./hover-symbol-context";
import { Skeleton } from "@/app/_components/ui";

/** One ranking card — part of cross-component focus mode, mirrors app/compare/page.tsx's RankedVerdictRow. */
function RankedVerdictRow({ r, color }: { r: RankedAsset; color: string | undefined }) {
  const emphasis = useSymbolEmphasis(r.symbol);
  const hoverHandlers = useHoverHandlers(r.symbol);

  return (
    <div
      {...hoverHandlers}
      className={`rounded-lg border p-3 ${emphasis === "active" ? "border-brand/40 bg-surface-2" : "border-border/60 bg-surface"} ${emphasisClassName(emphasis)}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-label font-semibold text-muted">
          {r.rank}
        </span>
        <span className="font-mono text-sm font-semibold" style={{ color }}>{r.symbol}</span>
        {r.bestFor && <span className="text-label text-muted">— best for {r.bestFor}</span>}
      </div>
      {r.thesis && <p className="mt-1.5 text-sm leading-6 text-foreground">{r.thesis}</p>}
      {(r.strengths.length > 0 || r.weaknesses.length > 0) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {r.strengths.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {r.strengths.map((s, i) => (
                <li key={i} className="text-xs leading-5 text-positive">+ {s}</li>
              ))}
            </ul>
          )}
          {r.weaknesses.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {r.weaknesses.map((w, i) => (
                <li key={i} className="text-xs leading-5 text-negative">− {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The AI ranked verdict for the non-equity Compare framework — same UI
 * language as equity's Ranked Verdict block (app/compare/page.tsx), but
 * self-contained: fetches from POST /api/compare/class itself and
 * auto-triggers once ≥2 valid entries are present, rather than lifting AI
 * state up into the parent view. Every asset ranked with its own thesis —
 * never a forced single winner — plus the class-specific key questions
 * (lib/compare/class-ai-compare.ts KEY_QUESTIONS) instead of generic
 * stock-picking language.
 */
export function ClassAiVerdict({
  assetClass,
  entries,
  colors,
}: {
  assetClass: AssetClassId;
  entries: ClassCompareEntry[];
  colors: readonly string[];
}) {
  const [result, setResult] = useState<ClassComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTriggered = useRef<string>("");

  const symbols = entries.map((e) => e.symbol);
  const colorOf = (symbol: string) => colors[entries.findIndex((e) => e.symbol === symbol) % colors.length];

  async function fetchVerdict() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/compare/class", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetClass, symbols }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
      setResult(json as ClassComparisonResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI analysis failed");
    } finally {
      setLoading(false);
    }
  }

  // Reset + auto-trigger whenever the compared symbol set changes. Deferred
  // to a microtask (matching compare-chart.tsx's history-fetch effect) so no
  // setState fires synchronously within the effect body itself.
  useEffect(() => {
    const key = [...symbols].sort().join("-");
    if (autoTriggered.current === key) return;
    autoTriggered.current = key;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setResult(null);
      setError(null);
      if (symbols.length >= 2) void fetchVerdict();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Ranked Verdict</h2>
            <AiBadge />
          </div>
          <p className="text-xs text-muted">{symbols.join(" vs ")} — every pick ranked with its own thesis</p>
        </div>
        <button
          onClick={() => void fetchVerdict()}
          disabled={loading}
          className="rounded-lg bg-brand-strong px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Analyzing…" : result ? "Re-analyze" : "Run analysis"}
        </button>
      </div>

      {loading && (
        <div className="mt-4 flex flex-col gap-2">
          {[80, 60, 90, 50].map((w) => (
            <Skeleton key={w} height="h-2.5" width="" radius="rounded-full" style={{ width: `${w}%` }} />
          ))}
          <p className="mt-1 text-xs text-muted">Running AI analysis — typically well under a minute…</p>
        </div>
      )}

      {!loading && error && (
        <p className="mt-4 border-t border-border pt-4 text-sm text-negative">{error}</p>
      )}

      {!loading && result && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {result.noClearWinner && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-warning">
                Too close to call
              </span>
            )}
            <span className="rounded-full border border-border px-2 py-0.5 text-label text-muted">
              {result.confidenceScore}% confidence
            </span>
          </div>

          {result.executiveSummary && (
            <p className="text-sm leading-6 text-foreground">{result.executiveSummary}</p>
          )}

          {result.rankings.length > 0 && (
            <div className="flex flex-col gap-2">
              {result.rankings.map((r) => (
                <RankedVerdictRow key={r.symbol} r={r} color={colorOf(r.symbol)} />
              ))}
            </div>
          )}

          {result.keyQuestions.length > 0 && (
            <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
              {result.keyQuestions.map((q) => (
                q.answer && (
                  <div key={q.label}>
                    <p className="text-label font-semibold uppercase tracking-widest text-muted/60">{q.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">{q.answer}</p>
                  </div>
                )
              ))}
            </div>
          )}

          {result.tradeoffSummary && (
            <p className="text-sm leading-6 text-muted">
              <span className="font-semibold text-foreground">
                {result.noClearWinner ? "Depends on your objective: " : "Why this ranking: "}
              </span>
              {result.tradeoffSummary}
            </p>
          )}
          {result.conditionsForChange && (
            <p className="text-xs leading-5 text-muted">
              <span className="font-semibold text-foreground">Would change if: </span>
              {result.conditionsForChange}
            </p>
          )}
          {result.grounding && <GroundingBadge grounding={result.grounding} />}
        </div>
      )}

      {!loading && !result && !error && (
        <p className="mt-3 text-xs text-muted">Analyzing {symbols.join(" vs ")} — ranking every pick with its own thesis…</p>
      )}
    </div>
  );
}
