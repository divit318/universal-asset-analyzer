"use client";

import { Card } from "@/app/_components/ui";
import type { PreviewResponse } from "./use-preview";

/**
 * Portfolio Diff (Feature 13) — current vs. projected asset-class allocation
 * for the current selection. Only asset classes that actually change weight
 * are shown, so a 20-class portfolio doesn't drown the two or three that
 * matter for this specific selection.
 */
export function PortfolioDiffChart({ preview }: { preview: PreviewResponse | null }) {
  if (!preview) return null;

  const beforeByClass = new Map(preview.before.allocation.byAssetClass.slices.map((s) => [s.key, s]));
  const afterByClass = new Map(preview.after.allocation.byAssetClass.slices.map((s) => [s.key, s]));
  const allKeys = new Set([...beforeByClass.keys(), ...afterByClass.keys()]);

  const rows = [...allKeys]
    .map((key) => {
      const before = beforeByClass.get(key);
      const after = afterByClass.get(key);
      return {
        key,
        label: before?.label ?? after?.label ?? key,
        beforeWeight: before?.weight ?? 0,
        afterWeight: after?.weight ?? 0,
      };
    })
    .filter((r) => Math.abs(r.afterWeight - r.beforeWeight) >= 0.1)
    .sort((a, b) => Math.abs(b.afterWeight - b.beforeWeight) - Math.abs(a.afterWeight - a.beforeWeight));

  if (rows.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        Current vs. projected allocation
      </span>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const changed = Math.abs(r.afterWeight - r.beforeWeight) >= 0.1;
          return (
            <li key={r.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className={changed ? "font-semibold text-foreground" : "text-muted"}>{r.label}</span>
                <span className="flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span className="text-muted/70">{r.beforeWeight.toFixed(1)}%</span>
                  <span className="text-muted/40">→</span>
                  <span className="font-semibold text-foreground">{r.afterWeight.toFixed(1)}%</span>
                </span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-brand/25 transition-all duration-300"
                  style={{ width: `${Math.min(r.beforeWeight, 100)}%` }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 rounded-full bg-foreground transition-all duration-300"
                  style={{ left: `${Math.min(r.afterWeight, 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
