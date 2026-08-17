/**
 * The evidence DB layer (lib/db.ts) against an isolated throwaway database:
 * the durable research stamp, the batch evidence join, and pass/reactivate
 * with their journal side effects — the writes behind the Watchlist's derived
 * workflow (lib/ideas/evidence.ts).
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-evidence-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const {
  addToWatchlist,
  addNote,
  ensureSession,
  getIdeaEvidence,
  getIdeaStage,
  listDecisions,
  listWatchlist,
  passIdea,
  reactivateIdea,
  recordActivity,
  touchIdeaResearch,
} = await import("../lib/db");

describe("touchIdeaResearch", () => {
  it("stamps a tracked symbol and is monotonic — an older visit never lowers a newer stamp", () => {
    addToWatchlist("AAPL", "Apple Inc.");
    touchIdeaResearch("AAPL", "2026-08-10T00:00:00.000Z");
    touchIdeaResearch("AAPL", "2026-08-01T00:00:00.000Z"); // older — must not win
    const row = listWatchlist().find((w) => w.symbol === "AAPL");
    expect(row?.lastResearchedAt).toBe("2026-08-10T00:00:00.000Z");
  });

  it("is a no-op for untracked symbols", () => {
    touchIdeaResearch("ZZZZ", "2026-08-10T00:00:00.000Z");
    expect(listWatchlist().find((w) => w.symbol === "ZZZZ")).toBeUndefined();
  });
});

describe("getIdeaEvidence", () => {
  it("joins the stamp, the visit log, AI sessions, notes and journal in one pass", () => {
    addToWatchlist("NVDA", "NVIDIA");
    touchIdeaResearch("NVDA", "2026-08-01T00:00:00.000Z");
    // The visit log carries a NEWER visit than the stamp — the max must win.
    recordActivity({ kind: "research", ref: "NVDA", label: "NVDA — NVIDIA", href: "/research?symbol=NVDA" });
    ensureSession("sess-1", "nvda"); // case-insensitive join
    addNote("NVDA", "Datacenter capex remains the driver.");

    const ev = getIdeaEvidence(["NVDA"]).get("NVDA")!;
    expect(ev.aiSessions).toBe(1);
    expect(ev.noteCount).toBe(1);
    expect(ev.lastNoteAt).not.toBeNull();
    // recordActivity stamped "now", which is newer than the explicit stamp.
    expect(Date.parse(ev.lastResearchedAt!)).toBeGreaterThan(Date.parse("2026-08-01T00:00:00.000Z"));
  });

  it("returns nothing for symbols with no evidence — absence is honest, never zero-filled claims", () => {
    addToWatchlist("BLANK", "No Work Yet");
    expect(getIdeaEvidence(["BLANK"]).get("BLANK")).toBeUndefined();
  });
});

describe("passIdea / reactivateIdea", () => {
  it("stores the judgment AND journals the reason as a closed decision", () => {
    addToWatchlist("SNDK", "Sandisk");
    const res = passIdea("SNDK", { reason: "No valuation edge", note: "NAND pricing is a coin flip", priceAt: 42 });
    expect(res.changed).toBe(true);
    expect(getIdeaStage("SNDK")).toBe("passed");

    const d = listDecisions().find((x) => x.symbol === "SNDK")!;
    expect(d.action).toBe("avoid");
    expect(d.thesis).toBe("Passed: No valuation edge — NAND pricing is a coin flip");
    expect(d.status).toBe("closed"); // a pass opens nothing to track
    expect(d.priceAt).toBe(42);

    // The evidence join surfaces the reason for the archive rail.
    const ev = getIdeaEvidence(["SNDK"]).get("SNDK")!;
    expect(ev.lastDecisionAction).toBe("avoid");
    expect(ev.lastDecisionThesis).toContain("No valuation edge");
  });

  it("is a no-op for untracked symbols", () => {
    expect(passIdea("GHOST", { reason: "x" }).changed).toBe(false);
  });

  it("reactivate reopens a passed idea; the derived workflow takes over from evidence", () => {
    expect(reactivateIdea("SNDK").changed).toBe(true);
    expect(getIdeaStage("SNDK")).toBe("surfaced");
    // Reactivating something never passed/exited is refused, not silently applied.
    addToWatchlist("MSFT", "Microsoft");
    expect(reactivateIdea("MSFT").changed).toBe(false);
  });
});
