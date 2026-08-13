"use client";

import { useEffect, useRef, useState, Fragment } from "react";
import { Sparkles, ArrowUp, Calculator, FileText } from "lucide-react";
import { useMockupEntry } from "../motion/mockup";
import { PANEL_DATA } from "./panel-data";

/**
 * AI Research Assistant panel: a REAL captured exchange demonstrating the
 * product's division of labour. The engine strip at the top shows the
 * valuation the deterministic engine computed (the same case as the
 * Valuation panel above); the question asks the assistant to explain it;
 * the response is a real completion from the shipped provider chain
 * (captured by scripts/landing-panel-data.ts, model id recorded), gated so
 * it may only quote the engine's own figures. AI explains; it never
 * computes.
 *
 * Choreographed ONCE on first viewport entry: the engine strip and user
 * bubble land first, a three-dot thinking beat for 600ms, the response
 * fades in, then the source chips stagger in as the punchline.
 * No-JS / reduced motion: the complete exchange renders settled.
 */
const A = PANEL_DATA.assistant;

/** Bold every figure so the engine-sourced numbers read as data, not prose. */
function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\$[\d,.]+[BMT]?|\d+(?:\.\d+)?%|FY\d{4}(?:→FY\d{4})?|\d+\.\d+B)/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-mono text-[0.95em] font-semibold tabular-nums text-foreground">
            {part}
          </b>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/* Sequence stages: user bubble -> thinking beat -> answer -> sources. */
type Stage = "done" | "thinking" | "answer";

export function AiAssistantPanel() {
  const { ref, phase } = useMockupEntry();
  const [stage, setStage] = useState<Stage>("done"); // SSR final state
  const [sourcesIn, setSourcesIn] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (phase === "armed") {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- arming the
         entrance after the SSR final state has painted. */
      setStage("thinking");
      setSourcesIn(false);
      return;
    }
    if (phase !== "play") return;
    const t = timers.current;
    t.push(setTimeout(() => setStage("answer"), 700));
    t.push(
      setTimeout(() => {
        setStage("done");
        setSourcesIn(true);
      }, 1500),
    );
    return () => t.forEach(clearTimeout);
  }, [phase]);

  if (A == null) return null;

  return (
    <div ref={ref} data-mock={phase} className="flex h-full flex-col p-4 text-left">
      {/* The engine's computed figure, visible in-panel so every number in
          the response below is traceable to it. */}
      <div className="flex items-center gap-2 rounded-card border border-hairline bg-surface-2/60 px-3 py-2">
        <Calculator className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={1.75} />
        <span className="truncate text-micro text-muted">
          Engine output · {A.context.name} ({A.context.symbol}) fair value{" "}
          <b className="font-mono font-semibold tabular-nums text-foreground">{A.context.fairValue}</b>{" "}
          <b className={`font-mono font-semibold tabular-nums ${A.context.upsidePositive ? "text-positive" : "text-negative"}`}>
            ({A.context.upside})
          </b>{" "}
          vs spot <b className="font-mono font-semibold tabular-nums text-foreground">{A.context.spot}</b>
        </span>
      </div>

      {/* User message. */}
      <div className="mt-2.5 flex justify-end">
        <p className="rounded-panel rounded-br-sm bg-surface-3 px-3.5 py-2 text-caption text-foreground transition-opacity duration-300 [[data-mock=armed]_&]:opacity-0">
          {A.question}
        </p>
      </div>

      {/* Assistant response: explains the engine's number, never its own. */}
      <div className="mt-2.5 flex min-h-0 flex-1 gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          {stage === "thinking" ? (
            <span className="flex h-5 items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  style={{ animationDelay: `${d * 160}ms` }}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
                />
              ))}
            </span>
          ) : (
            <p className="text-caption leading-relaxed text-muted transition-opacity duration-500 [[data-mock=armed]_&]:opacity-0">
              <AnswerText text={A.answer} />
            </p>
          )}
          {/* Sources: the provenance chips are the punchline. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`text-micro uppercase tracking-wide text-muted transition-opacity duration-500 ${sourcesIn ? "opacity-100" : "opacity-0"}`}
            >
              Sources
            </span>
            {A.sources.map((src, i) => (
              <span
                key={src}
                style={{ transitionDelay: sourcesIn ? `${120 + i * 110}ms` : "0ms" }}
                className={`flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-micro text-muted transition-[opacity,transform] duration-500 ease-out ${
                  sourcesIn ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
                }`}
              >
                <FileText className="h-2.5 w-2.5" strokeWidth={2} />
                {src}
              </span>
            ))}
            <span
              style={{ transitionDelay: sourcesIn ? `${120 + A.sources.length * 110}ms` : "0ms" }}
              className={`rounded-full border border-brand/25 bg-brand/8 px-2 py-0.5 font-mono text-micro text-brand transition-[opacity,transform] duration-500 ease-out ${
                sourcesIn ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
              }`}
            >
              {A.model} · {A.generatedAt}
            </span>
          </div>
        </div>
      </div>

      {/* Follow-ups the product actually supports + input, pinned to bottom. */}
      <div className="mt-auto flex flex-col gap-2 pt-3">
        <div className="flex flex-wrap gap-1.5">
          {["Stress the WACC assumption", "Show the sensitivity grid"].map((q) => (
            <span key={q} className="rounded-full border border-brand/25 bg-brand/8 px-2.5 py-1 text-micro text-brand">
              {q}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-2 py-1.5 pl-4 pr-1.5">
          <span className="flex flex-1 items-center text-caption text-muted">
            {/* Static caret: panels are product surfaces, no ambient motion. */}
            <span aria-hidden="true" className="mr-0.5 inline-block h-3 w-px bg-brand" />
            Ask about any figure…
          </span>
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-background"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
        </div>
      </div>
    </div>
  );
}
