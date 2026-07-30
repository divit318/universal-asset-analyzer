"use client";

/**
 * The per-name thesis editor.
 *
 * Kept deliberately plain, with two additions over the original: ⌘/Ctrl+Enter
 * saves without reaching for the mouse (this is a box a user types in dozens of
 * times a week), and a failed write surfaces instead of being swallowed by a
 * success toast.
 */

import { useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import type { WatchlistItem } from "@/lib/types";

export function NotesModal({
  item,
  onSave,
  onCancel,
}: {
  item: WatchlistItem;
  onSave: (notes: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = (item.notes ?? "") !== notes;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(notes.trim() || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog open title={`${item.symbol} — Thesis & notes`} onClose={onCancel} className="max-w-md">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <label htmlFor="wl-notes" className="text-xs text-muted">
          Why you&apos;re watching this, the levels that matter, the catalyst you&apos;re waiting for.
        </label>
        <textarea
          id="wl-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          rows={6}
          autoFocus
          placeholder="Waiting for the Q3 print to confirm margin recovery. Adds below $140."
          className="resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted/60 focus:border-brand"
        />
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>{notes.trim().length > 0 ? `${notes.trim().length} characters` : "Empty removes the note"}</span>
          <span className="text-muted/60">⌘↵ to save</span>
        </div>

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
            {saving ? "Saving…" : dirty ? "Save notes" : "No changes"}
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
