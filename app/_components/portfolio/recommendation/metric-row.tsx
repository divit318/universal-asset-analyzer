/** Shared presentational atoms for the Add-to-Portfolio modal — every panel that shows a single stat or a before→after pair uses these instead of hand-rolling its own markup. */

import { useState } from "react";

/** Collapsed-by-default disclosure for the deeper, power-user panels (full sector/currency impact, sizing scenarios) — progressive disclosure keeps the default view lightweight without deleting the depth. */
export function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted"
      >
        {title}
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

type Tone = "positive" | "negative" | undefined;

export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: Tone; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label uppercase tracking-widest text-muted/70">{label}</span>
      <span className={`font-mono text-sm font-bold ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground"}`}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-muted">{sub}</span>}
    </div>
  );
}

export function BeforeAfter({ label, before, after, tone }: { label: string; before: string; after: string; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2 font-mono tabular-nums">
        <span className="text-muted/70">{before}</span>
        <span aria-hidden className="text-muted/50">→</span>
        <span className={`font-semibold ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground"}`}>{after}</span>
      </span>
    </div>
  );
}
