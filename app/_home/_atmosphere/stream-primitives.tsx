/**
 * Shared presentation atoms for the Attention / Radar row streams.
 *
 * One pill, one chip, one numeral treatment — defined once so the two panels
 * that sit side by side cannot drift apart typographically. Pure markup; no
 * state, no fetching.
 */

import type { ReactNode } from "react";

/** Category / fit-tier tones. Semantic and consistent across both panels:
 *  green for signals and good fits, signal-orange for threats (the design
 *  system's caution colour — brass is reserved for chrome, never cautions),
 *  steel blue for actions, violet for triggered alerts (distinct from both
 *  the action blue beside it and the threat orange above it), red for
 *  critical threats, muted slate for neutral. */
export type PillTone = "positive" | "warning" | "negative" | "blue" | "alert" | "neutral" | "brand";

const PILL_TONE: Record<PillTone, string> = {
  positive: "bg-positive/12 text-positive",
  warning: "bg-warning/12 text-warning",
  negative: "bg-negative/12 text-negative",
  blue: "bg-chart-2/12 text-chart-2",
  alert: "bg-alert/12 text-alert",
  neutral: "bg-muted/12 text-muted",
  brand: "bg-brand/12 text-brand",
};

/** The 10px uppercase category pill (SIGNAL / THREAT / ACTION / GOOD FIT / NEW). */
export function CategoryPill({
  tone,
  children,
  ariaLabel,
  className = "",
}: {
  tone: PillTone;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={`inline-flex shrink-0 items-center rounded-md px-2 py-[5px] text-label font-semibold uppercase leading-none tracking-[0.08em] ${PILL_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** The 11px bordered status chip ("Exited", "Researched today", "Surfaced"). */
export function StatusChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[5px] border border-foreground/12 bg-transparent px-2 py-1 text-caption leading-none text-muted">
      {children}
    </span>
  );
}

/** The icon well: a 36px rounded square tinted at 10% of the row's category
 *  colour, holding an 18px glyph at full saturation. */
export function IconWell({ toneClass, children }: { toneClass: string; children: ReactNode }) {
  return (
    <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${toneClass}`}>
      {children}
    </span>
  );
}

const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?%?)/g;

/**
 * Renders prose with every numeric token (scores, percentages, deltas) in
 * monospace tabular numerals, per the panel type spec — including numbers
 * inside reason strings. Em dashes inside reason prose are normalized to a
 * comma pause (the stream's reason lines use periods and commas, never dashes);
 * the engines' stored copy is untouched.
 */
export function NumericText({ text }: { text: string }) {
  const parts = text.replace(/\s—\s/g, ", ").split(NUMBER_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-mono tabular-nums">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
