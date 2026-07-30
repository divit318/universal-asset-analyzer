/**
 * Named watchlists, target history, and crossing state — the DB layer, against an
 * isolated throwaway database.
 *
 * The invariants that matter here are about NOT losing data:
 *
 * - `listWatchlist()` must keep returning everything, because ten unrelated
 *   modules (the alert monitor, the timeline, the knowledge graph, the calendar,
 *   the home digest, the pipeline board) depend on that contract and named lists
 *   must not silently narrow any of them.
 * - Deleting a list must never destroy research. A list is a view; a target and a
 *   thesis are months of work.
 * - Editing a target must record the revision and re-arm crossing detection.
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-groups-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const {
  addToWatchlist,
  listWatchlist,
  listWatchlistByGroup,
  listWatchlistGroups,
  createWatchlistGroup,
  updateWatchlistGroup,
  deleteWatchlistGroup,
  duplicateWatchlistGroup,
  reorderWatchlistGroups,
  addSymbolToGroup,
  removeSymbolFromGroup,
  groupsForSymbol,
  defaultWatchlistGroupId,
  updateWatchlistItem,
  listTargetRevisions,
  targetRevisionCounts,
  getPriceAlertStates,
  putPriceAlertStates,
  resetPriceAlertState,
  backfillTargetDirection,
} = await import("../lib/db");

describe("migration", () => {
  it("seeds exactly one default list", () => {
    const groups = listWatchlistGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("My Watchlist");
  });

  it("adopts every symbol added through the legacy signature", () => {
    addToWatchlist("AAPL", "Apple Inc.");
    const id = defaultWatchlistGroupId();
    expect(listWatchlistByGroup(id).map((i) => i.symbol)).toContain("AAPL");
  });
});

describe("listWatchlist stays unscoped", () => {
  it("returns symbols from EVERY list, so no existing consumer is narrowed", () => {
    const other = createWatchlistGroup("Energy");
    addToWatchlist("XOM", "Exxon Mobil", other.id);
    const all = listWatchlist().map((i) => i.symbol);
    expect(all).toContain("AAPL"); // default list
    expect(all).toContain("XOM"); // the new one
    // …while the scoped read sees only its own.
    expect(listWatchlistByGroup(other.id).map((i) => i.symbol)).toEqual(["XOM"]);
  });

  it("reports a symbol once even when it is in several lists", () => {
    const a = createWatchlistGroup("A");
    const b = createWatchlistGroup("B");
    addToWatchlist("NVDA", "Nvidia", a.id);
    addSymbolToGroup("NVDA", b.id);
    expect(listWatchlist().filter((i) => i.symbol === "NVDA")).toHaveLength(1);
    expect(groupsForSymbol("NVDA")).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});

describe("membership", () => {
  it("shares one target across every list the symbol appears in", () => {
    const a = createWatchlistGroup("Shared A");
    const b = createWatchlistGroup("Shared B");
    addToWatchlist("MSFT", "Microsoft", a.id);
    addSymbolToGroup("MSFT", b.id);
    updateWatchlistItem("MSFT", { targetPrice: 500, targetDirection: "above" });

    // The same number, whichever list you look at it through.
    for (const g of [a.id, b.id]) {
      expect(listWatchlistByGroup(g).find((i) => i.symbol === "MSFT")?.targetPrice).toBe(500);
    }
  });

  it("keeps research when removed from one of several lists", () => {
    const a = createWatchlistGroup("Keep A");
    const b = createWatchlistGroup("Keep B");
    addToWatchlist("KO", "Coca-Cola", a.id);
    addSymbolToGroup("KO", b.id);
    updateWatchlistItem("KO", { targetPrice: 80, targetDirection: "below", notes: "thesis" });

    const { removedEntirely } = removeSymbolFromGroup("KO", a.id);
    expect(removedEntirely).toBe(false);
    const survivor = listWatchlistByGroup(b.id).find((i) => i.symbol === "KO");
    expect(survivor?.targetPrice).toBe(80);
    expect(survivor?.notes).toBe("thesis");
  });

  it("deletes the research row only on the LAST removal", () => {
    const g = createWatchlistGroup("Solo");
    addToWatchlist("PEP", "PepsiCo", g.id);
    const { removedEntirely } = removeSymbolFromGroup("PEP", g.id);
    expect(removedEntirely).toBe(true);
    expect(listWatchlist().map((i) => i.symbol)).not.toContain("PEP");
  });

  it("takes target history and the alert baseline with it on a full removal", () => {
    /* Otherwise re-adding the name months later resurrects a "Target history:
       2 changes" panel about a position the user already discarded, and an alert
       baseline captured under a target that no longer exists. */
    const g = createWatchlistGroup("Cleanup");
    addToWatchlist("ORCL", "Oracle", g.id);
    updateWatchlistItem("ORCL", { targetPrice: 200, targetDirection: "above" });
    updateWatchlistItem("ORCL", { targetPrice: 180, targetDirection: "above" });
    putPriceAlertStates([{ symbol: "ORCL", price: 190 }]);
    expect(listTargetRevisions("ORCL").length).toBeGreaterThan(0);

    removeSymbolFromGroup("ORCL", g.id);

    expect(listTargetRevisions("ORCL")).toEqual([]);
    expect(getPriceAlertStates(["ORCL"]).has("ORCL")).toBe(false);
    expect(groupsForSymbol("ORCL")).toEqual([]);
  });
});

