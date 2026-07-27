"use client";

import type { MacroSignal } from "@/lib/types";
import { MacroTile } from "./market-regime-banner";

/**
 * Macro Dashboard — the full macroSignals set gets its own section instead of
 * being limited to the 6 tiles MarketRegimeBanner has room for. Same MacroTile
 * rendering, just promoted to first-class real estate.
 */
export function MacroDashboard({ macroSignals }: { macroSignals: MacroSignal[] }) {
  const signals = macroSignals.filter((s) => s.price != null);
  if (signals.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">Macro Dashboard</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {signals.map((s, i) => (
          <div key={s.ticker} className="animate-fade-rise" style={{ animationDelay: `${i * 40}ms` }}>
            <MacroTile signal={s} />
          </div>
        ))}
      </div>
    </section>
  );
}
