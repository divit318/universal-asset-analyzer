/**
 * Small shared display atoms for the dashboard modules. Presentation only.
 */

import type { ReactNode } from "react";
import { fmtSignedPct } from "./format";

/** A signed, tone-coloured percent. The dashboard's most repeated element. */
export function Delta({ value, className = "" }: { value: number | null; className?: string }) {
  const tone = value == null ? "text-muted" : value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-muted";
  return <span className={`font-mono tabular-nums ${tone} ${className}`}>{fmtSignedPct(value)}</span>;
}

const SEV_STYLE: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  high: { dot: "bg-negative", text: "text-negative", bg: "bg-negative/10", label: "High" },
  medium: { dot: "bg-warning", text: "text-warning", bg: "bg-warning/10", label: "Med" },
  low: { dot: "bg-muted", text: "text-muted", bg: "bg-surface-2", label: "Low" },
};

/** A severity chip (High / Med / Low) used by Threats and Actions. */
export function SeverityBadge({ severity }: { severity: "high" | "medium" | "low" }) {
  const s = SEV_STYLE[severity] ?? SEV_STYLE.low;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** A tiny bare severity dot, when the label would be noise. */
export function SeverityDot({ severity }: { severity: "high" | "medium" | "low" }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${(SEV_STYLE[severity] ?? SEV_STYLE.low).dot}`} />;
}

/** A compact key/value stat, right-aligned value. */
export function StatCell({ label, value, tone }: { label: string; value: ReactNode; tone?: "positive" | "negative" | "muted" }) {
  const toneClass = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : tone === "muted" ? "text-muted" : "text-foreground";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

/** A quiet framed cell used to build dense stat grids. */
export function Tile({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-control border border-border/60 bg-surface-2/40 p-2.5 ${className}`}>{children}</div>;
}
