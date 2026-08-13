"use client";

import { useEffect, useRef, useState } from "react";
import { X, Plus, Columns3, Download } from "lucide-react";
import { useMockupEntry } from "../motion/mockup";
import { subscribe } from "../motion/engine";
import { PANEL_DATA } from "./panel-data";

/**
 * Universal Screener panel: one REAL run of the shipped pipeline
 * (lib/screener/pipeline.ts runScreen) baked by scripts/landing-panel-data.ts.
 * The filters are real registry metrics, the rows are the run's actual top
 * results with their deterministic rank scores and confidence, the match
 * count and universe size are the run's own numbers, and the timing is a
 * measured warm run. Nothing is hand-authored.
 *
 * Choreographed ONCE on first viewport entry:
 *   - filter chips fly in from the right, staggered 60ms, slight overshoot
 *   - rows cascade in, staggered 45ms
 *   - the counter rolls from the universe size down to the real match count
 *   - the measured timing types in last
 *   - hovering a filter chip highlights the column it governs
 * No-JS / reduced motion: the final state renders directly.
 */
const S = PANEL_DATA.screener;

/* Chip -> the value column it governs (0 cap, 1 P/E, 2 growth, 3 ROIC). */
const FILTER_COLUMNS = [0, 1, 2, 3];

const HEADERS = ["Ticker", "Company", "Mkt cap", "Fwd P/E", "Rev growth", "ROIC", "Score"];
const TYPED = `Screened in ${S.screenedIn}`;

export function ScreenerPanel() {
  const { ref, phase } = useMockupEntry();
  const [count, setCount] = useState<number>(S.total);
  const [typed, setTyped] = useState(TYPED);
  const [hoverCol, setHoverCol] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (phase === "armed") {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- arming the
         entrance after the SSR final state has painted. */
      setCount(S.universe);
      setTyped("");
      return;
    }
    if (phase !== "play") return;
    const t = timers.current;
    // Counter: universe -> real match count on a fast non-linear ease.
    t.push(
      setTimeout(() => {
        const start = performance.now();
        const unsub = subscribe(() => {
          const u = Math.min(1, (performance.now() - start) / 650);
          const eased = 1 - Math.pow(1 - u, 4);
          setCount(Math.round(S.universe - (S.universe - S.total) * eased));
          if (u >= 1) {
            unsub();
            return false;
          }
          return true;
        });
      }, 900),
    );
    // The measured timing types in last.
    for (let i = 0; i <= TYPED.length; i++) {
      t.push(setTimeout(() => setTyped(TYPED.slice(0, i)), 1700 + i * 45));
    }
    return () => t.forEach(clearTimeout);
  }, [phase]);

  return (
    <div ref={ref} data-mock={phase} className="flex h-full flex-col p-4 text-left">
      <p className="text-mk-small font-semibold text-foreground">Universal Screener</p>

      {/* Filter chips + toolbar. Chips fly in from the right, overshoot, settle. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {S.filters.map((label, i) => (
          <span
            key={label}
            onMouseEnter={() => setHoverCol(FILTER_COLUMNS[i])}
            onMouseLeave={() => setHoverCol(-1)}
            style={{ transitionDelay: `${i * 60}ms` }}
            className="flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-micro text-muted transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)] hover:border-brand/40 hover:text-foreground [[data-mock=armed]_&]:translate-x-10 [[data-mock=armed]_&]:opacity-0"
          >
            {label}
            <X className="h-2.5 w-2.5 text-muted" strokeWidth={2} />
          </span>
        ))}
        <span className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-micro text-muted">
          <Plus className="h-2.5 w-2.5" strokeWidth={2} />
          Add filter
        </span>
        <span className="ml-auto hidden items-center gap-1 text-micro text-muted sm:flex">
          <Columns3 className="h-3 w-3" strokeWidth={1.75} />
          Columns
        </span>
        <span className="hidden items-center gap-1 text-micro text-muted sm:flex">
          <Download className="h-3 w-3" strokeWidth={1.75} />
          Export
        </span>
        <span className="rounded-control bg-brand px-2.5 py-1 text-micro font-semibold text-background">
          Run screener
        </span>
      </div>

      {/* Results: the run's real top rows, ranked by deterministic score.
          Row rhythm scales with the frame (sm:py-2) so the table fills the
          16:10 body instead of stranding dead space above the footer.
          Mobile collapse: the cap, P/E and ROIC columns yield to Ticker,
          Company, Rev growth and Score so figures stay legible at 390. */}
      <div className="mt-3 flex-1 overflow-hidden rounded-card border border-hairline">
        <div className="grid grid-cols-[3rem_1fr_4.6rem_3.6rem] border-b border-hairline bg-surface-2/80 sm:grid-cols-[3rem_1fr_4rem_3.8rem_4.6rem_3.6rem_3.6rem]">
          {HEADERS.map((h, i) => (
            <span
              key={h}
              className={`px-2 py-1 text-micro font-medium transition-colors sm:py-1.5 ${i >= 2 ? "text-right" : ""} ${
                i === 2 || i === 3 || i === 5 ? "hidden sm:block" : ""
              } ${hoverCol === i - 2 ? "bg-brand/10 text-brand" : "text-muted"}`}
            >
              {h}
            </span>
          ))}
        </div>
        {S.rows.map((r, ri) => (
          <div
            key={r.ticker}
            style={{ transitionDelay: `${200 + ri * 45}ms` }}
            className="grid grid-cols-[3rem_1fr_4.6rem_3.6rem] items-center border-b border-hairline transition-[opacity,transform] duration-500 ease-out last:border-b-0 sm:grid-cols-[3rem_1fr_4rem_3.8rem_4.6rem_3.6rem_3.6rem] [[data-mock=armed]_&]:translate-y-2 [[data-mock=armed]_&]:opacity-0"
          >
            <span className="px-2 py-1 font-mono text-caption font-semibold tabular-nums text-foreground sm:py-2">{r.ticker}</span>
            <span className="truncate px-2 py-1 text-caption text-muted sm:py-2">{r.company}</span>
            {[r.cap, r.pe, r.growth, r.roic].map((v, ci) => (
              <span
                key={ci}
                className={`px-2 py-1 text-right font-mono text-caption tabular-nums text-foreground transition-colors duration-300 sm:py-2 ${
                  ci === 0 || ci === 1 || ci === 3 ? "hidden sm:block" : ""
                } ${hoverCol === ci ? "bg-brand/8" : ""}`}
              >
                {v}
              </span>
            ))}
            <span
              title={`Confidence ${r.confidence}%: share of the ranking weight with data behind it`}
              className="px-2 py-1 text-right sm:py-2"
            >
              <span className="rounded-full bg-brand/12 px-1.5 py-0.5 font-mono text-micro font-semibold tabular-nums text-brand">
                {r.score}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Status footer pins to the frame bottom: the run's real counts. */}
      <div className="mt-auto flex items-center justify-between pt-2 font-mono text-micro tabular-nums text-muted">
        <span>
          {S.rows.length} of {count.toLocaleString("en-US")} matches shown · universe {S.universe.toLocaleString("en-US")}
        </span>
        <span>
          {typed}
          {typed.length > 0 && typed.length < TYPED.length && <span className="text-brand">▎</span>}
        </span>
      </div>
    </div>
  );
}