describe("deleting a list never destroys research", () => {
  it("moves orphaned symbols to a surviving list instead of deleting them", () => {
    const doomed = createWatchlistGroup("Doomed");
    addToWatchlist("TSLA", "Tesla", doomed.id);
    updateWatchlistItem("TSLA", { targetPrice: 150, targetDirection: "below", notes: "waiting" });

    const result = deleteWatchlistGroup(doomed.id);
    expect(result.deleted).toBe(true);
    expect(result.movedSymbols).toBe(1);

    // Still tracked, still carrying its target and thesis.
    const survivor = listWatchlist().find((i) => i.symbol === "TSLA");
    expect(survivor?.targetPrice).toBe(150);
    expect(survivor?.notes).toBe("waiting");
    expect(groupsForSymbol("TSLA").length).toBeGreaterThan(0);
  });

  it("refuses to delete the last remaining list", () => {
    // Collapse to exactly one.
    for (const g of listWatchlistGroups().slice(1)) deleteWatchlistGroup(g.id);
    const only = listWatchlistGroups();
    expect(only).toHaveLength(1);
    const result = deleteWatchlistGroup(only[0].id);
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/at least one/i);
    expect(listWatchlistGroups()).toHaveLength(1);
  });
});

describe("create / rename / duplicate / reorder", () => {
  it("duplicates membership without cloning research", () => {
    const src = createWatchlistGroup("Source", "SPY");
    addToWatchlist("AMD", "AMD", src.id);
    addToWatchlist("INTC", "Intel", src.id);

    const copy = duplicateWatchlistGroup(src.id, "Copy")!;
    expect(copy.count).toBe(2);
    expect(copy.benchmark).toBe("SPY"); // benchmark travels with the copy
    expect(listWatchlistByGroup(copy.id).map((i) => i.symbol).sort()).toEqual(
      listWatchlistByGroup(src.id).map((i) => i.symbol).sort(),
    );
    // Still ONE research row per symbol, in two lists.
    expect(listWatchlist().filter((i) => i.symbol === "AMD")).toHaveLength(1);
  });

  it("returns null when duplicating a list that does not exist", () => {
    expect(duplicateWatchlistGroup(999_999, "Nope")).toBeNull();
  });

  it("renames and sets a benchmark independently per list", () => {
    const g = createWatchlistGroup("Old name");
    updateWatchlistGroup(g.id, { name: "New name" });
    updateWatchlistGroup(g.id, { benchmark: "QQQ" });
    const found = listWatchlistGroups().find((x) => x.id === g.id);
    expect(found?.name).toBe("New name");
    expect(found?.benchmark).toBe("QQQ");
    // Clearing is distinct from renaming.
    updateWatchlistGroup(g.id, { benchmark: null });
    expect(listWatchlistGroups().find((x) => x.id === g.id)?.benchmark).toBeNull();
  });

  it("persists an explicit display order", () => {
    const ids = listWatchlistGroups().map((g) => g.id);
    const reversed = [...ids].reverse();
    reorderWatchlistGroups(reversed);
    expect(listWatchlistGroups().map((g) => g.id)).toEqual(reversed);
  });

  it("counts membership per list", () => {
    const g = createWatchlistGroup("Counted");
    addToWatchlist("WMT", "Walmart", g.id);
    addToWatchlist("TGT", "Target Corp", g.id);
    expect(listWatchlistGroups().find((x) => x.id === g.id)?.count).toBe(2);
  });
});

