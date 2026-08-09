/**
 * Home telemetry (audit 13, IN-05): the pure calibration read view and the
 * home_event ledger CRUD.
 *
 * computeQueueCalibration is the piece the priority model consumes later
 * (IN-02): synthetic acted/suppressed events in, per-decile and per-kind
 * action rates out. The DB half pins the ledger invariants: append-only
 * batches, newest-first reads, the event filter, and the inline 180-day sweep
 * (the ai_call pattern, IN-06).
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db (the valuation-db test's isolation pattern).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-home-telemetry-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const { insertHomeEvents, listHomeEvents } = await import("../lib/db");
const { computeQueueCalibration, isHomeEventName, HOME_EVENT_NAMES } = await import(
  "../lib/home/telemetry-read"
);

const DAY = 24 * 60 * 60 * 1000;

function ev(
  event: string,
  props: Record<string, unknown> | null = null,
  at = Date.now(),
  sessionId = "s1",
) {
  return { at, sessionId, event, props };
}

function acted(score: number, kind = "action") {
  return ev("queue_item_acted", { dedupeKey: `k-${score}`, kind, score, rank: 0, bucket: "today" });
}

function suppressed(score: number, kind = "signal", mode = "dismiss") {
  return ev("queue_item_suppressed", { dedupeKey: `k-${score}`, kind, score, rank: 3, mode });
}

describe("computeQueueCalibration", () => {
  it("returns all ten deciles with null actedRate when there is no data", () => {
    const cal = computeQueueCalibration([]);
    expect(cal.deciles).toHaveLength(10);
    expect(cal.deciles.map((d) => d.decile)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const d of cal.deciles) {
      expect(d.n).toBe(0);
      // An unmeasured decile must never read as a measured 0% action rate.
      expect(d.actedRate).toBeNull();
    }
    expect(cal.kinds).toEqual([]);
    expect(cal.totals).toEqual({ n: 0, acted: 0, suppressed: 0 });
  });

  it("buckets outcomes by floor(score / 10) and computes acted rates", () => {
    const cal = computeQueueCalibration([
      acted(75), // decile 7
      acted(78), // decile 7
      suppressed(72), // decile 7
      suppressed(41), // decile 4
      acted(100), // score 100 clamps into decile 9, not a phantom decile 10
    ]);
    const d7 = cal.deciles[7];
    expect(d7.n).toBe(3);
    expect(d7.acted).toBe(2);
    expect(d7.suppressed).toBe(1);
    expect(d7.actedRate).toBeCloseTo(2 / 3);

    const d4 = cal.deciles[4];
    expect(d4).toMatchObject({ n: 1, acted: 0, suppressed: 1, actedRate: 0 });

    expect(cal.deciles[9]).toMatchObject({ n: 1, acted: 1, actedRate: 1 });
    expect(cal.totals).toEqual({ n: 5, acted: 3, suppressed: 2 });
  });

  it("computes per-kind action rates, sorted by kind", () => {
    const cal = computeQueueCalibration([
      acted(80, "threat"),
      suppressed(60, "threat"),
      suppressed(50, "signal"),
      suppressed(45, "signal"),
      acted(65, "action"),
    ]);
    expect(cal.kinds.map((k) => k.kind)).toEqual(["action", "signal", "threat"]);
    const threat = cal.kinds.find((k) => k.kind === "threat");
    expect(threat).toMatchObject({ n: 2, acted: 1, actedRate: 0.5 });
    const signal = cal.kinds.find((k) => k.kind === "signal");
    expect(signal).toMatchObject({ n: 2, acted: 0, actedRate: 0 });
  });

  it("ignores unrelated events and rows with malformed props", () => {
    const cal = computeQueueCalibration([
      ev("page_visit"),
      ev("brief_note_expanded", { ai: true }),
      ev("queue_undo", { dedupeKey: "k", mode: "dismiss" }),
      acted(55),
      // Score missing or non-finite: counted in totals and kinds, never
      // guessed into decile 0.
      ev("queue_item_acted", { kind: "alert" }),
      ev("queue_item_suppressed", { kind: "alert", score: "high" }),
      ev("queue_item_suppressed", null),
    ]);
    expect(cal.totals).toEqual({ n: 4, acted: 2, suppressed: 2 });
    expect(cal.deciles.reduce((sum, d) => sum + d.n, 0)).toBe(1);
    expect(cal.deciles[5]).toMatchObject({ n: 1, acted: 1 });
    const alert = cal.kinds.find((k) => k.kind === "alert");
    expect(alert).toMatchObject({ n: 2, acted: 1, actedRate: 0.5 });
  });
});

describe("isHomeEventName", () => {
  it("accepts exactly the declared vocabulary", () => {
    for (const name of HOME_EVENT_NAMES) expect(isHomeEventName(name)).toBe(true);
    expect(isHomeEventName("queue.item.action")).toBe(false); // audit draft name, not the shipped one
    expect(isHomeEventName("")).toBe(false);
    expect(isHomeEventName(42)).toBe(false);
    expect(isHomeEventName(null)).toBe(false);
  });
});

describe("home_event ledger (insertHomeEvents / listHomeEvents)", () => {
  it("appends a batch and reads it back newest-first with parsed props", () => {
    const base = Date.now() - 60_000;
    insertHomeEvents([
      { at: base, sessionId: "s1", event: "page_visit", props: null },
      { at: base + 1, sessionId: "s1", event: "queue_item_acted", props: { dedupeKey: "a", score: 72 } },
      { at: base + 2, sessionId: "s2", event: "queue_item_suppressed", props: { mode: "snooze" } },
    ]);
    const rows = listHomeEvents();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ event: "queue_item_suppressed", sessionId: "s2", props: { mode: "snooze" } });
    expect(rows[1].props).toEqual({ dedupeKey: "a", score: 72 });
    expect(rows[2]).toMatchObject({ event: "page_visit", props: null });
  });

  it("filters by event name and sinceMs", () => {
    const actedRows = listHomeEvents({ event: "queue_item_acted" });
    expect(actedRows).toHaveLength(1);
    expect(actedRows[0].event).toBe("queue_item_acted");

    const now = Date.now();
    insertHomeEvents([{ at: now, sessionId: "s3", event: "queue_undo", props: { mode: "dismiss" } }]);
    const recent = listHomeEvents({ sinceMs: now });
    expect(recent).toHaveLength(1);
    expect(recent[0].event).toBe("queue_undo");
  });

  it("sweeps rows older than 180 days on insert (the ai_call pattern)", () => {
    // The sweep runs inline after every batch write, so a stale row never
    // outlives the insert that follows it - here, its own batch.
    insertHomeEvents([
      { at: Date.now() - 181 * DAY, sessionId: "old", event: "page_visit", props: null },
      { at: Date.now(), sessionId: "s4", event: "page_visit", props: null },
    ]);
    const rows = listHomeEvents();
    expect(rows.some((r) => r.sessionId === "old")).toBe(false);
    expect(rows.some((r) => r.sessionId === "s4")).toBe(true);
  });

  it("feeds computeQueueCalibration end to end", () => {
    const now = Date.now();
    insertHomeEvents([
      { at: now, sessionId: "s5", event: "queue_item_acted", props: { dedupeKey: "x", kind: "threat", score: 82, rank: 0 } },
      { at: now, sessionId: "s5", event: "queue_item_suppressed", props: { dedupeKey: "y", kind: "signal", score: 44, rank: 5, mode: "mute" } },
    ]);
    const cal = computeQueueCalibration(listHomeEvents({ sinceMs: now }));
    expect(cal.deciles[8]).toMatchObject({ n: 1, acted: 1, actedRate: 1 });
    expect(cal.deciles[4]).toMatchObject({ n: 1, acted: 0, actedRate: 0 });
    expect(cal.kinds.map((k) => k.kind)).toEqual(["signal", "threat"]);
  });
});
