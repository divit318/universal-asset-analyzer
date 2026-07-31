import type { ThematicReport } from "@/lib/thematic-engine";
import { isRenderableReport, themeCacheKey } from "@/lib/thematic-theme";

const RECENT_KEY = "uaa_thematic_recent";
/** Also referenced (as a literal, with a pointer here) by app/thematic/error.tsx. */
export const STORAGE_KEY = "uaa_thematic_last_report";

/**
 * Accept a stored report only if it has the fields this page renders.
 *
 * sessionStorage outlives the code that wrote it. A report saved by an earlier
 * version has no `integrity` or `factors`, so restoring it blindly crashed the
 * page on first paint with no way for the user to recover except clearing
 * storage by hand. The check itself is the shared `isRenderableReport` — the
 * same one the API route applies to platform-cache hits, so the two storage
 * tiers can never drift apart in what they consider renderable.
 */
export function asCurrentReport(value: unknown): ThematicReport | null {
  return isRenderableReport(value) ? value : null;
}

/**
 * Locally remembered themes.
 *
 * A report costs minutes of local inference, and the server now caches it — so
 * a list of what has already been researched is a list of one-click, instant
 * reports. Previously the page kept exactly one report in sessionStorage and
 * forgot every other theme the moment you searched again.
 */
export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushRecent(theme: string): string[] {
  const next = [theme, ...readRecent().filter((t) => t.toLowerCase() !== theme.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}

/* ─────────────────── Stage-duration estimates ──────────────────────── */

const TIMINGS_KEY = "uaa_thematic_stage_timings";

/**
 * Rolling per-stage duration estimates, learned from every completed report's
 * `stageTimings` (which the engine has always measured). This is what turns
 * the progress panel's elapsed clock into an honest remaining-time estimate —
 * per TaskProgress's own rule, an estimate is only shown when there is a
 * basis for one, and the first run on a machine simply has none.
 */
export function readStageEstimates(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(TIMINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Blend new observations into the estimates: half old, half new, so one
 *  anomalous run neither dominates nor is ignored. */
export function recordStageTimings(timings: { stage: string; ms: number }[] | undefined): void {
  if (!Array.isArray(timings) || timings.length === 0) return;
  try {
    const prev = readStageEstimates() ?? {};
    const next = { ...prev };
    for (const t of timings) {
      if (typeof t?.stage !== "string" || typeof t?.ms !== "number" || !(t.ms > 0)) continue;
      next[t.stage] = prev[t.stage] ? Math.round(prev[t.stage] * 0.5 + t.ms * 0.5) : Math.round(t.ms);
    }
    localStorage.setItem(TIMINGS_KEY, JSON.stringify(next));
  } catch { /* quota */ }
}

/* ─────────────────── Report history per theme (PR-8) ────────────────── */

const HISTORY_KEY = "uaa_thematic_history";
const HISTORY_PER_THEME = 10;
const HISTORY_THEMES = 24;

/**
 * A run's verdict, small enough to keep. Every re-run used to overwrite the
 * single cache row, so "the framework said 56/100 WEAK last month and 61/100
 * STRONG today" was unknowable — the "grade your own recommendations" rule
 * applied to this tab. Snapshots are compact summaries (not full reports),
 * kept in the same browser storage that already holds the recent-theme chips
 * and the learned stage-timing estimates.
 */
export interface ReportSnapshot {
  generatedAt: string;
  themeScore: number;
  verdict: string;
  capitalCyclePhase: string;
  evidenceScore: number;
  companies: number;
}

type HistoryMap = Record<string, ReportSnapshot[]>;

function readHistoryMap(): HistoryMap {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: HistoryMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const snaps = v.filter(
        (s): s is ReportSnapshot =>
          s !== null && typeof s === "object" &&
          typeof (s as ReportSnapshot).generatedAt === "string" &&
          typeof (s as ReportSnapshot).themeScore === "number",
      );
      if (snaps.length > 0) out[k] = snaps.slice(0, HISTORY_PER_THEME);
    }
    return out;
  } catch {
    return {};
  }
}

/** Newest first. */
export function readReportHistory(theme: string): ReportSnapshot[] {
  return readHistoryMap()[themeCacheKey(theme)] ?? [];
}

/**
 * Record a run's summary. Dedupes on generatedAt, so re-loading a cached
 * report never inflates the history — only genuinely new runs add entries.
 */
export function recordReportSnapshot(report: ThematicReport): void {
  try {
    const key = themeCacheKey(report.theme);
    const map = readHistoryMap();
    const existing = map[key] ?? [];
    if (existing.some((s) => s.generatedAt === report.generatedAt)) return;
    const snap: ReportSnapshot = {
      generatedAt: report.generatedAt,
      themeScore: report.opportunity.themeScore,
      verdict: report.opportunity.verdict,
      capitalCyclePhase: report.supplyDemand.capitalCyclePhase,
      evidenceScore: report.integrity.evidenceScore,
      companies: report.tierCompanies.length,
    };
    map[key] = [snap, ...existing].slice(0, HISTORY_PER_THEME);
    // Bound the number of themes too, dropping the least recently run.
    const keys = Object.keys(map);
    if (keys.length > HISTORY_THEMES) {
      const newestFirst = keys.sort((a, b) =>
        (map[b][0]?.generatedAt ?? "").localeCompare(map[a][0]?.generatedAt ?? ""),
      );
      for (const k of newestFirst.slice(HISTORY_THEMES)) delete map[k];
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
  } catch { /* quota */ }
}
