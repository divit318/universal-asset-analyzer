"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SymbolSuggestion } from "@/lib/types";
import { LoadingMark } from "@/app/_components/loading-mark";

interface Props {
  /** Controlled text value of the input. */
  value: string;
  onChange: (value: string) => void;
  /** Fired when the user commits a symbol (pick from list or submit raw text). */
  onSelect: (symbol: string) => void;
  loading?: boolean;
  placeholder?: string;
  /**
   * "rich" renders a two-line result (flag + company name, then ticker · exchange)
   * for global-search contexts where disambiguating listings across markets
   * matters. Default "compact" keeps the existing single-line row unchanged.
   */
  variant?: "compact" | "rich";
}

/**
 * Suggestions already fetched this document lifetime, keyed by the trimmed
 * lowercase query.
 *
 * Typing one ticker is not one request: "MICRON" is six distinct prefixes, and
 * at 160 ms of debounce against ~200 ms/char a normal typist fires most of them.
 * Measured against /api/search — a prefix the server has not seen costs 0.54 to
 * 1.19 s (a Yahoo round-trip), the same prefix again costs 10 to 22 ms (the
 * platform's 10-minute `search` dataset). So the server cache already handles
 * repetition ACROSS searches; what it cannot help with is the within-search
 * case that actually happens on camera — backspacing a character, or retyping a
 * symbol looked at a minute ago — because each keystroke still pays a full
 * network round-trip to learn what we already knew.
 *
 * Module scope, not component state: the search box unmounts on every route
 * change, and a cache that dies with it would miss the exact repeat visits it
 * exists to serve. Bounded because an unbounded typeahead cache on a
 * long-running SPA is a memory leak with extra steps.
 */
const suggestionCache = new Map<string, SymbolSuggestion[]>();
const SUGGESTION_CACHE_MAX = 120;

function readSuggestionCache(q: string): SymbolSuggestion[] | undefined {
  const hit = suggestionCache.get(q);
  // Re-insert to move this key to the most-recently-used end of the Map.
  if (hit) {
    suggestionCache.delete(q);
    suggestionCache.set(q, hit);
  }
  return hit;
}

function writeSuggestionCache(q: string, results: SymbolSuggestion[]): void {
  suggestionCache.set(q, results);
  while (suggestionCache.size > SUGGESTION_CACHE_MAX) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest === undefined) break;
    suggestionCache.delete(oldest);
  }
}

/**
 * Debounced ticker / company-name typeahead. Hits /api/search as the user types
 * and lets them pick with the mouse or arrow keys. Submitting raw text still
 * works, so power users can type "AAPL ⏎" without waiting for suggestions.
 */
export function SymbolSearch({ value, onChange, onSelect, loading, placeholder, variant = "compact" }: Props) {
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

    // A prefix we have already resolved paints with no network and no debounce.
    // Backspacing through a symbol is the common case this serves, and waiting
    // 160 ms to re-display a list we are already holding is pure latency.
    const cached = readSuggestionCache(q.toLowerCase());
    if (cached) {
      setItems(cached);
      setActive(-1);
      return;
    }

    let cancelled = false;
    // Abort supersedes the request rather than only ignoring its result. The
    // `cancelled` flag alone left every stale keystroke's fetch running to
    // completion, so typing six characters queued six Yahoo round-trips and the
    // one query the user actually cared about waited behind the five it had
    // already replaced.
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = await res.json();
        if (cancelled) return;
        const results = (json.results as SymbolSuggestion[]) ?? [];
        writeSuggestionCache(q.toLowerCase(), results);
        setItems(results);
        setActive(-1);
      } catch {
        // An abort is the expected path for every superseded keystroke, not a
        // failure — clearing the list on it would blank the dropdown mid-type.
        if (!cancelled && !ctrl.signal.aborted) setItems([]);
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      ctrl.abort();
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
        placeholder={placeholder ?? "Search ticker or name — e.g. AAPL, Reliance, HDFCBANK.NS"}
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
          {items.map((it, i) =>
            variant === "rich" ? (
              <li
                key={it.symbol}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(it.symbol);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer flex-col gap-0.5 px-4 py-2.5 text-sm ${
                  i === active ? "bg-surface-2" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="shrink-0 text-base leading-none" aria-hidden="true">
                    {it.country?.flag ?? "🌐"}
                  </span>
                  <span className="truncate font-medium text-foreground">{it.name}</span>
                </span>
                <span className="pl-6 text-xs text-muted">
                  <span className="font-mono font-semibold text-accent">{it.symbol}</span>
                  {(it.exchange ?? it.type) && (
                    <>
                      <span className="mx-1.5">·</span>
                      {it.exchange ?? it.type}
                    </>
                  )}
                </span>
              </li>
            ) : (
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
            ),
          )}
        </ul>
      ) : null}
      {loading ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">
          <LoadingMark size={16} label="Searching" />
        </span>
      ) : null}
    </div>
  );
}
