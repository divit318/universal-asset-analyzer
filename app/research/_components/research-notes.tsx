"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResearchNote } from "@/lib/types";

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ResearchNotes({ symbol }: { symbol: string }) {
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes?symbol=${encodeURIComponent(symbol)}`);
      const json = await res.json();
      if (res.ok) setNotes(json.notes as ResearchNote[]);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
     
    setNotes([]);
    void load();
  }, [load]);

  async function remove(id: number) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notes?id=${id}`, { method: "DELETE" });
  }

  if (loading) return null;
  if (notes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-medium">Saved Notes</h2>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
          {notes.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.id} className="card-lift group relative rounded-xl border border-border bg-surface p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.content}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{timeAgo(note.createdAt)}</span>
              <button
                onClick={() => void remove(note.id)}
                className="text-xs text-muted opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Standalone save-note button — placed inside the copilot per message. */
export function SaveNoteButton({
  symbol,
  content,
  onSaved,
}: {
  symbol: string;
  content: string;
  onSaved?: () => void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  async function save() {
    if (state !== "idle") return;
    setState("saving");
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, content }),
      });
      setState("saved");
      onSaved?.();
      setTimeout(() => setState("idle"), 3000);
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      onClick={() => void save()}
      disabled={state !== "idle"}
      title="Save this analysis as a note"
      className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
        state === "saved"
          ? "border-positive/30 bg-positive/10 text-positive"
          : "border-border bg-surface text-muted hover:border-accent hover:text-accent"
      } disabled:opacity-60`}
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "✓ Saved" : "Save note"}
    </button>
  );
}
