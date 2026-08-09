"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Sparkles, FileText } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { setInkParam } from "../ink/engine";

/**
 * Demo — The Well (ink/movements/well.ts): a shallow fluid pool in a 120px
 * ink band directly beneath the search input, the one formation on the
 * page constrained to a 1D height field, and the only one driven by the
 * keyboard:
 *   - every keystroke drops a ripple at the caret's horizontal position;
 *     ripples propagate, reflect off the ends, and interfere
 *   - hovering a ticker chip settles the surface into that ticker's
 *     sparkline profile
 *   - Analyze drops the surface sharply; it rebounds once (plus a one-shot
 *     scale-and-glow on the input itself)
 *
 * The payoff the reference leaves out: analyzing renders a result preview
 * (ticker header, composite score, three metric tiles, a two-line verdict
 * with a citation chip).
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const rippleToken = useRef(0);
  const [analyzeToken, setAnalyzeToken] = useState(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Drop a ripple in the Well at the caret's horizontal position. */
  function dropRipple() {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input) return;
    let x = input.getBoundingClientRect().left + 8;
    if (mirror) {
      mirror.textContent = input.value.slice(0, input.selectionStart ?? input.value.length);
      x += mirror.offsetWidth;
    }
    setInkParam("well.ripple", { x, t: ++rippleToken.current });
  }

  function run(raw: string) {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) return;
    if (timer.current) clearTimeout(timer.current);
    setPending(true);
    setResult(null);
    setInkParam("well.ticker", null);
    setInkParam("well.analyze", ++rippleToken.current); // the surface drops
    setAnalyzeToken((n) => n + 1); // one-shot scale-and-glow on the input
    // A brief, honest "working" beat so the skeleton reads as compute.
    timer.current = setTimeout(() => {
      setPending(false);
      setResult({ ticker, sample: SAMPLES[ticker] ?? null });
    }, 550);
  }

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <Reveal delay={0}>
          <div className="relative overflow-hidden rounded-[20px] border border-border bg-surface/30 px-6 py-12 sm:px-12">

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
                <div className="relative">
                  {/* A hidden mirror measures the caret's x for the ripple. */}
                  <span
                    ref={mirrorRef}
                    aria-hidden="true"
                    className="pointer-events-none invisible absolute left-0 top-0 whitespace-pre text-mk-body"
                  />
                <div
                  key={analyzeToken}
                  className={`flex items-center gap-2 rounded-full border border-brand/35 bg-surface-2 p-1.5 pl-4 shadow-glow-brand focus-within:ring-2 focus-within:ring-brand/40 motion-reduce:animate-none ${
                    analyzeToken > 0 ? "animate-mk-analyze-flash" : "[[data-reveal=shown]_&]:animate-mk-glow-pulse"
                  }`}
                >
                  <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
                  <input
                    ref={inputRef}
                    id="demo-ticker"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={() => dropRipple()}
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
                </div>
              </form>

              {/* The Well: the fluid ink band, directly beneath the input. */}
              <div aria-hidden="true" data-ink-target="demo-well" className="mt-5 h-[120px] w-full max-w-3xl" />

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
                    onMouseEnter={() => setInkParam("well.ticker", t)}
                    onMouseLeave={() => setInkParam("well.ticker", null)}
                    onFocus={() => setInkParam("well.ticker", t)}
                    onBlur={() => setInkParam("well.ticker", null)}
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
            </div>
          </div>
      </Reveal>
    </SectionShell>
  );
}
