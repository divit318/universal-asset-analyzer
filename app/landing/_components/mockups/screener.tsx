"use client";

import { useEffect, useRef, useState } from "react";
import { X, Plus, Columns3, Download } from "lucide-react";
import { useMockupEntry } from "../motion/mockup";
import { subscribe } from "../motion/engine";

/**
 * Universal Screener mockup — static, hand-authored sample data,
 * choreographed ONCE on first viewport entry:
 *   - filter chips fly in from the right, staggered 60ms, slight overshoot
 *   - 14 rows cascade in; then the filter "applies": six non-matching rows
 *     fade to 20% and collapse to zero height, leaving the 8 that match
 *   - the match counter animates 2,847 -> 8 on a fast non-linear ease
 *     during the collapse; "Screened in 0.42s" types in last
 *   - hovering a filter chip highlights the column it governs and pulses
 *     the values closest to its threshold, once
 * No-JS / reduced motion: the final 8-row state renders directly.
 */
interface Row {
  ticker: string;
  company: string;
  cap: string;
  pe: string;
  growth: string;
  sentiment: string;
  /** False: culled when the filter applies (present in the initial cascade). */
  match: boolean;
  /** Column values nearest a filter threshold (pulse on chip hover). */
  near?: number[];
}

/* Chip -> the column it governs (index into the value columns). */
const FILTERS: { label: string; column: number }[] = [
  { label: "Market Cap > $1B", column: 0 },
  { label: "P/E < 25", column: 1 },
  { label: "Revenue Growth > 10%", column: 2 },
  { label: "AI Sentiment: Positive", column: 3 },
];

const ROWS: Row[] = [
  { ticker: "NVDA", company: "NVIDIA Corporation", cap: "$2.42T", pe: "22.4x", growth: "125.4%", sentiment: "Very Positive", match: true, near: [1] },
  { ticker: "TSLA", company: "Tesla, Inc.", cap: "$580B", pe: "62.3x", growth: "8.1%", sentiment: "Mixed", match: false },
  { ticker: "MSFT", company: "Microsoft Corporation", cap: "$3.01T", pe: "28.7x", growth: "15.2%", sentiment: "Positive", match: true },
  { ticker: "RBLX", company: "Roblox Corporation", cap: "$24B", pe: "n/a", growth: "22.4%", sentiment: "Neutral", match: false },
  { ticker: "AVGO", company: "Broadcom Inc.", cap: "$1.02T", pe: "19.1x", growth: "23.7%", sentiment: "Positive", match: true, near: [0] },
  { ticker: "INTC", company: "Intel Corporation", cap: "$130B", pe: "88.6x", growth: "-2.1%", sentiment: "Negative", match: false },
  { ticker: "CRM", company: "Salesforce, Inc.", cap: "$246B", pe: "21.3x", growth: "11.3%", sentiment: "Neutral", match: true, near: [2] },
  { ticker: "AMD", company: "Advanced Micro Devices", cap: "$236B", pe: "37.6x", growth: "18.6%", sentiment: "Positive", match: true },
  { ticker: "SNAP", company: "Snap Inc.", cap: "$18B", pe: "n/a", growth: "5.2%", sentiment: "Mixed", match: false },
  { ticker: "NOW", company: "ServiceNow, Inc.", cap: "$168B", pe: "48.2x", growth: "24.1%", sentiment: "Positive", match: true },
  { ticker: "LYFT", company: "Lyft, Inc.", cap: "$6B", pe: "n/a", growth: "9.6%", sentiment: "Neutral", match: false, near: [2] },
  { ticker: "PANW", company: "Palo Alto Networks", cap: "$112B", pe: "44.9x", growth: "16.5%", sentiment: "Neutral", match: true },
  { ticker: "PTON", company: "Peloton Interactive", cap: "$2B", pe: "n/a", growth: "-8.4%", sentiment: "Negative", match: false, near: [0] },
  { ticker: "SNPS", company: "Synopsys, Inc.", cap: "$88B", pe: "34.8x", growth: "13.9%", sentiment: "Positive", match: true },
];

const HEADERS = ["Ticker", "Company", "Market Cap", "P/E TTM", "Rev. Growth YoY", "AI Sentiment"];
const TYPED = "Screened in 0.42s";

