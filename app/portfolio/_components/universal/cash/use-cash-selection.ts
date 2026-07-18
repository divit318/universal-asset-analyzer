"use client";

import { useEffect, useState } from "react";
import type { NarratedItem } from "./types";

/**
 * Which of the plan's items to actually buy on execute. Defaults to "every
 * item" whenever the item set changes (a fresh plan for a new amount/objective
 * should start fully selected, not carry over a stale partial selection).
 */
export function useCashSelection(items: NarratedItem[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const itemsKey = items.map((i) => i.symbol ?? i.name).sort().join("|");

  useEffect(() => {
    // Syncing local selection state to an external change (a fresh plan for a
    // new amount/objective) — not derivable at render time.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelected(new Set(items.map((i) => i.symbol).filter((s): s is string => s != null)));
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- itemsKey is the intentional, content-stable dependency.
  }, [itemsKey]);

  function toggle(symbol: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  const selectedItems = items.filter((i) => i.symbol && selected.has(i.symbol));
  const totalSelected = selectedItems.reduce((s, i) => s + i.dollarAmount, 0);

  return { selected, toggle, selectedItems, totalSelected, isSelected: (symbol: string) => selected.has(symbol) };
}
