/**
 * Since Your Last Scan — deterministic diff between the scan the user is
 * looking at and the previous one they saw.
 *
 * The contract is "no fabricated change": a delta is only reported when both
 * sides genuinely measured the thing. A theme absent from the previous scan
 * is NEW; a theme present in both with a materially different momentum
 * CHANGED; a sector present in both with a different direction FLIPPED. A
 * sector the previous scan simply didn't mention is none of those, and stays
 * silent.
 *
 * Fingerprints are tiny on purpose — they live in localStorage on the client
 * ("since YOUR last scan" is about what the user last saw, not about server
 * history) and must survive JSON round-trips unchanged.
 */

import type { ScannerResult, SignalDirection } from "../types";
import { canonicalizeSector } from "../gics-sectors";

/** Minimum theme momentum move (0-100 scale) worth reporting. */
export const THEME_MOMENTUM_DELTA_MIN = 15;

/** Cap on rendered deltas — the section is a strip, not a changelog. */
export const MAX_DELTAS = 6;

export interface ScanFingerprint {
  scannedAt: string;
  regime: "risk-on" | "risk-off" | "neutral" | null;
  themes: { name: string; momentum: number }[];
  /** Canonical sector name → this scan's news-signal direction. */
  sectors: { sector: string; direction: SignalDirection }[];
  /** High-conviction tickers (normalized, .NS/.BO stripped). */
  highConviction: string[];
  riskHeadlines: string[];
}

export type DeltaKind =
  | "regime"
  | "risk-new"
  | "sector-flip"
  | "theme-new"
  | "theme-momentum"
  | "idea-new";

export interface ScanDelta {
  kind: DeltaKind;
  /** One-line, self-contained statement of the change. */
  label: string;
  /** Reading of the change for color/arrow treatment. */
  tone: "positive" | "negative" | "neutral";
}

function symbolKey(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/, "").toUpperCase();
}

/** Reduce a scan result to the compact comparable state the diff runs over. */
export function fingerprintScan(result: ScannerResult): ScanFingerprint {
  const sectorDirs = new Map<string, SignalDirection>();
  for (const impact of result.sectorImpacts ?? []) {
    const canonical = canonicalizeSector(impact.sector);
    if (!canonical || sectorDirs.has(canonical)) continue;
    sectorDirs.set(canonical, impact.direction);
  }
  return {
    scannedAt: result.scannedAt,
    regime: result.marketRegime?.trend ?? null,
    themes: (result.emergingThemes ?? []).map((t) => ({
      name: t.name,
      momentum: t.momentum,
    })),
    sectors: [...sectorDirs.entries()].map(([sector, direction]) => ({ sector, direction })),
    highConviction: (result.highConviction ?? []).map((o) => symbolKey(o.ticker)),
    riskHeadlines: (result.riskAlerts ?? []).map((r) => r.headline),
  };
}

/** Loose structural validation for a fingerprint read back from storage. */
export function isScanFingerprint(v: unknown): v is ScanFingerprint {
  if (v === null || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.scannedAt === "string" &&
    Array.isArray(f.themes) &&
    Array.isArray(f.sectors) &&
    Array.isArray(f.highConviction) &&
    Array.isArray(f.riskHeadlines)
  );
}

const REGIME_LABEL: Record<string, string> = {
  "risk-on": "risk-on",
  "risk-off": "risk-off",
  neutral: "neutral",
};

function directionTone(direction: SignalDirection): ScanDelta["tone"] {
  return direction === "bullish" ? "positive" : direction === "bearish" ? "negative" : "neutral";
}

/**
 * Diff two fingerprints, most consequential changes first: regime, new
 * risks, sector flips, new themes, theme momentum moves, new ideas.
 * Returns [] when prev is missing or refers to the same scan.
 */
export function diffScans(prev: ScanFingerprint | null, curr: ScanFingerprint): ScanDelta[] {
  if (!prev || prev.scannedAt === curr.scannedAt) return [];
  const deltas: ScanDelta[] = [];

  if (prev.regime && curr.regime && prev.regime !== curr.regime) {
    deltas.push({
      kind: "regime",
      label: `Regime shifted ${REGIME_LABEL[prev.regime]} → ${REGIME_LABEL[curr.regime]}`,
      tone:
        curr.regime === "risk-on" ? "positive" : curr.regime === "risk-off" ? "negative" : "neutral",
    });
  }

  const prevRisks = new Set(prev.riskHeadlines);
  for (const headline of curr.riskHeadlines) {
    if (!prevRisks.has(headline)) {
      deltas.push({ kind: "risk-new", label: `New risk: ${headline}`, tone: "negative" });
    }
  }

  const prevSectors = new Map(prev.sectors.map((s) => [s.sector, s.direction]));
  for (const { sector, direction } of curr.sectors) {
    const before = prevSectors.get(sector);
    if (before != null && before !== direction) {
      deltas.push({
        kind: "sector-flip",
        label: `${sector} news signal ${before} → ${direction}`,
        tone: directionTone(direction),
      });
    }
  }

  const prevThemes = new Map(prev.themes.map((t) => [t.name.toLowerCase(), t.momentum]));
  for (const { name, momentum } of curr.themes) {
    const before = prevThemes.get(name.toLowerCase());
    if (before == null) {
      deltas.push({
        kind: "theme-new",
        label: `New theme: ${name} (momentum ${momentum})`,
        tone: "neutral",
      });
    } else if (Math.abs(momentum - before) >= THEME_MOMENTUM_DELTA_MIN) {
      const up = momentum > before;
      deltas.push({
        kind: "theme-momentum",
        label: `${name} ${up ? "strengthened" : "faded"} ${before} → ${momentum}`,
        tone: up ? "positive" : "negative",
      });
    }
  }

  const prevIdeas = new Set(prev.highConviction);
  const newIdeas = curr.highConviction.filter((t) => !prevIdeas.has(t));
  if (newIdeas.length > 0) {
    deltas.push({
      kind: "idea-new",
      label: `New high-conviction: ${newIdeas.slice(0, 4).join(", ")}${newIdeas.length > 4 ? ` +${newIdeas.length - 4}` : ""}`,
      tone: "neutral",
    });
  }

  const KIND_ORDER: DeltaKind[] = [
    "regime",
    "risk-new",
    "sector-flip",
    "theme-new",
    "theme-momentum",
    "idea-new",
  ];
  return deltas
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .slice(0, MAX_DELTAS);
}
