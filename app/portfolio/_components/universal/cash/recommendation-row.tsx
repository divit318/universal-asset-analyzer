"use client";

import { useState } from "react";
import { Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { HoldingUnit } from "@/lib/portfolio/model/types";
import type { NarratedItem } from "./types";

const UNIT_ABBR: Partial<Record<HoldingUnit, string>> = {
  shares: "sh",
  units: "units",
  coins: "coins",
  contracts: "contracts",
  face: "face",
};

/**
 * A tradeable quantity at a precision that stays honest across four orders of
 * magnitude of unit price.
 *
 * A fixed decimal count cannot serve both 0.0167 BTC and 1,842 shares: two
 * decimals renders the former "0.02" (a 20% misstatement) and the latter with
 * pointless noise. Precision therefore scales with magnitude.
 */
function formatQuantity(q: number): string {
  const digits = q >= 100 ? 0 : q >= 1 ? 2 : q >= 0.01 ? 4 : 6;
  return q.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** One ranked recommendation: rank, sizing, measured deltas, and — expanded —
 * the alternatives actually simulated for the same slot (Step 10). */
export function RecommendationRow({
  item,
  selected,
  onToggle,
}: {
  item: NarratedItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface/40 p-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-0.5 accent-brand"
          aria-label={`Include ${item.symbol ?? item.name} in the plan`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] font-semibold text-muted/70">#{item.rank}</span>
                {item.symbol && <span className="font-mono text-sm font-semibold text-foreground">{item.symbol}</span>}
                <Badge variant="neutral">{item.assetClassLabel}</Badge>
                {/* Same definition, same wording as the Decision Center — this used
                    to be the holding's own score confidence, absent entirely for any
                    candidate the portfolio didn't already own. */}
                <span
                  className="cursor-help text-[10px] text-muted/70 underline decoration-dotted decoration-muted/30 underline-offset-2"
                  title={`Confidence ${item.confidence}% — how much of the evidence behind this item's numbers was observed rather than assumed.\n\n${item.confidenceBasis.map((b) => `• ${b}`).join("\n")}`}
                >
                  {item.confidence}% evidenced
                </span>
              </span>
              <span className="truncate text-[11px] text-muted">{item.name}</span>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                {formatCurrency(item.dollarAmount)}
              </span>
              {/* The quantity the executor will actually record, at a precision
                  that keeps quantity × price reconcilable with the dollar amount
                  beside it. Previously this floored to whole shares while the
                  ledger wrote the fractional figure, so "$1,000 · 3 sh" described
                  $903, and a $1,000 allocation to BTC read "0 sh". */}
              <span className="font-mono text-[10px] tabular-nums text-muted">
                {item.quantity != null ? `${formatQuantity(item.quantity)} ${UNIT_ABBR[item.unit] ?? item.unit} · ` : ""}
                → {item.resultingWeight.toFixed(1)}%
              </span>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted">{item.impactSentence}</p>
          <p className="text-[11px] leading-relaxed text-muted/70">{item.reason}</p>

          {item.alternatives.length > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="self-start text-[11px] text-brand hover:underline"
            >
              {expanded ? "Hide" : "Show"} {item.alternatives.length} alternative{item.alternatives.length === 1 ? "" : "s"} considered
            </button>
          )}

          {expanded && (
            <ul className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/50 p-2">
              {item.alternatives.map((alt) => (
                <li key={`${alt.symbol}-${alt.name}`} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 text-foreground">
                    {alt.symbol && <span className="font-mono font-medium">{alt.symbol}</span>}
                    <span className="text-muted">{alt.name}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-muted">{alt.relativeScorePct}%</span>
                    <span className="text-muted/70">{alt.reasonLabel}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
