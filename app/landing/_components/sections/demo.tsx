"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Cpu, Check, TriangleAlert } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { RECOMMENDATION_TONE, RECOMMENDATION_ARC } from "@/lib/recommendation";
import { formatDate } from "@/lib/format";
import type { DemoAnalysis, DemoStageEvent } from "@/lib/landing-demo";
import fixtureJson from "./demo-fixture.json";

/**
 * Demo (Try It). The section loads with a COMPLETED analysis already visible:
 * a baked run of the real deterministic engines (regenerate with
 * `npx tsx scripts/landing-demo-fixture.ts`), as-of date shown honestly.
 * Chips and free-text run the engines LIVE through /api/landing/demo, which
 * streams each stage as it actually completes, with measured durations.
 *
 * No AI anywhere on this path. That is the point, and the section says so.
 * Every figure rendered here is genuine engine output; nothing is mocked.
 * The former particle band (the Well) is gone: the output region belongs to
 * the output.
 */

const FIXTURE = fixtureJson as unknown as DemoAnalysis & { fixtureElapsedMs: number };

interface Chip {
  symbol: string;
  display?: string;
  type: string;
}

/** Every chip is verified against the live engines, one per asset flavor,
 *  so "Universal" is demonstrated, not asserted. Indian ETFs (NIFTYBEES and
 *  friends) are deliberately absent: Yahoo carries no fund profile for them,
 *  and a chip that returns a degraded result is worse than no chip. Indian
 *  mutual funds DO work through Yahoo's 0P… codes, so one is here. */
const CHIPS: Chip[] = [
  { symbol: "RELIANCE.NS", type: "NSE equity" },
  { symbol: "AAPL", type: "US equity" },
  { symbol: "SPY", type: "ETF" },
  // Parag Parikh Flexi Cap (direct growth), Yahoo's 0P… mutual fund code.
  { symbol: "0P0000YWL1.BO", display: "PPFAS FLEXI CAP", type: "Indian MF" },
  { symbol: "GC=F", display: "GOLD", type: "Commodity" },
  { symbol: "BTC-USD", type: "Crypto" },
];

type RunState =
  | { status: "idle" }
  | { status: "running"; symbol: string; stages: DemoStageEvent[] }
  | { status: "error"; symbol: string; message: string };

interface LiveResult {
  analysis: DemoAnalysis;
  elapsedMs: number;
}

/* -------------------------------------------------------------------------- */
/* Result subcomponents                                                        */
/* -------------------------------------------------------------------------- */

function ScoreDial({ score, recommendation }: { score: number; recommendation: DemoAnalysis["recommendation"] }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`Composite score ${score} out of 100`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="4" className="stroke-surface-3" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          className={`${RECOMMENDATION_ARC[recommendation]} stroke-current`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-semibold tabular-nums text-foreground">
        {score}
      </span>
    </div>
  );
}

