/**
 * AI Market Summary — narrates the Scanner's Market Regime + Sector Rotation
 * output into a short investor-facing brief. Pure composition: consumes
 * MarketRegime/MacroSignal (already computed by lib/scanner/index.ts's
 * assessMarketRegime()) and SectorRotationSnapshot (already computed by
 * lib/sector-rotation.ts) — introduces no new scoring/classification logic,
 * only a narrative synthesis call via lib/ai.ts's runPrompt(), matching the
 * "engines decide, AI narrates" split used in lib/movement-explainer.ts.
 */
import { runPrompt } from "./ai";
import { getScannerCache, putScannerCache } from "./db";
import type { MarketRegime, MacroSignal, SectorRotationSnapshot } from "./types";

/** Exported for unit testing — pure, no I/O. */
export function buildMarketSummaryPrompt(
  regime: MarketRegime,
  macroSignals: MacroSignal[],
  sectorRotation: SectorRotationSnapshot | null,
): string {
  const macroDesc = macroSignals
    .filter((s) => s.price != null)
    .map((s) => `${s.name}: ${s.trend}${s.changePercent != null ? ` (${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%)` : ""}`)
    .join("; ") || "No macro signal data available.";

  const rotationDesc = sectorRotation
    ? `Sector leaders: ${sectorRotation.leaders.join(", ") || "none"}. Sector laggards: ${sectorRotation.laggards.join(", ") || "none"}.` +
      (sectorRotation.leadershipChanges.length > 0
        ? ` Recent leadership changes: ${sectorRotation.leadershipChanges.map((c) => `${c.sector} #${c.fromRank}→#${c.toRank}`).join(", ")}.`
        : "")
    : "No sector rotation snapshot available.";

  return `You are a macro strategist writing a brief for a portfolio manager.

MARKET REGIME: ${regime.trend} (${regime.breadthPct != null ? `${regime.breadthPct}% of sectors advancing` : "breadth unavailable"}).
DOMINANT SECTORS: ${regime.dominantSectors.join(", ") || "none identified"}.
DOMINANT THEMES: ${regime.dominantThemes.join(", ") || "none identified"}.

MACRO SIGNALS: ${macroDesc}

SECTOR ROTATION: ${rotationDesc}

Write a 2-4 sentence market summary, using only the facts above (do not invent data), that:
1. States what is happening in the market right now.
2. Explains why it is happening, citing the macro signals and sector data above.
3. Names which sectors are leading and which are lagging.
4. Tells the reader what to infer or watch for as an investor.

Return ONLY the summary text — no headings, no bullet points, no JSON, no preamble.`;
}

const CACHE_KEY_PREFIX = "market-summary";

export async function generateMarketSummary(
  regime: MarketRegime,
  macroSignals: MacroSignal[],
  sectorRotation: SectorRotationSnapshot | null,
): Promise<string> {
  const cacheKey = `${CACHE_KEY_PREFIX}:${regime.trend}:${regime.dominantSectors.join(",")}:${sectorRotation?.asOf ?? "none"}`;
  const cached = getScannerCache(cacheKey);
  if (cached) return cached;

  try {
    const raw = await runPrompt("market-summary", buildMarketSummaryPrompt(regime, macroSignals, sectorRotation), {
      maxTokens: 300,
    });
    const summary = raw.trim();
    // Only a real synthesis is worth caching. The fallback below must never
    // be cached: it would keep serving the one-line regime restatement for
    // the full TTL after the AI provider had already recovered (observed
    // 2026-08-07, when a scan-time quota outage froze the fallback in cache).
    if (summary) {
      putScannerCache(cacheKey, summary);
      return summary;
    }
  } catch {
    // Fall through to the deterministic fallback.
  }
  // Deterministic fallback already computed by assessMarketRegime() — never fails.
  return regime.summary;
}
