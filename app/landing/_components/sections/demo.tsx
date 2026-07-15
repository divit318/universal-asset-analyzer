"use client";

import { useState } from "react";
import { Search, Sparkles, Check } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Interactive Demo — "try UAA before you download."
 *
 * Reconciliation §F: this runs entirely on canned, local data — no Ollama, no
 * network, no runPrompt. A public marketing page has no model to call, and the
 * PDFs explicitly permit canned responses. Numbers are ILLUSTRATIVE and labelled
 * as such, so nothing here can be mistaken for a live quote.
 *
 * Milestone 3 keeps the interaction simple: submit reveals the canned analysis.
 * The streaming/typing choreography is Milestone 5.
 */
interface Sample {
  name: string;
  price: string;
  changePct: string;
  positive: boolean;
  pe: string;
  summary: string;
}

const SAMPLES: Record<string, Sample> = {
  NVDA: {
    name: "NVIDIA Corp.",
    price: "$126.40",
    changePct: "+2.1%",
    positive: true,
    pe: "48.3",
    summary:
      "Accelerated-compute demand anchors the growth story, with data-center revenue the swing factor. Rich multiple leaves little room for execution slips.",
  },
  AAPL: {
    name: "Apple Inc.",
    price: "$228.10",
    changePct: "-0.4%",
    positive: false,
    pe: "34.6",
    summary:
      "Services mix keeps margins durable while hardware growth normalizes. Capital returns remain a steady support under the valuation.",
  },
  MSFT: {
    name: "Microsoft Corp.",
    price: "$438.20",
    changePct: "+0.9%",
    positive: true,
    pe: "36.1",
    summary:
      "Cloud and AI monetization drive the thesis; operating leverage is intact. Premium multiple reflects consistency more than optionality.",
  },
};

const SAMPLE_TICKERS = Object.keys(SAMPLES);
const STEPS = ["Fetched market data", "Parsed latest filing", "Ran valuation", "Drafted AI summary"];

export function Demo({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  const [value, setValue] = useState("");
  const [result, setResult] = useState<{ ticker: string; sample: Sample | null } | null>(null);

  function run(raw: string) {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) return;
    setResult({ ticker, sample: SAMPLES[ticker] ?? null });
  }

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <Reveal className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-6 py-24 text-center">
        <div className="flex max-w-2xl flex-col items-center gap-4">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Ask UAA about any stock — no signup.
          </h2>
          <p className="text-pretty text-base leading-relaxed text-muted">
            Type a ticker and see the kind of instant, structured read UAA produces.
          </p>
        </div>

        {/* Input + submit. No backend — run() resolves against local samples. */}
        <form
          className="flex w-full max-w-xl flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(value);
          }}
        >
          <label htmlFor="demo-ticker" className="sr-only">
            Research any ticker
          </label>
          <div className="flex flex-1 items-center gap-2 rounded-control border border-border bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-brand/40">
            <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} />
            <input
              id="demo-ticker"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Research any ticker…"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-control bg-brand px-5 text-sm font-semibold text-background outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Sparkles className="h-4 w-4" strokeWidth={2} />
            Analyze
          </button>
        </form>

        {/* Sample tickers — one click fills and runs. */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-caption text-faint">
          <span>Try:</span>
          {SAMPLE_TICKERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setValue(t);
                run(t);
              }}
              className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-caption font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              {t}
            </button>
          ))}
        </div>

        {/* Result — announced politely to assistive tech. */}
        <div aria-live="polite" className="w-full">
          {result && (
            <div className="mx-auto max-w-xl overflow-hidden rounded-panel border border-border bg-surface text-left shadow-card">
              <ul className="flex flex-col gap-1.5 border-b border-border p-4">
                {STEPS.map((s) => (
                  <li key={s} className="flex items-center gap-2 text-sm text-muted">
                    <Check className="h-4 w-4 shrink-0 text-positive" strokeWidth={2.5} />
                    {s}
                  </li>
                ))}
              </ul>

              {result.sample ? (
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-foreground">{result.ticker}</span>
                      <span className="text-caption text-muted">{result.sample.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="nums text-sm font-semibold text-foreground">{result.sample.price}</div>
                      <div className={`nums text-caption font-medium ${result.sample.positive ? "text-positive" : "text-negative"}`}>
                        {result.sample.changePct}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-caption text-muted">
                    <span className="rounded-full bg-surface-3 px-2 py-0.5">P/E {result.sample.pe}</span>
                  </div>
                  <p className="flex gap-2 text-sm leading-relaxed text-foreground">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} />
                    <span>{result.sample.summary}</span>
                  </p>
                </div>
              ) : (
                <div className="p-4 text-sm text-muted">
                  No sample loaded for <span className="font-mono text-foreground">{result.ticker}</span>. Try{" "}
                  {SAMPLE_TICKERS.join(", ")} — or open the full app to research it for real.
                </div>
              )}

              <p className="border-t border-border bg-surface-2 px-4 py-2 text-micro uppercase tracking-widest text-faint">
                Illustrative sample — not live data
              </p>
            </div>
          )}
        </div>
      </Reveal>
    </section>
  );
}