describe("target revision history", () => {
  const SYM = "HIST";
  beforeEach(() => {
    addToWatchlist(SYM, "History Test");
  });

  it("records a revision when the target changes, with before and after", () => {
    updateWatchlistItem(SYM, { targetPrice: 100, targetDirection: "above" });
    updateWatchlistItem(SYM, { targetPrice: 80, targetDirection: "above", targetNote: "cut the multiple" });

    const revisions = listTargetRevisions(SYM);
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    // Newest first.
    expect(revisions[0].previousTarget).toBe(100);
    expect(revisions[0].newTarget).toBe(80);
    expect(revisions[0].note).toBe("cut the multiple");
    // The very first set has no previous value.
    const first = revisions[revisions.length - 1];
    expect(first.previousTarget).toBeNull();
  });

  it("does NOT record a revision when the target is re-saved unchanged", () => {
    updateWatchlistItem(SYM, { targetPrice: 100, targetDirection: "above" });
    const before = listTargetRevisions(SYM).length;
    updateWatchlistItem(SYM, { targetPrice: 100, targetDirection: "above" });
    expect(listTargetRevisions(SYM)).toHaveLength(before);
  });

  it("records a revision for a direction-only change", () => {
    updateWatchlistItem(SYM, { targetPrice: 100, targetDirection: "above" });
    const before = listTargetRevisions(SYM).length;
    updateWatchlistItem(SYM, { targetPrice: 100, targetDirection: "below" });
    const after = listTargetRevisions(SYM);
    expect(after).toHaveLength(before + 1);
    expect(after[0].previousDirection).toBe("above");
    expect(after[0].newDirection).toBe("below");
  });

  it("records clearing a target", () => {
    updateWatchlistItem(SYM, { targetPrice: 100, targetDirection: "above" });
    updateWatchlistItem(SYM, { targetPrice: null });
    const latest = listTargetRevisions(SYM)[0];
    expect(latest.previousTarget).toBe(100);
    expect(latest.newTarget).toBeNull();
  });

  it("counts revisions for many symbols in one query", () => {
    updateWatchlistItem(SYM, { targetPrice: 1 });
    updateWatchlistItem(SYM, { targetPrice: 2 });
    const counts = targetRevisionCounts([SYM, "NOSUCHSYMBOL"]);
    expect(counts.get(SYM)).toBeGreaterThanOrEqual(2);
    expect(counts.get("NOSUCHSYMBOL")).toBeUndefined();
  });

  it("never stores an unusable target, and normalizes it away on read", () => {
    updateWatchlistItem(SYM, { targetPrice: 0 });
    expect(listWatchlist().find((i) => i.symbol === SYM)?.targetPrice).toBeNull();
  });
});

describe("crossing state", () => {
  it("round-trips the last observed price and change", () => {
    putPriceAlertStates([{ symbol: "OBS", price: 190.5, changePercent: -1.2 }]);
    const state = getPriceAlertStates(["OBS"]).get("OBS");
    expect(state?.lastPrice).toBe(190.5);
    expect(state?.lastChangePercent).toBe(-1.2);
  });

  it("refuses to store an unusable price", () => {
    putPriceAlertStates([{ symbol: "BAD", price: 0 }, { symbol: "BAD2", price: NaN }]);
    expect(getPriceAlertStates(["BAD", "BAD2"]).size).toBe(0);
  });

  it("re-arms — clears the baseline — whenever a target changes", () => {
    addToWatchlist("REARM", "Re-arm Test");
    putPriceAlertStates([{ symbol: "REARM", price: 190 }]);
    expect(getPriceAlertStates(["REARM"]).has("REARM")).toBe(true);

    // A baseline captured under the OLD target says nothing about the new one, so
    // it must be discarded or the next tick reports a crossing that never happened.
    updateWatchlistItem("REARM", { targetPrice: 150, targetDirection: "below" });
    expect(getPriceAlertStates(["REARM"]).has("REARM")).toBe(false);
  });

  it("does not re-arm for an unrelated edit", () => {
    addToWatchlist("KEEP", "Keep Baseline");
    updateWatchlistItem("KEEP", { targetPrice: 100, targetDirection: "above" });
    putPriceAlertStates([{ symbol: "KEEP", price: 90 }]);
    updateWatchlistItem("KEEP", { notes: "just a thesis edit" });
    expect(getPriceAlertStates(["KEEP"]).has("KEEP")).toBe(true);
  });

  it("resets explicitly on demand", () => {
    putPriceAlertStates([{ symbol: "RESET", price: 10 }]);
    resetPriceAlertState("RESET");
    expect(getPriceAlertStates(["RESET"]).has("RESET")).toBe(false);
  });
});

describe("backfillTargetDirection", () => {
  it("fills a null direction WITHOUT logging a revision or re-arming", () => {
    addToWatchlist("BACKFILL", "Backfill Test");
    updateWatchlistItem("BACKFILL", { targetPrice: 200 }); // no direction supplied
    putPriceAlertStates([{ symbol: "BACKFILL", price: 180 }]);
    const revisionsBefore = listTargetRevisions("BACKFILL").length;

    backfillTargetDirection("BACKFILL", "above");

    expect(listWatchlist().find((i) => i.symbol === "BACKFILL")?.targetDirection).toBe("above");
    // The system filling in a never-populated column is not the user changing
    // their mind, so it must not fabricate history…
    expect(listTargetRevisions("BACKFILL")).toHaveLength(revisionsBefore);
    // …nor throw away the baseline the backfill exists to make usable.
    expect(getPriceAlertStates(["BACKFILL"]).has("BACKFILL")).toBe(true);
  });

  it("never overwrites a direction the user chose", () => {
    addToWatchlist("EXPLICIT", "Explicit Test");
    updateWatchlistItem("EXPLICIT", { targetPrice: 200, targetDirection: "below" });
    backfillTargetDirection("EXPLICIT", "above");
    expect(listWatchlist().find((i) => i.symbol === "EXPLICIT")?.targetDirection).toBe("below");
  });
});
