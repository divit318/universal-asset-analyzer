"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, TrendingUp } from "lucide-react";
import type { SymbolSuggestion } from "@/lib/types";
import { ALL_TOOLS } from "./nav-config";

/* Event other components dispatch to open the palette (e.g. the header button). */
export const OPEN_PALETTE_EVENT = "uaa:open-palette";

type Item =
  | { kind: "ticker"; symbol: string; name: string; sub: string }
  | { kind: "tool"; href: string; label: string; desc: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; objective: string };

/** Global ⌘K command palette — jump to any ticker's research or any tool. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tickers, setTickers] = useState<SymbolSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setTickers([]);
    setActive(0);
  }, []);

  // Open via ⌘K / Ctrl+K, or a custom event; close via Escape (handled below).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  // Focus the input and lock body scroll when opening.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // Debounced ticker search. The clear-on-empty happens inside the timeout
  // (async), so we never call setState synchronously in the effect body.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (q.length < 1) {
        if (!cancelled) setTickers([]);
        return;
      }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (!cancelled) setTickers(((json.results as SymbolSuggestion[]) ?? []).slice(0, 6));
      } catch {
        if (!cancelled) setTickers([]);
      }
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, open]);

  // Tools filtered by the query.
  const toolMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_TOOLS;
    return ALL_TOOLS.filter((t) =>
      [t.label, t.desc, t.objective, ...(t.keywords ?? [])].join(" ").toLowerCase().includes(q),
    );
  }, [query]);

  // Combined, ordered item list: matching tickers first, then tools.
  const items = useMemo<Item[]>(() => {
    const tk: Item[] = tickers.map((t) => ({
      kind: "ticker",
      symbol: t.symbol,
      name: t.name,
      sub: [t.type, t.exchange].filter(Boolean).join(" · "),
    }));
    const tl: Item[] = toolMatches.map((t) => ({
      kind: "tool",
      href: t.href,
      label: t.label,
      desc: t.desc,
      icon: t.icon,
      objective: t.objective,
    }));
    return [...tk, ...tl];
  }, [tickers, toolMatches]);

  const go = useCallback(
    (item: Item) => {
      close();
      if (item.kind === "ticker") router.push(`/research?symbol=${encodeURIComponent(item.symbol)}`);
      else router.push(item.href);
    },
    [close, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a <= 0 ? items.length - 1 : a - 1) : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active] ?? items[0];
      if (item) go(item);
    }
  };

  // Scroll the active row into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open || typeof document === "undefined") return null;

  let idx = -1;
  const showTickerHeader = items.some((i) => i.kind === "ticker");
  const firstToolIdx = items.findIndex((i) => i.kind === "tool");

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[200] flex items-start justify-center p-4 pt-[12vh]"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div
        style={{ animation: "dialog-enter 150ms var(--ease-out)" }}
        className="relative w-full max-w-xl overflow-hidden rounded-panel border border-border bg-surface shadow-popover"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search a ticker or jump to a tool…"
            className="w-full bg-transparent py-4 text-sm outline-none placeholder:text-faint"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-micro font-medium text-muted sm:inline">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted">No matches for “{query}”.</p>
          )}

          {showTickerHeader && (
            <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-widest text-faint">Tickers</p>
          )}

          {items.map((item) => {
            idx += 1;
            const i = idx;
            const isActive = i === active;
            if (item.kind === "ticker") {
              return (
                <button
                  key={`t-${item.symbol}`}
                  data-idx={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors ${
                    isActive ? "bg-surface-3" : ""
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-brand-muted text-brand">
                    <TrendingUp className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold">{item.symbol}</span>
                    <span className="truncate text-xs text-muted">{item.name}</span>
                  </span>
                  <span className="shrink-0 text-micro text-faint">{item.sub}</span>
                  {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted" />}
                </button>
              );
            }
            const Icon = item.icon;
            return (
              <div key={`tool-${item.href}`}>
                {i === firstToolIdx && (
                  <p className="px-3 pb-1 pt-3 text-micro font-semibold uppercase tracking-widest text-faint">Go to</p>
                )}
                <button
                  data-idx={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors ${
                    isActive ? "bg-surface-3" : ""
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-muted">
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="truncate text-xs text-muted">{item.desc}</span>
                  </span>
                  <span className="shrink-0 text-micro uppercase tracking-wide text-faint">{item.objective}</span>
                  {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
