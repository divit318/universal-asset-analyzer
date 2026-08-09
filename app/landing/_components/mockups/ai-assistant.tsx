"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Check, ArrowUp, FileText } from "lucide-react";
import { useMockupEntry } from "../motion/mockup";

/**
 * AI Research Assistant mockup — static, hand-authored sample data,
 * choreographed ONCE on first viewport entry:
 *   - the user bubble appears first; a three-dot thinking beat for 600ms
 *   - the intro line types itself at ~45 characters per second with a
 *     visible caret; the five checkmark bullets pop in one at a time as the
 *     typing passes them, each check stroking over 200ms
 *   - the source chips fade in last, after a beat of silence. They are the
 *     punchline of the whole page: every claim traced.
 *   - the follow-up input caret blinks at a real 530ms interval
 * No-JS / reduced motion: the complete response renders directly.
 */
const INTRO = "Here are the key takeaways from Apple's Q2 earnings call:";

const FINDINGS: { chars: number; text: React.ReactNode }[] = [
  {
    chars: 78,
    text: (
      <>
        Revenue grew <b className="font-mono font-semibold tabular-nums text-foreground">+5%</b> YoY to{" "}
        <b className="font-mono font-semibold tabular-nums text-foreground">$90.8B</b>, driven by Services and Wearables.
      </>
    ),
  },
  {
    chars: 52,
    text: (
      <>
        Gross margin expanded to <b className="font-mono font-semibold tabular-nums text-foreground">46.6%</b>, up{" "}
        <b className="font-mono font-semibold tabular-nums text-foreground">1.5pp</b> YoY.
      </>
    ),
  },
  {
    chars: 64,
    text: (
      <>
        iPhone sales were flat YoY, while Services hit a record{" "}
        <b className="font-mono font-semibold tabular-nums text-foreground">$23.1B</b>.
      </>
    ),
  },
  {
    chars: 88,
    text: (
      <>
        Operating cash flow reached <b className="font-mono font-semibold tabular-nums text-foreground">$28.2B</b>;
        the board added <b className="font-mono font-semibold tabular-nums text-foreground">$110B</b> to buybacks.
      </>
    ),
  },
  {
    chars: 62,
    text: <>Company raised FY guidance, citing strong demand and cost discipline.</>,
  },
];

const SOURCES = ["10-Q, Q2 FY25", "Earnings call transcript", "8-K, May 2"];
const FOLLOW_UPS = ["Compare with Microsoft's quarter", "Chart Services growth"];
const CPS = 45; // characters per second

/* Sequence stages: 0 user bubble · 1 thinking · 2.. typing/findings · done */
type Stage =
  | { kind: "done" }
  | { kind: "thinking" }
  | { kind: "typing"; introChars: number; findingsShown: number };

export function AiAssistantMockup() {
  const { ref, phase } = useMockupEntry();
  const [stage, setStage] = useState<Stage>({ kind: "done" }); // SSR final state
  const [sourcesIn, setSourcesIn] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (phase === "armed") {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- arming the
         entrance after the SSR final state has painted. */
      setStage({ kind: "thinking" });
      setSourcesIn(false);
      return;
    }
    if (phase !== "play") return;
    const t = timers.current;
    let at = 600; // the thinking beat
    // The intro types at ~45cps.
    const introMs = (INTRO.length / CPS) * 1000;
    const introSteps = 24;
    for (let s = 1; s <= introSteps; s++) {
      t.push(
        setTimeout(
          () => setStage({ kind: "typing", introChars: Math.round((INTRO.length * s) / introSteps), findingsShown: 0 }),
          at + (introMs * s) / introSteps,
        ),
      );
    }
    at += introMs;
    // Each finding pops as the typing passes it, paced by its own length.
    FINDINGS.forEach((f, i) => {
      at += (f.chars / CPS) * 1000;
      t.push(setTimeout(() => setStage({ kind: "typing", introChars: INTRO.length, findingsShown: i + 1 }), at));
    });
    // A beat of silence, then the punchline: the sources.
    t.push(
      setTimeout(() => {
        setStage({ kind: "done" });
        setSourcesIn(true);
      }, at + 700),
    );
    return () => t.forEach(clearTimeout);
  }, [phase]);

  const typing = stage.kind === "typing";
  const introShown = stage.kind === "done" ? INTRO : typing ? INTRO.slice(0, stage.introChars) : "";
  const findingsShown = stage.kind === "done" ? FINDINGS.length : typing ? stage.findingsShown : 0;

  return (
    <div ref={ref} data-mock={phase} className="flex h-full flex-col p-4 text-left">
      {/* User message: first on stage. */}
      <div className="flex justify-end">
        <p className="rounded-panel rounded-br-sm bg-surface-3 px-3.5 py-2 text-caption text-foreground transition-opacity duration-300 [[data-mock=armed]_&]:opacity-0">
          Summarize Apple&apos;s Q2 earnings call.
        </p>
      </div>

      {/* Assistant response. */}
      <div className="mt-3 flex flex-1 gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The thinking beat: three dots for 600ms, then typing. */}
          {stage.kind === "thinking" ? (
            <span className="flex h-5 items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  style={{ animationDelay: `${d * 160}ms` }}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted"
                />
              ))}
            </span>
          ) : (
            <p className="text-caption text-foreground">
              {introShown}
              {typing && stage.introChars < INTRO.length && <span className="text-brand">▎</span>}
            </p>
          )}
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2">
            {FINDINGS.map((f, i) => (
              <li
                key={i}
                className={`flex items-start gap-2 text-caption leading-relaxed text-muted transition-opacity duration-200 ${
                  i < findingsShown ? "opacity-100" : "opacity-0"
                }`}
              >
                <Check
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-positive transition-[stroke-dashoffset] duration-200 [stroke-dasharray:24] ${
                    i < findingsShown ? "[stroke-dashoffset:0]" : "[stroke-dashoffset:24]"
                  }`}
                  strokeWidth={2.5}
                />
                <span>
                  {f.text}
                  {/* The caret sits at the line the typing just reached. */}
                  {typing && stage.introChars >= INTRO.length && i === findingsShown - 1 && (
                    <span className="text-brand">▎</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {/* Sources: the punchline, after a beat of silence. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`text-micro uppercase tracking-wide text-muted transition-opacity duration-500 ${sourcesIn ? "opacity-100" : "opacity-0"}`}
            >
              Sources
            </span>
            {SOURCES.map((src, i) => (
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
          </div>
        </div>
      </div>

      {/* Suggested follow-ups + input pinned to the frame bottom. */}
      <div className="mt-auto flex flex-col gap-2 pt-3">
        <div className="flex flex-wrap gap-1.5">
          {FOLLOW_UPS.map((q) => (
            <span key={q} className="rounded-full border border-brand/25 bg-brand/8 px-2.5 py-1 text-micro text-brand">
              {q}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-2 py-1.5 pl-4 pr-1.5">
          <span className="flex flex-1 items-center text-caption text-muted">
            {/* A real 530ms caret. */}
            <span aria-hidden="true" className="mr-0.5 inline-block h-3 w-px animate-mk-caret-blink bg-brand motion-reduce:animate-none" />
            Ask a follow-up…
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
