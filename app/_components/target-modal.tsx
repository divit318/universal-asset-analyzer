"use client";

/**
 * The price-target editor.
 *
 * Three things it does that the previous version did not:
 *
 * 1. **Shows the live price and the resulting upside while you type.** A target
 *    is only meaningful relative to today's price, and typing one into an empty
 *    box meant doing `(200 − 169.02) / 169.02` in your head to find out whether
 *    you had just asked for 18% or 80%.
 *
 * 2. **Records which way the target points.** `above` is a valuation/exit level,
 *    `below` a buy limit. This is the field that reconciles the notification
 *    engine with this page — see `lib/watchlist-metrics.ts`. The direction is
 *    pre-selected from where the price actually is, so the common case needs no
 *    thought, but it is always visible and always overridable.
 *
 * 3. **Refuses to save a target that cannot be one.** 0, negatives and NaN were
 *    all storable before, and a stored 0 divided into the old upside formula as
 *    `+Infinity%`.
 */

import { useMemo, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { useFreshQuote } from "@/app/_components/use-fresh-quote";
import { formatCurrency, formatPercent, toneClass } from "@/lib/format";
import {
  isUsablePrice,
  suggestTargetDirection,
  upsidePercent,
} from "@/lib/watchlist-metrics";
import type { TargetDirection, WatchlistItem } from "@/lib/types";

export interface TargetPatch {
  targetPrice: number | null;
  targetDirection: TargetDirection | null;
  alertPctDrop: number | null;
  /** Rationale for this specific change, stored against the revision. */
  targetNote: string | null;
}

/** The street's view, for reference alongside the user's own number. */
export interface ConsensusReference {
  mean: number | null;
  high: number | null;
  low: number | null;
  opinions: number | null;
}

const DIRECTION_COPY: Record<TargetDirection, { label: string; hint: string }> = {
  above: {
    label: "Rises to or above",
    hint: "A valuation or exit level — tell me when it gets there.",
  },
  below: {
    label: "Falls to or below",
    hint: "A buy limit — tell me when it comes back to my price.",
  },
};

/** Parse a form field into a number, distinguishing "empty" from "invalid". */
function parseField(raw: string): { value: number | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, invalid: false };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

export function TargetModal({
  item,
  consensus,
  onSave,
  onCancel,
}: {
  item: WatchlistItem;
  consensus?: ConsensusReference;
  onSave: (patch: TargetPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const [targetRaw, setTargetRaw] = useState(item.targetPrice != null ? String(item.targetPrice) : "");
  const [dropRaw, setDropRaw] = useState(item.alertPctDrop != null ? String(item.alertPctDrop) : "");
  const [noteRaw, setNoteRaw] = useState("");
  // Only an explicit choice pins the direction. Until then it tracks the price,
  // so moving a target from above the market to below it flips the trigger too
  // instead of silently keeping a now-nonsensical one.
  const [pinnedDirection, setPinnedDirection] = useState<TargetDirection | null>(item.targetDirection);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { quote, loading: quoteLoading } = useFreshQuote(item.symbol, true);
  const price = quote?.price ?? null;
  const currency = quote?.currency ?? "USD";

  const target = parseField(targetRaw);
  const drop = parseField(dropRaw);

  const targetError =
    target.invalid
      ? "Enter a number."
      : target.value != null && !isUsablePrice(target.value)
        ? "A price target has to be greater than zero."
        : null;

  const dropError =
    drop.invalid
      ? "Enter a number."
      : drop.value != null && (drop.value <= 0 || drop.value > 100)
        ? "Enter a percentage between 0 and 100."
        : null;

  const direction: TargetDirection =
    pinnedDirection ?? suggestTargetDirection(target.value, price);

  const upside = useMemo(() => upsidePercent(price, target.value), [price, target.value]);

  const canSave = !targetError && !dropError && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const nextTarget = isUsablePrice(target.value) ? target.value : null;
      await onSave({
        targetPrice: nextTarget,
        // Clearing the target clears its direction; keeping one without a target
        // would leave a trigger with nothing to trigger on.
        targetDirection: nextTarget == null ? null : direction,
        alertPctDrop: dropError == null && drop.value != null ? Math.abs(drop.value) : null,
        targetNote: noteRaw.trim() || null,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save. Try again.");
      setSaving(false);
    }
  }

  /** Set the target to a percentage away from the live price. */
  function quickFill(pct: number) {
    if (!isUsablePrice(price)) return;
    setTargetRaw((price * (1 + pct / 100)).toFixed(2));
    setPinnedDirection(null);
  }

  const quickFills: { label: string; apply: () => void; title: string }[] = [
    { label: "−15%", apply: () => quickFill(-15), title: "15% below the current price" },
    { label: "−10%", apply: () => quickFill(-10), title: "10% below the current price" },
    { label: "+10%", apply: () => quickFill(10), title: "10% above the current price" },
    { label: "+25%", apply: () => quickFill(25), title: "25% above the current price" },
  ];

  return (
    <Dialog open title={`${item.symbol} — Price target & alerts`} onClose={onCancel} className="max-w-md">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        {/* Live anchor. A target means nothing without the price it is relative to. */}
        <div className="flex items-baseline justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
          <span className="text-[11px] uppercase tracking-widest text-muted">Last price</span>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {quoteLoading && price == null ? (
              <span className="inline-block h-4 w-16 animate-pulse rounded bg-surface" />
            ) : (
              formatCurrency(price, currency)
            )}
          </span>
        </div>

        {/* Analyst consensus — reference only.
            Presented as a separate, clearly-attributed block with an explicit
            opt-in action rather than pre-filling the field, because the whole
            point of "My target" is that it is the user's own number. Silently
            seeding it with the street's view would destroy that distinction and
            quietly overwrite a considered figure with a borrowed one. */}
        {consensus && isUsablePrice(consensus.mean) && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] uppercase tracking-widest text-muted">
                Analyst consensus
                {consensus.opinions != null && (
                  <span className="ml-1 normal-case tracking-normal text-muted/60">
                    · {consensus.opinions} analyst{consensus.opinions === 1 ? "" : "s"}
                  </span>
                )}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {formatCurrency(consensus.mean, currency)}
                </span>
                {(() => {
                  const consensusUpside = upsidePercent(price, consensus.mean);
                  return consensusUpside != null ? (
                    <span className={`font-mono text-[11px] tabular-nums ${toneClass(consensusUpside)}`}>
                      {formatPercent(consensusUpside)}
                    </span>
                  ) : null;
                })()}
              </span>
            </div>
            {isUsablePrice(consensus.low) && isUsablePrice(consensus.high) && (
              <p className="font-mono text-[10px] tabular-nums text-muted/70">
                range {formatCurrency(consensus.low, currency)} – {formatCurrency(consensus.high, currency)}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setTargetRaw(consensus.mean!.toFixed(2));
                setPinnedDirection(null);
              }}
              className="self-start rounded-control border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-foreground"
            >
              Use consensus as my target
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="wl-target" className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-foreground">My price target</span>
            <span className="text-[11px] text-muted">
              Your own number, not the analyst consensus. Research shows that separately as
              “Mean target”.
            </span>
          </label>
          <input
            id="wl-target"
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={targetRaw}
            onChange={(e) => setTargetRaw(e.target.value)}
            aria-invalid={targetError != null}
            aria-describedby={targetError ? "wl-target-error" : "wl-target-upside"}
            placeholder={isUsablePrice(price) ? (price * 1.2).toFixed(2) : "e.g. 200.00"}
            className={`rounded-lg border bg-surface-2 px-3 py-2 font-mono text-sm tabular-nums outline-none placeholder:text-muted/60 ${
              targetError ? "border-negative focus:border-negative" : "border-border focus:border-brand"
            }`}
          />

          {targetError ? (
            <p id="wl-target-error" role="alert" className="text-[11px] text-negative">
              {targetError}
            </p>
          ) : (
            <p id="wl-target-upside" className="min-h-4 text-[11px] text-muted">
              {upside != null ? (
                <>
                  <span className={`font-mono font-semibold tabular-nums ${toneClass(upside)}`}>
                    {formatPercent(upside)}
                  </span>{" "}
                  upside from {formatCurrency(price, currency)}
                </>
              ) : target.value != null && price == null ? (
                "Upside will appear once a live price is available."
              ) : (
                "Leave blank to remove the target."
              )}
            </p>
          )}

          {isUsablePrice(price) && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {quickFills.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={q.apply}
                  title={q.title}
                  className="rounded-control border border-border px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-foreground"
                >
                  {q.label}
                </button>
              ))}
              {isUsablePrice(quote?.fiftyTwoWeekHigh) && (
                <button
                  type="button"
                  onClick={() => {
                    setTargetRaw(quote!.fiftyTwoWeekHigh!.toFixed(2));
                    setPinnedDirection(null);
                  }}
                  title={`52-week high, ${formatCurrency(quote!.fiftyTwoWeekHigh, currency)}`}
                  className="rounded-control border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-foreground"
                >
                  52W high
                </button>
              )}
              {isUsablePrice(quote?.fiftyTwoWeekLow) && (
                <button
                  type="button"
                  onClick={() => {
                    setTargetRaw(quote!.fiftyTwoWeekLow!.toFixed(2));
                    setPinnedDirection(null);
                  }}
                  title={`52-week low, ${formatCurrency(quote!.fiftyTwoWeekLow, currency)}`}
                  className="rounded-control border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-foreground"
                >
                  52W low
                </button>
              )}
            </div>
          )}
        </div>

        {/* Direction. Only meaningful with a target, so it hides without one. */}
        {isUsablePrice(target.value) && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-foreground">Alert me when the price</legend>
            <div className="grid gap-1.5">
              {(["above", "below"] as const).map((dir) => (
                <label
                  key={dir}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                    direction === dir
                      ? "border-brand/50 bg-brand/5"
                      : "border-border hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="radio"
                    name="wl-direction"
                    value={dir}
                    checked={direction === dir}
                    onChange={() => setPinnedDirection(dir)}
                    className="mt-0.5 accent-[var(--brand-strong,currentColor)]"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium">{DIRECTION_COPY[dir].label}</span>
                    <span className="text-[11px] leading-snug text-muted">{DIRECTION_COPY[dir].hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label htmlFor="wl-drop" className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-foreground">Single-day drop alert</span>
            <span className="text-[11px] text-muted">
              Fires when today&apos;s session decline exceeds this percentage. Measured against the
              previous close, not against your cost.
            </span>
          </label>
          <div className="relative">
            <input
              id="wl-drop"
              type="number"
              step="0.5"
              min="0"
              max="100"
              inputMode="decimal"
              value={dropRaw}
              onChange={(e) => setDropRaw(e.target.value)}
              aria-invalid={dropError != null}
              aria-describedby={dropError ? "wl-drop-error" : undefined}
              placeholder="e.g. 5"
              className={`w-full rounded-lg border bg-surface-2 px-3 py-2 pr-8 font-mono text-sm tabular-nums outline-none placeholder:text-muted/60 ${
                dropError ? "border-negative focus:border-negative" : "border-border focus:border-brand"
              }`}
            />
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-2 text-sm text-muted">
              %
            </span>
          </div>
          {dropError && (
            <p id="wl-drop-error" role="alert" className="text-[11px] text-negative">
              {dropError}
            </p>
          )}
        </div>

        {/* Why this target changed. Only offered when there is a previous target
            to change — on a first-time target there is no revision to explain,
            and the field would just be an empty box to skip past. Stored on the
            revision row, not on the item. */}
        {item.targetPrice != null && isUsablePrice(target.value) && target.value !== item.targetPrice && (
          <div className="flex flex-col gap-1 border-t border-border pt-4">
            <label htmlFor="wl-target-note" className="text-xs font-medium text-foreground">
              Why the change? <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="wl-target-note"
              value={noteRaw}
              onChange={(e) => setNoteRaw(e.target.value)}
              maxLength={280}
              placeholder="Q3 margin miss — cutting the multiple"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted/60 focus:border-brand"
            />
            <p className="text-[11px] text-muted">
              Kept with this revision in the name&apos;s target history, so a drifting thesis is
              visible later.
            </p>
          </div>
        )}

        {saveError && (
          <p role="alert" className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">
            {saveError}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!canSave}
            className="flex-1 rounded-lg bg-brand-strong py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
