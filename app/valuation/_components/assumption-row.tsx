"use client";

import { useState } from "react";
import { formatCompactCurrency } from "@/lib/format";
import { DATA_SOURCES } from "@/lib/provenance";
import {
  ASSUMPTION_LABEL,
  RATE_ASSUMPTIONS,
  type Assumption,
  type AssumptionKey,
} from "@/lib/valuation/case";
import {
  formatAmountShorthand,
  isValidPercentInput,
  parseAmount,
} from "@/lib/valuation/dcf";

/**
 * One assumption, as a value plus where it came from and why.
 *
 * The rationale field is the point. A slider alone keeps the number and throws
 * away the reasoning, which is backwards: in twelve months the number is
 * worthless and the reasoning is the entire asset. So the slider is secondary,
 * shown inside the expanded row and anchored on what the business delivered,
 * what peers do, and what today's price would justify — a number is never
 * presented context-free.
 */

const SLIDER_RANGE: Partial<Record<AssumptionKey, { min: number; max: number; step: number }>> = {
  growthRate1: { min: -25, max: 40, step: 0.1 },
  growthRate2: { min: -25, max: 40, step: 0.1 },
  terminalGrowth: { min: 0, max: 5, step: 0.1 },
  discountRate: { min: 4, max: 20, step: 0.1 },
};

/** Human label for where a value came from. */
function sourceLabel(source: Assumption["source"]): string {
  if (source in DATA_SOURCES) return DATA_SOURCES[source as keyof typeof DATA_SOURCES].short;
  switch (source) {
    case "reverse_dcf": return "Market-implied";
    case "ai": return "AI";
    case "user": return "You";
    case "peer_median": return "Peers";
    case "history": return "History";
    default: return "Default";
  }
}

function formatValue(key: AssumptionKey, value: number, currency: string): string {
  if (RATE_ASSUMPTIONS.has(key)) return `${value.toFixed(1)}%`;
  if (key === "sharesOutstanding") return formatAmountShorthand(value);
  return formatCompactCurrency(value, currency);
}

interface Props {
  assumptionKey: AssumptionKey;
  assumption: Assumption;
  currency: string;
  saving: boolean;
  onCommit: (value: number, rationale: string | null) => void;
}

export function AssumptionRow({ assumptionKey, assumption, currency, saving, onCommit }: Props) {
  const isRate = RATE_ASSUMPTIONS.has(assumptionKey);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => (isRate ? String(assumption.value) : formatAmountShorthand(assumption.value)));
  const [rationale, setRationale] = useState(assumption.rationale ?? "");

  // The draft is seeded from the saved value only. When the saved value changes
  // underneath (a save landing, or an AI refresh), the parent remounts this row
  // via its key, which re-seeds the draft — no effect needed, and typing is
  // never interrupted because an unsaved edit does not change the saved value.

  const parsed = isRate ? Number(draft.trim()) : parseAmount(draft);
  const valid = isRate ? isValidPercentInput(draft) && draft.trim() !== "" : Number.isFinite(parsed);
  const dirty = valid && (parsed !== assumption.value || rationale !== (assumption.rationale ?? ""));
  const range = SLIDER_RANGE[assumptionKey];

  const anchors: [string, number | undefined][] = [
    ["Price implies", assumption.anchors.impliedByMarket],
    ["Delivered", assumption.anchors.hist5y],
    ["Peer median", assumption.anchors.peerMedian],
    ["Engine p50", assumption.anchors.engineP50],
  ];
  const shownAnchors = anchors.filter((a): a is [string, number] => a[1] != null);

  function commit() {
    if (!valid || !dirty) return;
    onCommit(parsed, rationale.trim() === "" ? null : rationale.trim());
    setOpen(false);
  }

  function reset() {
    setDraft(isRate ? String(assumption.value) : formatAmountShorthand(assumption.value));
    setRationale(assumption.rationale ?? "");
    setOpen(false);
  }

  return (
    <div className={`rounded-lg border ${assumption.locked ? "border-brand/30 bg-brand/[0.03]" : "border-border bg-surface"}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            {ASSUMPTION_LABEL[assumptionKey]}
            <span className={`rounded px-1 py-px text-[10px] font-normal ${
              assumption.locked ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted"
            }`}>
              {sourceLabel(assumption.source)}
            </span>
          </span>
          {assumption.rationale ? (
            <span className="truncate text-[11px] leading-4 text-muted">{assumption.rationale}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-sm font-semibold">
            {formatValue(assumptionKey, assumption.value, currency)}
          </span>
          <span className="text-[10px] text-muted">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {/* An objection to a value the user owns. Never a replacement for it. */}
      {assumption.locked && assumption.critique ? (
        <p className="mx-3 mb-2 rounded border border-warning/30 bg-warning/5 px-2 py-1 text-[11px] leading-4 text-warning">
          AI disagrees: {assumption.critique}
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode={isRate ? "decimal" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") reset(); }}
              className={`w-28 rounded border px-2 py-1 font-mono text-sm outline-none focus:border-brand ${
                valid ? "border-border bg-surface-2" : "border-negative/60 bg-negative/5"
              }`}
            />
            <span className="text-xs text-muted">{isRate ? "%" : currency}</span>
            {range ? (
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={Number.isFinite(parsed) ? parsed : assumption.value}
                onChange={(e) => setDraft(e.target.value)}
                className="min-w-0 flex-1 accent-[var(--brand)]"
                aria-label={`${ASSUMPTION_LABEL[assumptionKey]} slider`}
              />
            ) : null}
          </div>

          {shownAnchors.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
              {shownAnchors.map(([label, value]) => (
                <button
                  key={label}
                  onClick={() => setDraft(String(Number(value.toFixed(1))))}
                  className="hover:text-brand"
                  title={`Use ${label.toLowerCase()}`}
                >
                  {label}{" "}
                  <span className="font-mono text-foreground/70">
                    {isRate ? `${value.toFixed(1)}%` : formatValue(assumptionKey, value, currency)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">
              Why — the part still worth reading in a year
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              placeholder="e.g. Services is 62% of revenue growing 13%; hardware flat."
              className="resize-none rounded border border-border bg-surface-2 px-2 py-1 text-xs outline-none placeholder:text-muted focus:border-brand"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              disabled={!dirty || saving}
              className="rounded bg-brand-strong px-3 py-1 text-xs font-medium text-background disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={reset} className="rounded border border-border px-3 py-1 text-xs hover:bg-surface-2">
              Cancel
            </button>
            {!valid ? <span className="text-[11px] text-negative">Enter a number</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
