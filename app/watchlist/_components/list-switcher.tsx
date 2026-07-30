"use client";

/**
 * The named-watchlist switcher.
 *
 * Rendered as tabs rather than a dropdown because switching lists is the most
 * frequent action on this page once more than one exists, and a `<select>` costs
 * two interactions and hides the set. Each tab shows its own count, so "which of
 * my lists has anything in it" is answerable without clicking.
 *
 * Membership is exclusive to neither list: the same symbol can sit in several,
 * because a symbol's research state (target, thesis, stage) is stored once and
 * the lists are views over it. That is why removing a name from a list is worded
 * "Remove from this list" and only deletes the underlying research when it was
 * the last list holding it.
 */

import { useEffect, useRef, useState } from "react";
import type { WatchlistGroup } from "@/lib/types";

interface Props {
  groups: WatchlistGroup[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDuplicate: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReorder: (orderedIds: number[]) => Promise<void>;
  onSetBenchmark: (id: number, benchmark: string | null) => Promise<void>;
}

export function ListSwitcher({
  groups,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
  onSetBenchmark,
}: Props) {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);
  /** The open menu and its trigger, so an inside click is not read as an outside one. */
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (editing) editRef.current?.select();
  }, [editing]);
  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  /**
   * Dismiss the per-list menu on Escape or an outside click, same contract — and
   * same containment test — as the table's row menu.
   *
   * Deciding "outside" by element containment rather than by having the menu call
   * `stopPropagation`: React binds its listeners to the app root, so a synthetic
   * stopPropagation does not reliably stop a `document` listener, and when it does
   * not the menu closes on `pointerdown` before the `click` that would have run
   * Rename / Duplicate / Delete ever fires.
   */
  useEffect(() => {
    if (menuFor == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuFor(null); };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target))) return;
      setMenuFor(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuFor]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setMenuFor(null);
    }
  }

  const active = groups.find((g) => g.id === activeId) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label="Watchlists" className="flex flex-wrap items-center gap-1">
        {groups.map((group, index) => {
          const isActive = group.id === activeId;
          const isEditing = editing?.id === group.id;

          if (isEditing) {
            return (
              <form
                key={group.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = editing.value.trim();
                  if (!name) return setEditing(null);
                  void run(async () => {
                    await onRename(group.id, name);
                    setEditing(null);
                  });
                }}
                className="flex items-center gap-1"
              >
                <input
                  ref={editRef}
                  value={editing.value}
                  onChange={(e) => setEditing({ id: group.id, value: e.target.value })}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
                  aria-label={`Rename ${group.name}`}
                  maxLength={60}
                  className="w-40 rounded-lg border border-brand bg-surface px-2.5 py-1.5 text-sm outline-none"
                />
              </form>
            );
          }

          return (
            <span key={group.id} className="relative inline-flex">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(group.id)}
                onDoubleClick={() => setEditing({ id: group.id, value: group.name })}
                title={
                  group.benchmark
                    ? `${group.count} names · benchmarked against ${group.benchmark}. Double-click to rename.`
                    : `${group.count} names. Double-click to rename.`
                }
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span className="max-w-40 truncate">{group.name}</span>
                <span className={`font-mono text-[10px] tabular-nums ${isActive ? "text-brand/70" : "text-muted/60"}`}>
                  {group.count}
                </span>
              </button>
              {isActive && (
                <button
                  type="button"
                  aria-label={`Options for ${group.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === group.id}
                  ref={menuFor === group.id ? menuTriggerRef : undefined}
                  onClick={() => setMenuFor(menuFor === group.id ? null : group.id)}
                  className="ml-0.5 rounded-lg border border-border px-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  ⋯
                </button>
              )}
              {menuFor === group.id && (
                <div
                  role="menu"
                  ref={menuRef}
                  className="absolute right-0 top-full z-30 mt-1 flex min-w-52 animate-popover-in flex-col rounded-panel border border-border bg-surface p-1 shadow-popover"
                >
                  <button
                    role="menuitem"
                    type="button"
                    disabled={busy}
                    onClick={() => { setMenuFor(null); setEditing({ id: group.id, value: group.name }); }}
                    className="rounded-control px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2"
                  >
                    Rename…
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => onDuplicate(group.id, `${group.name} copy`))}
                    className="rounded-control px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2"
                  >
                    Duplicate
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => {
                      const ids = groups.map((g) => g.id);
                      [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                      void run(() => onReorder(ids));
                    }}
                    className="rounded-control px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Move left
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    disabled={busy || index === groups.length - 1}
                    onClick={() => {
                      const ids = groups.map((g) => g.id);
                      [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
                      void run(() => onReorder(ids));
                    }}
                    className="rounded-control px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Move right
                  </button>
                  <span className="my-1 h-px bg-border" />
                  <button
                    role="menuitem"
                    type="button"
                    // The last list cannot be deleted — the page has no coherent
                    // state without one, and the server refuses it anyway.
                    disabled={busy || groups.length <= 1}
                    title={groups.length <= 1 ? "You need at least one watchlist" : undefined}
                    onClick={() => void run(() => onDelete(group.id))}
                    className="rounded-control px-2.5 py-1.5 text-left text-xs text-negative transition-colors hover:bg-negative/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete list
                  </button>
                </div>
              )}
            </span>
          );
        })}

        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = draftName.trim();
              if (!name) { setCreating(false); return; }
              void run(async () => {
                await onCreate(name);
                setDraftName("");
                setCreating(false);
              });
            }}
          >
            <input
              ref={createRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => { if (!draftName.trim()) setCreating(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") { setDraftName(""); setCreating(false); } }}
              placeholder="List name…"
              aria-label="New watchlist name"
              maxLength={60}
              className="w-40 rounded-lg border border-brand bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-muted"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-sm text-muted transition-colors hover:border-brand/40 hover:text-foreground"
          >
            + New list
          </button>
        )}
      </div>

      {/* Benchmark, scoped to the active list. Sits under the tabs rather than
          inside the menu because it changes what the table SHOWS (a column), so
          it belongs in view alongside the data it affects. */}
      {active && (
        <BenchmarkField
          key={active.id}
          groupName={active.name}
          value={active.benchmark}
          onSave={(next) => onSetBenchmark(active.id, next)}
        />
      )}
    </div>
  );
}

function BenchmarkField({
  groupName,
  value,
  onSave,
}: {
  groupName: string;
  value: string | null;
  onSave: (benchmark: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = (value ?? "") !== draft.trim().toUpperCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft.trim() ? draft.trim().toUpperCase() : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the benchmark");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor="wl-benchmark" className="text-muted">
        Benchmark for <span className="text-foreground">{groupName}</span>
      </label>
      <input
        id="wl-benchmark"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. SPY"
        aria-describedby="wl-benchmark-help"
        className="w-24 rounded-control border border-border bg-surface px-2 py-1 font-mono text-xs uppercase outline-none placeholder:text-muted/60 placeholder:normal-case focus:border-brand"
      />
      {dirty && (
        <button
          type="submit"
          disabled={saving}
          className="rounded-control border border-brand/40 bg-brand/10 px-2 py-1 text-xs text-brand transition-colors hover:bg-brand/15 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      )}
      <span id="wl-benchmark-help" className="text-muted/60">
        Adds a “vs {draft.trim().toUpperCase() || "benchmark"}” column comparing each name&apos;s move today.
      </span>
      {error && <span role="alert" className="text-negative">{error}</span>}
    </form>
  );
}
