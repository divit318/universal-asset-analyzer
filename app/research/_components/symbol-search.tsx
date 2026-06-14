"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SymbolSuggestion } from "@/lib/types";

interface Props {
  /** Controlled text value of the input. */
  value: string;
  onChange: (value: string) => void;
  /** Fired when the user commits a symbol (pick from list or submit raw text). */
  onSelect: (symbol: string) => void;
  loading?: boolean;
}

/**
 * Debounced ticker / company-name typeahead. Hits /api/search as the user types
 * and lets them pick with the mouse or arrow keys. Submitting raw text still
 * works, so power users can type "AAPL ⏎" without waiting for suggestions.
 */
export function SymbolSearch({ value, onChange, onSelect, loading }: Props) {
  const [items, setItems] = useState<SymbolSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Debounced fetch. A request token guards against out-of-order responses.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 1) {
      // Clearing the list when the query empties is a direct sync of derived
      // state to the input, which is exactly what we want here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (cancelled) return;
        setItems((json.results as SymbolSuggestion[]) ?? []);
        setActive(-1);
      } catch {
        if (!cancelled) setItems([]);
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function commit(symbol: string) {
    setOpen(false);
    onChange(symbol);
    onSelect(symbol);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) {
      if (e.key === "Enter") commit(value);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(active >= 0 ? items[active].symbol : value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative flex-1">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => value.trim() && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search ticker or name — e.g. AAPL, Apple, Nvidia"
        className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
        aria-label="Search ticker or company name"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
      />
      {open && items.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-border bg-surface shadow-xl"
        >
          {items.map((it, i) => (
            <li
              key={it.symbol}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                // mousedown (not click) so it fires before the input blurs.
                e.preventDefault();
                commit(it.symbol);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                i === active ? "bg-surface-2" : ""
              }`}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono font-semibold text-accent">{it.symbol}</span>
                <span className="truncate text-muted">{it.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted">
                {[it.type, it.exchange].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {loading ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          …
        </span>
      ) : null}
    </div>
  );
}
