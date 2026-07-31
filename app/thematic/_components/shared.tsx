"use client";

/**
 * Small display primitives shared across the Thematic report's tabs.
 * Pure presentation — every one takes data in and renders it; none fetch,
 * none hold state.
 */

import { CountUp } from "@/app/_components/count-up";

export function scoreTone(pct: number): { text: string; bar: string } {
  if (pct >= 70) return { text: "text-positive", bar: "bg-positive" };
  if (pct >= 40) return { text: "text-warning", bar: "bg-warning" };
  return { text: "text-negative", bar: "bg-negative" };
}

/** A 0–10 stage score, rendered as one legible figure rather than a bare number. */
export function StageScore({ value }: { value: number }) {
  const tone = scoreTone((value / 10) * 100);
  return (
    <span className={`shrink-0 font-mono text-lg font-semibold tabular-nums ${tone.text}`}>
      <CountUp value={value} format={(v) => v.toFixed(1).replace(/\.0$/, "")} />
      <span className="text-xs font-normal text-muted">/10</span>
    </span>
  );
}

/** Uppercase micro-label above a group of values. The page's one label style. */
export function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-label font-semibold uppercase tracking-widest text-muted/70">{children}</div>;
}

export function Bullets({ items, tone = "brand" }: { items: string[]; tone?: "brand" | "positive" | "negative" }) {
  if (items.length === 0) return <p className="text-xs text-faint">Not identified.</p>;
  const dot = tone === "positive" ? "bg-positive" : tone === "negative" ? "bg-negative" : "bg-brand";
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${dot}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

export function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-xs text-faint">None identified.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
          {item}
        </span>
      ))}
    </div>
  );
}

/** Honest absence — never a spinner, never an error. Mirrors ui/section.tsx. */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center rounded-card border border-dashed border-border px-6 py-12">
      <p className="max-w-md text-center text-sm leading-relaxed text-faint">{children}</p>
    </div>
  );
}

export function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function changeTone(v: number | null): string {
  if (v == null) return "text-faint";
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted";
}

const TIER_TONE: Record<number, string> = {
  1: "border-brand/30 bg-brand/10 text-brand",
  2: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  3: "border-warning/30 bg-warning/10 text-warning",
  4: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  5: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  6: "border-positive/30 bg-positive/10 text-positive",
};

export function TierBadge({ tier }: { tier: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-label font-bold ${TIER_TONE[tier] ?? "border-border bg-surface-3 text-muted"}`}
      title={`Tier ${tier}`}
    >
      T{tier}
    </span>
  );
}

export const IMPORTANCE_VARIANT = {
  critical: "negative",
  high: "brand",
  medium: "neutral",
  low: "neutral",
} as const;

/** 0–100 composite quality from the screener. Null is a fact, not a zero. */
export function QualityCell({ score }: { score: number | null }) {
  if (score == null) return <span className="font-mono text-xs text-faint">—</span>;
  return (
    <span className={`font-mono text-xs font-semibold tabular-nums ${scoreTone(score).text}`}>{score}</span>
  );
}
