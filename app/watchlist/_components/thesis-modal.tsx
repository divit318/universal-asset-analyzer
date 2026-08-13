"use client";

/**
 * The per-name thesis editor — the structured successor to the plain notes box.
 *
 * A thesis that can act like a decision needs more than prose: it needs the
 * trigger that would make you buy, the condition that would make you walk away,
 * and an honest record of how sure you are. Those are the four fields here — no
 * more. Everything is optional, everything is the user's own words, and saving
 * anything counts as a review (the server stamps `last_reviewed_at`, which is
 * what the health check and thesis-drift window read).
 *
 * ⌘/Ctrl+Enter saves from any field; a failed write surfaces instead of being
 * swallowed by a success toast.
 */

import { useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import type { Conviction, ThesisHorizon, WatchlistItem } from "@/lib/types";

export interface ThesisPatch {
  notes: string | null;
  buyTrigger: string | null;
  sellTrigger: string | null;
  conviction: Conviction | null;
  horizon: ThesisHorizon | null;
}

const CONVICTIONS: Array<{ value: Conviction; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const HORIZONS: Array<{ value: ThesisHorizon; label: string }> = [
  { value: "short", label: "< 1y" },
  { value: "medium", label: "1–3y" },
  { value: "long", label: "3y+" },
];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-label font-semibold uppercase tracking-widest text-muted/60">{label}</span>
      <div role="group" aria-label={label} className="flex gap-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              // Clicking the active option clears it — "not recorded" stays reachable.
              onClick={() => onChange(active ? null : opt.value)}
              className={`flex-1 rounded-control border px-2 py-1.5 text-xs transition-colors ${
                active
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ThesisModal({
  item,
  onSave,
  onCancel,
}: {
  item: WatchlistItem;
  onSave: (patch: ThesisPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [buyTrigger, setBuyTrigger] = useState(item.buyTrigger ?? "");
  const [sellTrigger, setSellTrigger] = useState(item.sellTrigger ?? "");
  const [conviction, setConviction] = useState<Conviction | null>(item.conviction);
  const [horizon, setHorizon] = useState<ThesisHorizon | null>(item.horizon);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    (item.notes ?? "") !== notes ||
    (item.buyTrigger ?? "") !== buyTrigger ||
    (item.sellTrigger ?? "") !== sellTrigger ||
    item.conviction !== conviction ||
    item.horizon !== horizon;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        notes: notes.trim() || null,
        buyTrigger: buyTrigger.trim() || null,
        sellTrigger: sellTrigger.trim() || null,
        conviction,
        horizon,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
      setSaving(false);
    }
  }

  const saveOnCmdEnter = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Dialog open title={`${item.symbol} — Thesis`} onClose={onCancel} className="max-w-lg">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="wl-thesis" className="text-label font-semibold uppercase tracking-widest text-muted/60">
            Why you&apos;re watching this
          </label>
          <textarea
            id="wl-thesis"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={saveOnCmdEnter}
            rows={4}
            autoFocus
            placeholder="Margin recovery underpriced. Data-center demand is the driver to track."
            className="resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted/60 focus:border-brand"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="wl-buy" className="text-label font-semibold uppercase tracking-widest text-muted/60">
            What would make you buy
          </label>
          <input
            id="wl-buy"
            type="text"
            value={buyTrigger}
            onChange={(e) => setBuyTrigger(e.target.value)}
            onKeyDown={saveOnCmdEnter}
            maxLength={280}
            placeholder="Below $140, or Q3 confirming two quarters of margin expansion."
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted/60 focus:border-brand"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="wl-sell" className="text-label font-semibold uppercase tracking-widest text-muted/60">
            What would change your mind
          </label>
          <input
            id="wl-sell"
            type="text"
            value={sellTrigger}
            onChange={(e) => setSellTrigger(e.target.value)}
            onKeyDown={saveOnCmdEnter}
            maxLength={280}
            placeholder="Data-center revenue decelerating two quarters running."
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted/60 focus:border-brand"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <Segmented label="Conviction" options={CONVICTIONS} value={conviction} onChange={setConviction} />
          <Segmented label="Horizon" options={HORIZONS} value={horizon} onChange={setHorizon} />
        </div>

        <p className="text-[11px] text-muted/60">
          Saving records a review — the &ldquo;last reviewed&rdquo; clock and thesis-drift window reset to now. ⌘↵ to save.
        </p>

        {error && (
          <p role="alert" className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="flex-1 rounded-lg bg-brand-strong py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : dirty ? "Save thesis" : "No changes"}
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
