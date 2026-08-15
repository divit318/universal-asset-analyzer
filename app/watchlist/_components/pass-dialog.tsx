"use client";

/**
 * Passing on an idea — a real decision, recorded like one.
 *
 * One click on a reason, an optional sentence, done. The server (`passIdea`)
 * stores the judgment and writes a CLOSED journal entry carrying the reason,
 * so "why did I walk away?" survives long after the row has left the active
 * list. "Other" requires the sentence — an unexplained pass is the one thing
 * this dialog exists to prevent.
 */

import { useState } from "react";
import { Dialog } from "@/app/_components/dialog";

export const PASS_REASONS = [
  "No valuation edge",
  "Thesis broken",
  "Too risky",
  "Doesn't fit the portfolio",
  "Better opportunity elsewhere",
  "Catalyst passed",
  "No longer interested",
  "Other",
] as const;

export function PassDialog({
  symbol,
  name,
  onConfirm,
  onCancel,
}: {
  symbol: string;
  name: string;
  /** Resolves when persisted; the dialog handles its own submitting state. */
  onConfirm: (reason: string, note: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNote = reason === "Other";
  const canConfirm = reason != null && (!needsNote || note.trim().length > 0) && !submitting;

  const confirm = async () => {
    if (!canConfirm || reason == null) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason, note.trim() || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record the pass");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Pass on ${symbol}`}
      description={`${name} leaves the active list. The reason is journaled, and the idea can be reconsidered later.`}
    >
      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Reason" className="flex flex-wrap gap-1.5">
          {PASS_REASONS.map((r) => {
            const active = reason === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={active}
                onClick={() => setReason(active ? null : r)}
                className={`rounded-control border px-2.5 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {r}
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-semibold uppercase tracking-widest text-muted/60">
            {needsNote ? "Why (required)" : "Add a sentence (optional)"}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={280}
            placeholder="In your own words — future you is the reader."
            className="w-full resize-none rounded-control border border-border bg-surface px-2.5 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-brand focus:outline-none"
          />
        </label>

        {error ? <p className="text-xs text-negative">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-control border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!canConfirm}
            className="rounded-control border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Recording…" : "Pass & journal it"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
