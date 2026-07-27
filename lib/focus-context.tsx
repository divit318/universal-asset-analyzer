"use client";

/**
 * Focus-symbol spine — the app-level context (§4.4, Phase C).
 *
 * Carries the user's working set of symbols across tools: the last 5 they acted
 * on (searched in ⌘K, opened in a symbolParam tool, clicked through from a
 * queue/radar card), most-recent first, deduped. Persisted in **sessionStorage**
 * so it survives a reload within the session but does not accumulate forever —
 * a working set is transient by nature.
 *
 * Deliberately a *separate*, tiny provider rather than an extension of
 * `lib/ios-context.tsx`: the IOS context already tracks `recentlyResearched`,
 * but in localStorage, capped at 20, and scoped to research only. The focus
 * spine has different persistence (session), a different cap (5), and a broader
 * "acted on" trigger — folding it into IOS would conflate two features and drag
 * the lightweight spine behind IOS's heavy portfolio-report machinery. The list
 * mechanics live in the pure, unit-tested `lib/focus.ts`; this file only owns
 * React state and storage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { normalizeSymbol } from "@/lib/market";
import { pushFocusSymbol, sanitizeFocusList } from "@/lib/focus";

const STORAGE_KEY = "uaa_focus_symbols";

export interface FocusContextValue {
  /** Most-recent first, deduped, capped at 5. */
  symbols: string[];
  /** Convenience: the symbol to prefill a tool with. Null when the spine is empty. */
  mostRecent: string | null;
  /** Record a symbol as the newest focus. A side effect of navigation the user
   *  already performs — never its own UI action. */
  recordFocus: (symbol: string) => void;
}

const FocusCtx = createContext<FocusContextValue | null>(null);

function loadFromSession(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeFocusList(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function FocusProvider({ children }: { children: ReactNode }) {
  // Start empty (server + first client render match), then hydrate from session
  // after mount — sessionStorage is client-only, so reading it during render
  // would risk an SSR/CSR mismatch.
  const [symbols, setSymbols] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSymbols(loadFromSession());
  }, []);

  const recordFocus = useCallback((symbol: string) => {
    const sym = normalizeSymbol(symbol);
    if (!sym) return; // reuse the app's single symbol-validation gate — no junk in the spine
    setSymbols((prev) => {
      const next = pushFocusSymbol(prev, sym);
      // Already the newest and unchanged — skip the write and the re-render.
      if (prev.length === next.length && prev.every((s, i) => s === next[i])) return prev;
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode / quota — the spine is best-effort, never fatal */
      }
      return next;
    });
  }, []);

  const value = useMemo<FocusContextValue>(
    () => ({ symbols, mostRecent: symbols[0] ?? null, recordFocus }),
    [symbols, recordFocus],
  );

  return <FocusCtx.Provider value={value}>{children}</FocusCtx.Provider>;
}

/** Throws outside the provider — for the core surfaces (palette) that require it. */
export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusCtx);
  if (!ctx) throw new Error("useFocus must be used inside FocusProvider");
  return ctx;
}

/** Returns null outside the provider — for pages that want to degrade gracefully. */
export function useFocusSafe(): FocusContextValue | null {
  return useContext(FocusCtx);
}
