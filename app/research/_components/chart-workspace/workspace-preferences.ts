import type { CandleIntervalKey, IndicatorKey, PeriodKey } from "./types";

const KEY = "uaa_chart_workspace_prefs";

export interface WorkspacePreferences {
  toolbarPinned: boolean;
  dateRange: PeriodKey;
  candleInterval: CandleIntervalKey;
  indicators: Record<IndicatorKey, boolean>;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  toolbarPinned: false,
  dateRange: "6M",
  candleInterval: "1D",
  indicators: { sma50: true, sma200: true, boll: false, rsi: true, macd: false },
};

/**
 * The user's remembered workspace chrome — global, not per-symbol. A
 * trader's preferred layout (pinned toolbar, interval, indicators) is a
 * personal tool preference, not a per-ticker one, matching how most trading
 * platforms remember your last-used layout across every symbol you open.
 * Per-drawing state (styles, visibility, lock) is handled separately —
 * see style-preferences.ts and the DB-persisted DrawingObject fields.
 */
export function getWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_WORKSPACE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
    return {
      ...DEFAULT_WORKSPACE_PREFERENCES,
      ...parsed,
      indicators: { ...DEFAULT_WORKSPACE_PREFERENCES.indicators, ...parsed.indicators },
    };
  } catch {
    return DEFAULT_WORKSPACE_PREFERENCES;
  }
}

export function setWorkspacePreferences(prefs: WorkspacePreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage unavailable — preferences just won't persist across sessions */
  }
}
