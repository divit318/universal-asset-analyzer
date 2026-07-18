/**
 * Contribution bars — diverging horizontal bars for performance attribution.
 *
 * Zero sits at the centre; gains extend right in the positive tone, drags left
 * in the negative tone. Every row shares one magnitude scale so a −2pp drag and
 * a +2pp contributor are visually equal and opposite, which is the whole point
 * of an attribution chart.
 */

import { fmtSignedPct, fmtSignedMoney } from "./format";

export interface ContributionRow {
  id: string;
  label: string;
  contributionPct: number;
  contributionDollar: number;
}

export function ContributionBars({
  rows,
  maxMagnitude,
}: {
  rows: ContributionRow[];
  /** Shared scale across sections; falls back to the local max. */
  maxMagnitude?: number;
}) {
  if (rows.length === 0) return null;
  const localMax = Math.max(...rows.map((r) => Math.abs(r.contributionPct)), 0.01);
  const scale = maxMagnitude && maxMagnitude > 0 ? maxMagnitude : localMax;

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const pos = r.contributionPct >= 0;
        const widthPct = Math.min(50, (Math.abs(r.contributionPct) / scale) * 50);
        return (
          <li key={r.id} className="grid grid-cols-[minmax(0,5rem)_1fr_auto] items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground/90">{r.label}</span>
            <div className="relative h-4 rounded-[3px] bg-surface-2/60">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div
                className="absolute inset-y-[3px] rounded-[2px] transition-[width]"
                style={{
                  [pos ? "left" : "right"]: "50%",
                  width: `${widthPct}%`,
                  background: pos ? "var(--positive)" : "var(--negative)",
                  opacity: 0.85,
                }}
              />
            </div>
            <span
              className="w-16 text-right font-mono text-[11px] tabular-nums"
              style={{ color: pos ? "var(--positive)" : "var(--negative)" }}
              title={fmtSignedMoney(r.contributionDollar)}
            >
              {fmtSignedPct(r.contributionPct)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A slim labelled progress meter, 0-100. */
export function Meter({ value, tone = "brand", label }: { value: number; tone?: "brand" | "positive" | "warning" | "negative"; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === "positive" ? "var(--positive)" : tone === "warning" ? "var(--warning)" : tone === "negative" ? "var(--negative)" : "var(--brand)";
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span> : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}
