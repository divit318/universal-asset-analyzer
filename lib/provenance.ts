/**
 * Data provenance & freshness — the single source of truth for "where did this
 * number come from, and how old is it".
 *
 * UAA pulls from several feeds (Yahoo, screener.in, SEC EDGAR, the local quant
 * engine) with very different refresh cadences, and previously surfaced none of
 * it consistently — the Screener had its own inline "updated 2h ago" string and
 * every other page showed nothing. For an institutional-grade tool, staleness
 * has to be visible: a figure with no "as of" is a figure you can't trust.
 *
 * Pure, zero-dependency, client-safe.
 */

export type DataSourceId = "yahoo" | "screener_in" | "sec_edgar" | "quant_engine" | "platform" | "rentcast" | "amfi";

export interface DataSourceMeta {
  id: DataSourceId;
  /** Full display name, e.g. for tooltips. */
  name: string;
  /** Compact label for inline badges. */
  short: string;
}

export const DATA_SOURCES: Record<DataSourceId, DataSourceMeta> = {
  yahoo: { id: "yahoo", name: "Yahoo Finance", short: "Yahoo" },
  screener_in: { id: "screener_in", name: "screener.in", short: "screener.in" },
  sec_edgar: { id: "sec_edgar", name: "SEC EDGAR", short: "SEC" },
  quant_engine: { id: "quant_engine", name: "UAA Quant Engine", short: "Engine" },
  platform: { id: "platform", name: "Universal Asset Analyzer", short: "UAA" },
  rentcast: { id: "rentcast", name: "RentCast (estimate)", short: "RentCast" },
  amfi: { id: "amfi", name: "AMFI (Association of Mutual Funds in India)", short: "AMFI" },
};

export type FreshnessLevel = "fresh" | "aging" | "stale";

export interface Freshness {
  level: FreshnessLevel;
  /** Age in ms, or null when the timestamp is missing/invalid. */
  ageMs: number | null;
  /** Human-readable age, e.g. "2h ago", "just now", or "unknown". */
  label: string;
}

/** Compact relative age, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function relativeAge(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/**
 * Classify how fresh a timestamp is against a source's expected refresh window.
 *
 * - `fresh`  — within the TTL (the data is current)
 * - `aging`  — within 2× the TTL (usable, worth a glance)
 * - `stale`  — older than that, or the timestamp is missing/unparseable
 *
 * Accepts an ISO string, an epoch-ms number, or null.
 */
export function freshness(
  asOf: string | number | null | undefined,
  ttlHours: number,
  now: number = Date.now(),
): Freshness {
  if (asOf == null) return { level: "stale", ageMs: null, label: "unknown" };
  const t = typeof asOf === "number" ? asOf : Date.parse(asOf);
  if (Number.isNaN(t)) return { level: "stale", ageMs: null, label: "unknown" };

  const ageMs = Math.max(0, now - t);
  const ttlMs = ttlHours * 3_600_000;
  const level: FreshnessLevel = ageMs <= ttlMs ? "fresh" : ageMs <= ttlMs * 2 ? "aging" : "stale";
  return { level, ageMs, label: relativeAge(ageMs) };
}
