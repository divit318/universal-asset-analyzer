"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Sparkles, FileText } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { TrustStrip } from "../primitives/trust-strip";
import { ParticleField } from "../primitives/particle-field";

/**
 * Demo — "try UAA before you download," with the payoff the reference leaves
 * out: analyzing renders a result preview (ticker header, composite score,
 * three metric tiles, a two-line verdict with a citation chip).
 *
 * No public analysis endpoint exists for a marketing page (the app's engines
 * are local), so the three suggested tickers resolve against pre-built static
 * results marked "Sample output"; free-text entry explains and points at Get
 * started. A skeleton matching the result card's dimensions covers the brief
 * simulated compute pause. Zero network calls.
 */
interface Sample {
  name: string;
  score: string;
  metrics: [string, string][];
  verdict: string;
  citation: string;
}

const SAMPLES: Record<string, Sample> = {
  NVDA: {
    name: "NVIDIA Corp.",
    score: "78",
    metrics: [
      ["P/E (TTM)", "48.3x"],
      ["Rev. growth YoY", "+62.1%"],
      ["Gross margin", "74.9%"],
    ],
    verdict:
      "Accelerated-compute demand anchors the growth story, with data-center revenue the swing factor. A rich multiple leaves little room for execution slips.",
    citation: "10-Q, Q2 FY25",
  },
  AAPL: {
    name: "Apple Inc.",
    score: "71",
    metrics: [
      ["P/E (TTM)", "34.6x"],
      ["Rev. growth YoY", "+4.9%"],
      ["Services mix", "28.2%"],
    ],
    verdict:
      "Services mix keeps margins durable while hardware growth normalizes. Capital returns remain a steady support under the valuation.",
    citation: "10-K, FY24",
  },
  MSFT: {
    name: "Microsoft Corp.",
    score: "75",
    metrics: [
      ["P/E (TTM)", "36.1x"],
      ["Rev. growth YoY", "+15.7%"],
      ["Cloud growth", "+29.0%"],
    ],
    verdict:
      "Cloud and AI monetization drive the thesis; operating leverage is intact. The premium multiple reflects consistency more than optionality.",
    citation: "10-Q, Q4 FY24",
  },
};

const SAMPLE_TICKERS = Object.keys(SAMPLES);

function ResultSkeleton() {
  return (
    <div className="mx-auto w-full max-w-xl rounded-panel border border-border bg-surface p-5 text-left" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="h-4 w-24 animate-pulse rounded-full bg-surface-3" />
          <span className="h-3 w-32 animate-pulse rounded-full bg-surface-3" />
        </div>
        <span className="h-12 w-12 animate-pulse rounded-full bg-surface-3" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-16 animate-pulse rounded-card bg-surface-3" />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        <span className="h-3 w-full animate-pulse rounded-full bg-surface-3" />
        <span className="h-3 w-4/5 animate-pulse rounded-full bg-surface-3" />
      </div>
    </div>
  );
}

function ResultCard({ ticker, sample }: { ticker: string; sample: Sample }) {
  return (
    <div className="mx-auto w-full max-w-xl rounded-panel border border-border bg-surface p-5 text-left shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-mk-body font-semibold tabular-nums text-foreground">{ticker}</p>
          <p className="text-mk-small text-muted">{sample.name}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-right text-micro uppercase tracking-wide text-muted">
            Composite
            <br />
            score
          </span>
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-brand/30 bg-brand/10 font-mono text-mk-body font-semibold tabular-nums text-brand">
            {sample.score}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {sample.metrics.map(([label, value]) => (
          <div key={label} className="rounded-card border border-hairline bg-surface-2/70 px-3 py-2.5">
            <p className="text-micro uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-0.5 font-mono text-mk-small font-semibold tabular-nums text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 flex gap-2 text-mk-small leading-relaxed text-foreground">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
        <span>{sample.verdict}</span>
      </p>
      <div className="mt-2.5 flex items-center gap-2 pl-6">
        <span className="flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-micro text-muted">
          <FileText className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
          {sample.citation}
        </span>
      </div>

      <p className="mt-4 border-t border-hairline pt-2.5 text-micro uppercase tracking-widest text-muted">
        Sample output, not live data
      </p>
    </div>
  );
}

export function Demo({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ticker: string; sample: Sample | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function run(raw: string) {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) return;
    if (timer.current) clearTimeout(timer.current);
    setPending(true);
    setResult(null);
    // A brief, honest "working" beat so the skeleton reads as compute.
    timer.current = setTimeout(() => {
      setPending(false);
      setResult({ ticker, sample: SAMPLES[ticker] ?? null });
    }, 550);
  }

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <Reveal delay={0}>
          <div className="relative overflow-hidden rounded-[20px] border border-border bg-surface/50 px-6 py-12 sm:px-12">
            <ParticleField variant="edge-pair" className="inset-0 h-full w-full" />

            <div className="relative flex flex-col items-center">
              <SectionHeader
                eyebrow="Try it"
                headingId={headingId}
                segments={[
                  { text: "Ask UAA about any stock,", block: true },
                  { text: "right here, right now.", tone: "accent", block: true },
                ]}
                lead="Type a ticker and see the kind of instant, structured read UAA produces."
              />

              {/* Search input with inset Analyze button. */}
              <form
                className="mt-mk-lead w-full max-w-xl"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(value);
                }}
              >
                <label htmlFor="demo-ticker" className="sr-only">
                  Research any ticker
                </label>
                <div className="flex items-center gap-2 rounded-full border border-brand/35 bg-surface-2 p-1.5 pl-4 shadow-glow-brand focus-within:ring-2 focus-within:ring-brand/40 [[data-reveal=shown]_&]:animate-mk-glow-pulse motion-reduce:animate-none">
                  <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
                  <input
                    id="demo-ticker"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Search any ticker…"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-10 w-full bg-transparent text-mk-body text-foreground outline-none placeholder:text-faint"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-background outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    Analyze
                  </button>
                </div>
              </form>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-mk-small text-muted">
                <span>Try:</span>
                {SAMPLE_TICKERS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setValue(t);
                      run(t);
                    }}
                    className="rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-mk-small font-medium tabular-nums text-muted outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Result preview — skeleton while "computing", then the card. */}
              <div aria-live="polite" className="mt-8 w-full empty:hidden">
                {pending && <ResultSkeleton />}
                {result &&
                  (result.sample ? (
                    <ResultCard ticker={result.ticker} sample={result.sample} />
                  ) : (
                    <p className="mx-auto max-w-xl rounded-panel border border-border bg-surface p-5 text-left text-mk-small text-muted">
                      This preview ships sample output for{" "}
                      <span className="font-mono tabular-nums text-foreground">{SAMPLE_TICKERS.join(", ")}</span> only.
                      For a real read on <span className="font-mono tabular-nums text-foreground">{result.ticker}</span>,
                      hit Get started: the full app researches any ticker, locally.
                    </p>
                  ))}
              </div>

              <TrustStrip className="mt-mk-lead" variant="bare" />
            </div>
          </div>
      </Reveal>
    </SectionShell>
  );
}
