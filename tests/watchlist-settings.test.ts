/**
 * Watchlist view settings — the sanitizer is the contract. Whatever is in
 * localStorage (older shapes, hand edits, other builds), the page must get a
 * valid settings object, and the user must never be able to configure
 * themselves out of seeing the list.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATCHLIST_SETTINGS,
  HIDEABLE_COLUMNS,
  isDefaultSettings,
  sanitizeWatchlistSettings,
} from "@/lib/watchlist-settings";

describe("sanitizeWatchlistSettings", () => {
  it("returns full defaults for garbage input", () => {
    for (const raw of [null, undefined, 42, "settings", []]) {
      expect(sanitizeWatchlistSettings(raw)).toEqual(DEFAULT_WATCHLIST_SETTINGS);
    }
  });

  it("merges a partial object with defaults", () => {
    const s = sanitizeWatchlistSettings({ earningsHorizonDays: 14 });
    expect(s.earningsHorizonDays).toBe(14);
    expect(s.quickFilters).toEqual(DEFAULT_WATCHLIST_SETTINGS.quickFilters);
    expect(s.bigMovePct).toBe(DEFAULT_WATCHLIST_SETTINGS.bigMovePct);
  });

  it("always keeps All as the first chip, deduped", () => {
    const s = sanitizeWatchlistSettings({ quickFilters: ["owned", "all", "owned", "near-target"] });
    expect(s.quickFilters).toEqual(["all", "owned", "near-target"]);
    // Even when the user unchecks everything:
    expect(sanitizeWatchlistSettings({ quickFilters: [] }).quickFilters).toEqual(["all"]);
  });

  it("drops unknown filters and columns rather than crashing on them", () => {
    const s = sanitizeWatchlistSettings({
      quickFilters: ["owned", "thesis", 42], // "thesis" was a pre-upgrade filter id
      hiddenColumns: ["fit", "added", "symbol", 7], // "added" no longer exists; "symbol" is not hideable
    });
    expect(s.quickFilters).toEqual(["all", "owned"]);
    expect(s.hiddenColumns).toEqual(["fit"]);
  });

  it("a default filter outside the visible chips falls back to All", () => {
    const s = sanitizeWatchlistSettings({ quickFilters: ["owned"], defaultFilter: "earnings" });
    expect(s.defaultFilter).toBe("all");
    const ok = sanitizeWatchlistSettings({ quickFilters: ["owned"], defaultFilter: "owned" });
    expect(ok.defaultFilter).toBe("owned");
  });

  it("snaps out-of-range thresholds back to defaults", () => {
    const s = sanitizeWatchlistSettings({ earningsHorizonDays: 90, bigMovePct: 0.1, defaultSortKey: "nonsense" });
    expect(s.earningsHorizonDays).toBe(DEFAULT_WATCHLIST_SETTINGS.earningsHorizonDays);
    expect(s.bigMovePct).toBe(DEFAULT_WATCHLIST_SETTINGS.bigMovePct);
    expect(s.defaultSortKey).toBe("");
  });

  it("every hideable column key is unique", () => {
    const keys = HIDEABLE_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isDefaultSettings", () => {
  it("recognises the defaults and any deviation", () => {
    expect(isDefaultSettings(sanitizeWatchlistSettings({}))).toBe(true);
    expect(isDefaultSettings(sanitizeWatchlistSettings({ hiddenColumns: ["fit"] }))).toBe(false);
    expect(isDefaultSettings(sanitizeWatchlistSettings({ quickFilters: ["all", "owned"] }))).toBe(false);
    expect(isDefaultSettings(sanitizeWatchlistSettings({ bigMovePct: 3 }))).toBe(false);
  });
});
