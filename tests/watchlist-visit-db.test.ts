/**
 * The watchlist visit clock and price baselines — the DB half of "since your
 * last visit", against an isolated throwaway database.
 *
 * The invariant that matters: refreshing the page must NOT destroy the diff.
 * Reads within one session share a baseline; only a real absence rotates it,
 * and the rotated baseline is the PREVIOUS session's closing state.
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-visit-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const {
  addToWatchlist,
  touchWatchlistVisit,
  putWatchlistCurrentPrices,
  getWatchlistBaselinePrices,
  markWatchlistReviewed,
  updateWatchlistItem,
  listWatchlist,
  listNotificationsSince,
  createNotifications,
  removeFromWatchlist,
  VISIT_SESSION_GAP_MS,
} = await import("../lib/db");

const T0 = Date.parse("2026-08-10T09:00:00Z");
const GAP = VISIT_SESSION_GAP_MS;

describe("touchWatchlistVisit", () => {
  it("records the first visit with no baseline to diff against", () => {
    const v = touchWatchlistVisit(T0);
    expect(v).toEqual({ baselineAt: T0, firstVisit: true, rotated: false });
  });

  it("keeps one baseline across reads inside a session", () => {
    const v1 = touchWatchlistVisit(T0 + 60_000);
    const v2 = touchWatchlistVisit(T0 + 10 * 60_000);
    expect(v1.rotated).toBe(false);
    expect(v2.rotated).toBe(false);
    expect(v2.baselineAt).toBe(T0);
  });

  it("rotates to the previous session's LAST read after a real absence", () => {
    const lastRead = T0 + 10 * 60_000; // from the test above
    const v = touchWatchlistVisit(lastRead + GAP + 1);
    expect(v.rotated).toBe(true);
    expect(v.baselineAt).toBe(lastRead);
  });

  it("promotes current price snapshots to baseline on rotation", () => {
    const now = T0 + GAP + 20 * 60_000;
    putWatchlistCurrentPrices([{ symbol: "NVDA", price: 181.5 }], now);
    // Same session: still no baseline for NVDA.
    touchWatchlistVisit(now);
    expect(getWatchlistBaselinePrices(["NVDA"]).get("NVDA")).toBeUndefined();
    // After an absence the observed price becomes the thing we diff against.
    touchWatchlistVisit(now + GAP + 1);
    expect(getWatchlistBaselinePrices(["NVDA"]).get("NVDA")?.price).toBe(181.5);
  });

  it("rejects unusable prices from the snapshot", () => {
    putWatchlistCurrentPrices([
      { symbol: "ZERO", price: 0 },
      { symbol: "NAN", price: Number.NaN },
    ]);
    const later = Date.now() + GAP + 1;
    touchWatchlistVisit(later);
    expect(getWatchlistBaselinePrices(["ZERO", "NAN"]).size).toBe(0);
  });
});

describe("thesis review tracking", () => {
  it("stamps last_reviewed_at when any thesis field is written, but not for a target edit", () => {
    addToWatchlist("AAPL", "Apple");
    expect(listWatchlist().find((i) => i.symbol === "AAPL")?.lastReviewedAt).toBeNull();

    updateWatchlistItem("AAPL", { targetPrice: 250 });
    expect(listWatchlist().find((i) => i.symbol === "AAPL")?.lastReviewedAt).toBeNull();

    updateWatchlistItem("AAPL", { conviction: "high", buyTrigger: "Below $200" });
    const item = listWatchlist().find((i) => i.symbol === "AAPL")!;
    expect(item.lastReviewedAt).not.toBeNull();
    expect(item.conviction).toBe("high");
    expect(item.buyTrigger).toBe("Below $200");
  });

  it("markWatchlistReviewed records a review without edits", () => {
    addToWatchlist("MSFT", "Microsoft");
    markWatchlistReviewed("MSFT", T0);
    expect(listWatchlist().find((i) => i.symbol === "MSFT")?.lastReviewedAt).toBe(T0);
  });

  it("rejects an unknown conviction on read", () => {
    addToWatchlist("TSLA", "Tesla");
    // @ts-expect-error deliberately writing an invalid value through the API surface
    updateWatchlistItem("TSLA", { conviction: "absolute" });
    expect(listWatchlist().find((i) => i.symbol === "TSLA")?.conviction).toBeNull();
  });
});

describe("listNotificationsSince", () => {
  it("returns only matching symbols after the cutoff, and never for an empty set", () => {
    const facts = {
      kind: "price_target" as const,
      symbol: "NVDA",
      name: "NVIDIA",
      observedAt: new Date().toISOString(),
      sessionDate: null,
    };
    createNotifications([
      { dedupKey: "t1", symbol: "NVDA", name: "NVIDIA", kind: "price_target", severity: "info", facts },
    ]);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(listNotificationsSince(since, ["NVDA"]).length).toBe(1);
    expect(listNotificationsSince(since, ["AAPL"]).length).toBe(0);
    expect(listNotificationsSince(since, []).length).toBe(0);
    expect(listNotificationsSince(new Date(Date.now() + 60_000).toISOString(), ["NVDA"]).length).toBe(0);
  });
});

describe("removal hygiene", () => {
  it("removes the price snapshots with the symbol", () => {
    addToWatchlist("GONE", "Goner");
    putWatchlistCurrentPrices([{ symbol: "GONE", price: 10 }]);
    removeFromWatchlist("GONE");
    touchWatchlistVisit(Date.now() + 10 * GAP); // rotate: snapshots would surface here
    expect(getWatchlistBaselinePrices(["GONE"]).size).toBe(0);
  });
});
