"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { LineChart, FileText, Table, MessageSquare, Newspaper, type LucideIcon } from "lucide-react";
import { IconTile } from "../primitives/icon-tile";
import { prefersReducedMotion, onNextFrame } from "../motion/engine";

/**
 * FragmentationDiagram — the Problem section's centerpiece. Five disconnected
 * islands, one per tool, each carrying its label, its description, and a mono
 * fragment of the kind of data that tool holds. Connections between the
 * islands are drawn but severed: hairlines that reach for a neighbour and
 * fade, stop dead, or peter out as dashes. Nothing joins up — the diagram
 * demonstrates fragmentation instead of describing it.
 *
 * Deliberately NOT the Knowledge Graph: that surface shows resolved
 * connection (nodes on a clean radial layout, edges that complete). This one
 * shows its absence — no edge ever terminates on a node, and the islands
 * refuse a shared baseline.
 *
 * Motion (globals.css, mk-frag-*): islands settle once with a short stagger,
 * severed edges draw in after them and stop visibly short; a very slow, low
 * amplitude drift keeps the composition from freezing. Server render and
 * no-JS are the fully settled state; reduced motion never leaves it.
 */

interface FragNode {
  icon: LucideIcon;
  title: string;
  description: string;
  fragment: string;
  /** Desktop island geometry (percent of the diagram canvas) + tilt. */
  x: string;
  y: string;
  w: string;
  tilt: string;
  /** Mobile flow: alternating alignment so the misalignment survives. */
  mobile: string;
  /** Reveal stagger + ambient drift phase. */
  delay: number;
  driftT: string;
  driftD: string;
}

const NODES: FragNode[] = [
  {
    icon: LineChart,
    title: "Yahoo Finance",
    description: "Price data, charts, and market insights.",
    fragment: "NVDA 891.42  -2.14%",
    x: "0%", y: "0%", w: "44%", tilt: "-0.7deg",
    mobile: "self-start w-[88%]",
    delay: 0, driftT: "17s", driftD: "0s",
  },
  {
    icon: FileText,
    title: "EDGAR filings",
    description: "Raw filings buried in PDFs and text.",
    fragment: "10-K.pdf  p.147/312",
    x: "55%", y: "11%", w: "42%", tilt: "0.9deg",
    mobile: "self-end w-[85%]",
    delay: 90, driftT: "21s", driftD: "-4s",
  },
  {
    icon: Table,
    title: "Spreadsheets",
    description: "Manual models and scattered calculations.",
    fragment: "=IFERROR(B7*C12,#REF!)",
    x: "6%", y: "35%", w: "46%", tilt: "0.5deg",
    mobile: "self-start w-[92%]",
    delay: 180, driftT: "19s", driftD: "-9s",
  },
  {
    icon: MessageSquare,
    title: "ChatGPT",
    description: "Answers, but no direct access to your data.",
    fragment: "[file not provided]",
    x: "54%", y: "52%", w: "44%", tilt: "-0.8deg",
    mobile: "self-end w-[87%]",
    delay: 270, driftT: "23s", driftD: "-13s",
  },
  {
    icon: Newspaper,
    title: "News sites",
    description: "Noise, opinions, and information overload.",
    fragment: "takes 14, numbers 0",
    x: "12%", y: "73%", w: "41%", tilt: "0.6deg",
    mobile: "self-start w-[84%]",
    delay: 360, driftT: "18s", driftD: "-6s",
  },
];

/** Severed edges, in the 100x100 canvas space. Each starts at an island's
 *  edge and fails differently: a near-miss fade, a hard cut, a wander into
 *  open space, a dash pattern that peters out, and a two-stub gap. */
interface FragEdge {
  d: string;
  /** Gradient endpoints (userSpaceOnUse): brass at from, transparent at to. */
  from: [number, number];
  to: [number, number];
  delay: number;
  dashed?: boolean;
}

const EDGES: FragEdge[] = [
  // Yahoo reaches for EDGAR and stops just short of its left edge.
  { d: "M 44 9 C 47 10, 50 12, 53 14", from: [44, 9], to: [53.5, 14.5], delay: 620 },
  // Yahoo toward Spreadsheets: dashes that peter out before arriving.
  { d: "M 15 21 C 14.5 24.5, 14 28, 13.5 32", from: [15, 21], to: [13.4, 32.5], delay: 760, dashed: true },
  // Spreadsheets heads right, wanders into open space, and gives up.
  { d: "M 52 41 C 58 39.5, 63 38.5, 69 37.5", from: [52, 41], to: [69.5, 37.3], delay: 900 },
  // EDGAR descends toward ChatGPT and is cut dead mid-air (tick below).
  { d: "M 71 32 C 70.5 36.5, 70 41, 69.2 45", from: [71, 32], to: [69.1, 45.5], delay: 1040 },
  // ChatGPT and News each extend a stub; the two never meet.
  { d: "M 66 76 C 63 79, 60.5 81.5, 58 84", from: [66, 76], to: [57.6, 84.4], delay: 1180 },
  { d: "M 53.5 84.5 L 56.4 85.1", from: [53.5, 84.5], to: [56.7, 85.2], delay: 1330 },
  // Orphan stubs: EDGAR bleeds off the right edge, Spreadsheets drops one.
  { d: "M 96 15 C 97.5 15.4, 99 15.8, 100.5 16.2", from: [96, 15], to: [100.5, 16.3], delay: 1430 },
  { d: "M 25 57 C 25.5 59.5, 26 61.5, 26.5 64", from: [25, 57], to: [26.6, 64.5], delay: 1520 },
];

