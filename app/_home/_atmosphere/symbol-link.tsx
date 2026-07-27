"use client";

/**
 * Neural Flow — relationship highlighting across the dashboard.
 *
 * A ticker shows up in several modules at once: the Action Center ranks it, the
 * Opportunity Feed scores it, the brief names it as a mover. On their own those
 * are three unrelated rows. `SymbolLinkRoot` + `SymbolTag` make them one thread:
 * hovering the symbol anywhere marks the root, every other linked symbol
 * recedes, and the matching ones light up — so you *see* that it's the same
 * name being discussed in three places.
 *
 * Presentation only, and defensive by default: the context has a no-op fallback,
 * so a `<SymbolTag>` rendered outside a root simply renders its children. The
 * dim/lift styling lives in globals.css (`.uaa-linkable` / `.uaa-linkmatch` /
 * `[data-linkdim]`).
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface SymbolLinkValue {
  active: string | null;
  setActive: (symbol: string | null) => void;
}

const SymbolLinkContext = createContext<SymbolLinkValue>({
  active: null,
  setActive: () => {},
});

/** Wraps the homepage. Owns which symbol is focused and flags the DOM subtree so
 *  CSS can recede the non-matching threads. */
export function SymbolLinkRoot({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const value = useMemo(() => ({ active, setActive }), [active]);

  return (
    <SymbolLinkContext.Provider value={value}>
      <div className={className} data-linkdim={active ? "true" : undefined}>
        {children}
      </div>
    </SymbolLinkContext.Provider>
  );
}

export function useSymbolLink(): SymbolLinkValue {
  return useContext(SymbolLinkContext);
}

/**
 * A linkable ticker. Renders `children` (usually the symbol itself), joins the
 * thread on hover/focus, and lights up when it matches the active symbol. Keeps
 * a net-zero horizontal inset so the match highlight never shifts layout.
 */
export function SymbolTag({
  symbol,
  children,
  className = "",
}: {
  symbol: string;
  children: ReactNode;
  className?: string;
}) {
  const { active, setActive } = useSymbolLink();
  const match = active != null && active === symbol;

  return (
    <span
      className={`uaa-linkable -mx-1 rounded px-1 ${match ? "uaa-linkmatch" : ""} ${className}`}
      data-symbol={symbol}
      onMouseEnter={() => setActive(symbol)}
      onMouseLeave={() => setActive(null)}
      onFocus={() => setActive(symbol)}
      onBlur={() => setActive(null)}
    >
      {children}
    </span>
  );
}