function BucketCard({ bucket, showFactors }: { bucket: DemoAnalysis["buckets"][number]; showFactors: boolean }) {
  return (
    <div className="rounded-card border border-hairline bg-surface-2/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-mk-small font-semibold text-foreground">{bucket.name}</p>
        <p className="font-mono text-mk-small tabular-nums text-muted">
          <span className="text-foreground">{bucket.points}</span>/{bucket.max}
        </p>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <div className="h-full rounded-full bg-brand/70" style={{ width: `${(bucket.points / bucket.max) * 100}%` }} />
      </div>
      <ul className={`mt-2.5 flex-col gap-1.5 ${showFactors ? "flex" : "hidden sm:flex"}`}>
        {bucket.factors.map((f) => (
          <li key={f.label} className="flex items-baseline justify-between gap-2 text-micro">
            <span className="text-muted">{f.label}</span>
            <span className="whitespace-nowrap text-right font-mono tabular-nums text-muted">
              <span className="text-muted">{f.detail}</span> · {f.points}/{f.max}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stagger only applies to results arriving from a live run; the pre-loaded
 *  fixture renders at rest, so a mid-scroll visitor never sees an empty box. */
function enterStyle(live: boolean, order: number): React.CSSProperties | undefined {
  return live ? { animationDelay: `${order * 90}ms` } : undefined;
}

function ResultCard({ analysis, elapsedMs, live }: { analysis: DemoAnalysis; elapsedMs: number; live: boolean }) {
  const [showFactors, setShowFactors] = useState(false);
  const enter = live ? "motion-safe:animate-mk-demo-enter" : "";
  return (
    <div className="rounded-panel border border-border bg-surface p-4 text-left shadow-card sm:p-6">
      {/* Masthead: identity on the left, verdict on the right. */}
      <div className={enter} style={enterStyle(live, 0)}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="font-mono text-xl font-semibold tabular-nums text-foreground">{analysis.symbol}</p>
              <span className="rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-micro uppercase tracking-wide text-muted">
                {analysis.assetClassLabel}
              </span>
            </div>
            <p className="mt-0.5 truncate text-mk-small text-muted">{analysis.name}</p>
            <p className="mt-1 font-mono text-mk-small tabular-nums text-foreground">
              {analysis.priceDisplay}
              <span className="ml-2 text-micro text-muted">
                last trade {analysis.priceAsOf ? formatDate(analysis.priceAsOf) : "n/a"}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span
                className={`inline-block rounded-full border px-2.5 py-0.5 text-mk-small font-semibold ${RECOMMENDATION_TONE[analysis.recommendation]}`}
              >
                {analysis.recommendationLabel}
              </span>
              <p className="mt-1 text-micro uppercase tracking-wide text-muted">
                Composite score
                {analysis.confidence != null && <> · conf. {analysis.confidence}/100</>}
              </p>
            </div>
            <ScoreDial score={analysis.composite} recommendation={analysis.recommendation} />
          </div>
        </div>

        {/* Blended decision signals (equity engine only). */}
        {analysis.signals.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3 sm:grid-cols-5">
            {analysis.signals.map((s) => (
              <div key={s.label}>
                <div className="flex items-baseline justify-between gap-1">
                  <p className="truncate text-micro uppercase tracking-wide text-muted">{s.label}</p>
                  <p className="font-mono text-micro tabular-nums text-foreground">{s.value}</p>
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                  <div className="h-full rounded-full bg-brand/60" style={{ width: `${s.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Key figures: every value labelled, every value sourced. */}
      <div className={`mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 ${enter}`} style={enterStyle(live, 1)}>
        {analysis.metrics.map((m) => (
          <div key={m.label} className="rounded-card border border-hairline bg-surface-2/60 px-2.5 py-2">
            <p className="text-micro uppercase tracking-wide text-muted">{m.label}</p>
            <p className="mt-0.5 font-mono text-mk-small font-semibold tabular-nums text-foreground">{m.value}</p>
            <p className="mt-0.5 truncate text-micro text-muted" title={m.source}>
              {m.source}
            </p>
          </div>
        ))}
      </div>

      {/* Score attribution: the buckets, factor by factor: the provenance
          the rest of the page keeps promising. */}
      <div className={`mt-4 ${enter}`} style={enterStyle(live, 2)}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-micro uppercase tracking-widest text-muted">Score attribution</p>
          <button
            type="button"
            onClick={() => setShowFactors((v) => !v)}
            className="text-micro text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40 sm:hidden"
          >
            {showFactors ? "Hide factor detail" : "Show factor detail"}
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {analysis.buckets.map((b) => (
            <BucketCard key={b.name} bucket={b} showFactors={showFactors} />
          ))}
        </div>
      </div>

      {/* Provenance footer: what computed this, from what, and when. */}
      <div className={`mt-4 border-t border-hairline pt-3 ${enter}`} style={enterStyle(live, 3)}>
        <p className="flex items-start gap-2 text-mk-small text-foreground">
          <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          <span>
            Computed, not generated: no AI touched these numbers. This is UAA&apos;s deterministic engine layer;
            the model only ever explains figures like these, and only through your own AI provider.
          </span>
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-micro text-muted">
          {analysis.sources.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
        <p className="mt-2 pl-6 font-mono text-micro tabular-nums text-muted">
          {live
            ? `Engines ran live in ${(elapsedMs / 1000).toFixed(2)}s`
            : `Engines ran ${formatDate(analysis.computedAt)} in ${(elapsedMs / 1000).toFixed(2)}s`}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export function Demo({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const [value, setValue] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [result, setResult] = useState<LiveResult | null>(null);
  const [analyzeToken, setAnalyzeToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  useEffect(() => () => abortRef.current?.abort(), []);

  const analysis = result?.analysis ?? FIXTURE;
  const elapsedMs = result?.elapsedMs ?? FIXTURE.fixtureElapsedMs;
  const running = run.status === "running";

  async function analyze(raw: string) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Lock the region's height so the swap can never collapse the page.
    if (resultRef.current) setMinHeight((h) => Math.max(h ?? 0, resultRef.current!.offsetHeight));
    setAnalyzeToken((n) => n + 1);
    setRun({ status: "running", symbol, stages: [] });
    try {
      const res = await fetch(`/api/landing/demo?symbol=${encodeURIComponent(symbol)}`, {
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (chunk) buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "stage") {
            setRun((r) => (r.status === "running" ? { ...r, stages: [...r.stages, event] } : r));
          } else if (event.type === "result") {
            setResult({ analysis: event.analysis, elapsedMs: event.elapsedMs });
            setRun({ status: "idle" });
          } else if (event.type === "error") {
            setRun({ status: "error", symbol, message: event.message });
          }
        }
        if (done) break;
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setRun({
        status: "error",
        symbol,
        message: "The request didn't reach the engines. Check your connection and try again.",
      });
    }
  }

  const nextStageLabel =
    run.status !== "running"
      ? null
      : run.stages.length === 0
        ? "Resolving quote & asset class"
        : run.stages.length === 1
          ? "Fetching market data"
          : "Scoring";

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <div className="flex flex-col items-center">
        <SectionHeader
          eyebrow="Try it"
          headingId={headingId}
          segments={[
            { text: "Equities, funds, gold, crypto.", block: true },
            { text: "Analyzed live, right here.", tone: "accent", block: true },
          ]}
          lead="This is the product running, not a mockup. The same deterministic engines that power the app score live market data on this page. Run a sample, or type your own symbol."
        />

        {/* Search input with inset Analyze button. */}
        <Reveal delay={280} className="w-full max-w-xl">
        <form
          className="mt-mk-lead w-full"
          onSubmit={(e) => {
            e.preventDefault();
            analyze(value);
          }}
        >
          <label htmlFor="demo-ticker" className="sr-only">
            Analyze any equity, fund, crypto, commodity, or currency symbol
          </label>
          <div
            key={analyzeToken}
            className={`flex items-center gap-2 rounded-full border border-brand/35 bg-surface-2 p-1.5 pl-4 shadow-glow-brand focus-within:ring-2 focus-within:ring-brand/40 motion-reduce:animate-none ${
              analyzeToken > 0 ? "animate-mk-analyze-flash" : "[[data-reveal=shown]_&]:animate-mk-glow-pulse"
            }`}
          >
            <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
            <input
              id="demo-ticker"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Any symbol: INFY.NS, QQQ, ETH-USD…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-10 w-full bg-transparent text-mk-body text-foreground outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!value.trim() || running}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-background outline-none transition-[background-color,transform] duration-[120ms] hover:bg-brand-strong active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Cpu className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Analyze
            </button>
          </div>
        </form>

        {/* Verified samples, one per asset flavor. */}
        <div className="mt-mk-group flex flex-wrap items-center justify-center gap-2">
          {CHIPS.map((chip) => (
            <button
              key={chip.symbol}
              type="button"
              disabled={running}
              onClick={() => {
                setValue(chip.symbol);
                analyze(chip.symbol);
              }}
              className="group flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
            >
              <span className="font-mono text-mk-small font-medium tabular-nums text-muted transition-colors group-hover:text-foreground">
                {chip.display ?? chip.symbol}
              </span>
              <span className="text-micro uppercase tracking-wide text-muted">{chip.type}</span>
            </button>
          ))}
        </div>
        </Reveal>

        {/* Output region: a real result is ALWAYS visible here. */}
        <div className="mt-mk-lead w-full max-w-4xl">
          {/* Live engine progress: real stages, measured as they complete. */}
          <div aria-live="polite">
            {run.status === "running" && (
              <div className="mb-3 rounded-card border border-brand/25 bg-surface-2/70 px-4 py-2.5">
                <p className="text-micro uppercase tracking-widest text-muted">
                  Running engines on <span className="font-mono text-foreground">{run.symbol}</span>
                </p>
                <ul className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {run.stages.map((s) => (
                    <li key={s.id} className="flex items-center gap-1.5 text-mk-small text-foreground">
                      <Check className="h-3.5 w-3.5 text-positive" strokeWidth={2.5} aria-hidden="true" />
                      {s.label}
                      <span className="font-mono text-micro tabular-nums text-muted">
                        {s.ms < 1 ? "<1ms" : `${s.ms}ms`}
                      </span>
                    </li>
                  ))}
                  {nextStageLabel && (
                    <li className="text-mk-small text-muted motion-safe:animate-pulse">{nextStageLabel}…</li>
                  )}
                </ul>
              </div>
            )}
            {run.status === "error" && (
              <div className="mb-3 flex items-start gap-2.5 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-left">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={2} aria-hidden="true" />
                <div>
                  <p className="text-mk-small text-foreground">{run.message}</p>
                  <p className="mt-1 text-micro text-muted">
                    The last completed result stays below. The samples above always work.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div
            ref={resultRef}
            style={minHeight ? { minHeight } : undefined}
            className={`transition-opacity duration-200 motion-reduce:transition-none ${running ? "opacity-50" : "opacity-100"}`}
          >
            <ResultCard
              key={analysis.symbol + analysis.computedAt}
              analysis={analysis}
              elapsedMs={elapsedMs}
              live={result !== null}
            />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