export function ScreenerMockup() {
  const { ref, phase } = useMockupEntry();
  // Choreography: cascade (rows in) -> filter (cull) -> done (typed footer).
  const [applied, setApplied] = useState(true); // final state for SSR/no-JS
  const [count, setCount] = useState(8);
  const [typed, setTyped] = useState(TYPED);
  const [hoverCol, setHoverCol] = useState(-1);
  const [pulseToken, setPulseToken] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (phase === "armed") {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- arming the
         entrance after the SSR final state has painted. */
      setApplied(false);
      setCount(2847);
      setTyped("");
      return;
    }
    if (phase !== "play") return;
    const t = timers.current;
    // Rows cascade first; the filter applies once they have landed.
    t.push(
      setTimeout(() => {
        setApplied(true);
        // Counter 2,847 -> 8 on a fast non-linear ease, on the shared loop.
        const start = performance.now();
        const unsub = subscribe(() => {
          const u = Math.min(1, (performance.now() - start) / 650);
          const eased = 1 - Math.pow(1 - u, 4);
          setCount(Math.round(2847 - (2847 - 8) * eased));
          if (u >= 1) {
            unsub();
            return false;
          }
          return true;
        });
      }, 1500),
    );
    // "Screened in 0.42s" types in last.
    for (let i = 0; i <= TYPED.length; i++) {
      t.push(setTimeout(() => setTyped(TYPED.slice(0, i)), 2350 + i * 45));
    }
    return () => t.forEach(clearTimeout);
  }, [phase]);

  return (
    <div ref={ref} data-mock={phase} className="flex h-full flex-col p-4 text-left">
      <p className="text-mk-small font-semibold text-foreground">Universal Screener</p>

      {/* Filter chips + toolbar. Chips fly in from the right, overshoot, settle. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f, i) => (
          <span
            key={f.label}
            onMouseEnter={() => {
              setHoverCol(f.column);
              setPulseToken((n) => n + 1);
            }}
            onMouseLeave={() => setHoverCol(-1)}
            style={{ transitionDelay: `${i * 60}ms` }}
            className="flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-micro text-muted transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)] hover:border-brand/40 hover:text-foreground [[data-mock=armed]_&]:translate-x-10 [[data-mock=armed]_&]:opacity-0"
          >
            {f.label}
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

      {/* Results: div rows (the frame body is aria-hidden decoration) so the
          culled rows can genuinely collapse their height. */}
      <div className="mt-3 overflow-hidden rounded-card border border-hairline">
        <div className="grid grid-cols-[3.2rem_1fr_4.2rem_3.6rem_5rem_6rem] border-b border-hairline bg-surface-2/80">
          {HEADERS.map((h, i) => (
            <span
              key={h}
              className={`px-2.5 py-1 text-micro font-medium transition-colors ${i >= 2 && i <= 4 ? "text-right" : ""} ${
                hoverCol === i - 2 ? "bg-brand/10 text-brand" : "text-muted"
              }`}
            >
              {h}
            </span>
          ))}
        </div>
        {ROWS.map((r, ri) => {
          const culled = applied && !r.match;
          return (
            <div
              key={r.ticker}
              style={{ transitionDelay: applied ? `${(ri % 7) * 30}ms` : `${200 + ri * 45}ms` }}
              className={`grid grid-cols-[3.2rem_1fr_4.2rem_3.6rem_5rem_6rem] items-center overflow-hidden border-b border-hairline transition-[opacity,line-height,transform] duration-500 ease-out last:border-b-0 ${
                culled
                  ? "leading-[0] opacity-20 *:py-0 *:leading-[0]"
                  : "leading-[1.4] [[data-mock=armed]_&]:translate-y-2 [[data-mock=armed]_&]:opacity-0"
              }`}
            >
              <span className="px-2.5 py-1 font-mono text-caption font-semibold tabular-nums text-foreground transition-[padding,opacity] duration-500">{r.ticker}</span>
              <span className="truncate px-2.5 py-1 text-caption text-muted transition-[padding,opacity] duration-500">{r.company}</span>
              {[r.cap, r.pe, r.growth].map((v, ci) => (
                <span
                  key={ci}
                  className={`px-2.5 py-1 text-right font-mono text-caption tabular-nums text-foreground transition-[padding,opacity,background-color] duration-500 ${
                    hoverCol === ci ? "bg-brand/8" : ""
                  }`}
                >
                  <span
                    key={hoverCol === ci && r.near?.includes(ci) ? pulseToken : -1}
                    className={hoverCol === ci && r.near?.includes(ci) ? "animate-mk-value-pulse motion-reduce:animate-none" : ""}
                  >
                    {v}
                  </span>
                </span>
              ))}
              <span className={`px-2.5 py-1 transition-[padding,opacity,background-color] duration-500 ${hoverCol === 3 ? "bg-brand/8" : ""}`}>
                <span
                  className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-micro font-medium ${
                    r.sentiment === "Very Positive" || r.sentiment === "Positive"
                      ? "bg-positive/12 text-positive"
                      : r.sentiment === "Negative"
                        ? "bg-negative/12 text-negative"
                        : "bg-brand/12 text-brand"
                  } ${culled ? "hidden" : ""}`}
                >
                  {r.sentiment}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Status footer pins to the frame bottom. */}
      <div className="mt-auto flex items-center justify-between pt-2 font-mono text-micro tabular-nums text-muted">
        <span>Showing 8 of {count.toLocaleString("en-US")} matches</span>
        <span>
          {typed}
          {typed.length > 0 && typed.length < TYPED.length && <span className="text-brand">▎</span>}
        </span>
      </div>
    </div>
  );
}