/** The cut end of the EDGAR edge: a tiny perpendicular tick, like a severed
 *  wire. Fades in after its edge finishes drawing. */
const CUT_TICK = { d: "M 67.9 44.5 L 70.5 45.5", delay: 1950 };

/** Loose debris in the open zones between islands: scraps of the workflow
 *  that fell between the tools. Decorative, low opacity, desktop only. */
const SCRAPS = [
  { text: "paste values only", x: "26%", y: "28%", tilt: "-1.1deg", delay: 1600 },
  { text: "final_v3 (2).xlsx", x: "66%", y: "88%", tilt: "1.4deg", delay: 1700 },
];

export function FragmentationDiagram() {
  const ref = useRef<HTMLDivElement | null>(null);
  // "visible": SSR / no-JS / reduced motion — fully settled. "hidden": armed
  // after hydration. "live": settling + severed edges drawing in, once.
  const [phase, setPhase] = useState<"visible" | "hidden" | "live">("visible");

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    setPhase("hidden");

    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) {
      onNextFrame(() => onNextFrame(() => setPhase("live")));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("live");
          io.disconnect(); // once per page load
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-frag={phase}
      className="relative flex flex-col gap-7 lg:block lg:h-[760px] xl:h-[660px]"
    >
      {/* Severed connectors: desktop composition only. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
      >
        <defs>
          {EDGES.map((e, i) => (
            <linearGradient
              key={i}
              id={`mk-frag-fade-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={e.from[0]}
              y1={e.from[1]}
              x2={e.to[0]}
              y2={e.to[1]}
            >
              <stop offset="0" style={{ stopColor: "var(--brand)" }} stopOpacity="0.75" />
              <stop offset="0.55" style={{ stopColor: "var(--brand)" }} stopOpacity="0.55" />
              <stop offset="1" style={{ stopColor: "var(--brand)" }} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {EDGES.map((e, i) => (
          <path
            key={i}
            d={e.d}
            pathLength={1}
            fill="none"
            stroke={`url(#mk-frag-fade-${i})`}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            className={e.dashed ? "mk-frag-edge-soft" : "mk-frag-edge"}
            style={
              {
                "--frag-d": `${e.delay}ms`,
                ...(e.dashed ? { strokeDasharray: "0.055 0.05" } : undefined),
              } as React.CSSProperties
            }
          />
        ))}
        <path
          d={CUT_TICK.d}
          pathLength={1}
          fill="none"
          stroke="var(--brand)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="mk-frag-edge-soft"
          style={{ "--frag-d": `${CUT_TICK.delay}ms` } as React.CSSProperties}
        />
      </svg>

      {SCRAPS.map((scrap) => (
        <span
          key={scrap.text}
          aria-hidden="true"
          className="mk-frag-edge-soft pointer-events-none absolute hidden select-none font-mono text-mk-small text-brand opacity-35 lg:block"
          style={
            {
              left: scrap.x,
              top: scrap.y,
              rotate: scrap.tilt,
              "--frag-d": `${scrap.delay}ms`,
            } as React.CSSProperties
          }
        >
          {scrap.text}
        </span>
      ))}

      {NODES.map((node, i) => (
        <Fragment key={node.title}>
          {/* Mobile: a severed stub between islands — a hairline that fades
              out, a gap, then a lone dot. Never a completed link. */}
          {i > 0 && (
            <div
              aria-hidden="true"
              className={`-my-4 flex flex-col gap-1.5 lg:hidden ${i % 2 === 0 ? "pl-[38%]" : "pl-[58%]"}`}
            >
              <span className="h-5 w-px bg-gradient-to-b from-brand/45 to-transparent" />
              <span className="ml-px h-1 w-1 rounded-full bg-brand/25" />
            </div>
          )}
          <div
            data-frag-island
            className={`mk-frag-island rounded-xl border border-hairline bg-surface/70 ${node.mobile} lg:absolute lg:left-(--fx) lg:top-(--fy) lg:w-(--fw)`}
            style={
              {
                "--fx": node.x,
                "--fy": node.y,
                "--fw": node.w,
                "--fr": node.tilt,
                "--frag-d": `${node.delay}ms`,
              } as React.CSSProperties
            }
          >
            <div
              className="mk-frag-drift p-5"
              style={{ "--drift-t": node.driftT, "--drift-d": node.driftD } as React.CSSProperties}
            >
              <div className="flex items-center gap-3.5">
                <IconTile icon={node.icon} shape="circle" />
                <h3 className="whitespace-nowrap font-serif text-lg font-semibold text-foreground">{node.title}</h3>
              </div>
              <p className="mt-2.5 text-mk-body text-muted">{node.description}</p>
              <p aria-hidden="true" className="mt-3 truncate font-mono text-mk-small text-brand opacity-55">
                {node.fragment}
              </p>
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
