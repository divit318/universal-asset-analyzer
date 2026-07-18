/**
 * The Idea lifecycle's pure logic (§4.5): the unambiguous auto-transitions and
 * the days-in-stage math. Kept separate from the DB integration test so the
 * transition rules are pinned without touching SQLite.
 */

import { describe, it, expect } from "vitest";
import {
  autoStageForTrade,
  daysInStage,
  PIPELINE_STAGES,
  TERMINAL_STAGES,
  IDEA_STAGES,
  isIdeaStage,
  STAGE_LABEL,
} from "@/lib/idea-stage";

describe("stage vocabulary", () => {
  it("lists the funnel then the terminal outcomes", () => {
    expect(PIPELINE_STAGES).toEqual(["surfaced", "researching", "thesis", "owned"]);
    expect(TERMINAL_STAGES).toEqual(["passed", "exited"]);
    expect(IDEA_STAGES).toEqual(["surfaced", "researching", "thesis", "owned", "passed", "exited"]);
  });

  it("labels every stage", () => {
    for (const s of IDEA_STAGES) expect(STAGE_LABEL[s]).toBeTruthy();
  });

  it("validates stage strings", () => {
    expect(isIdeaStage("owned")).toBe(true);
    expect(isIdeaStage("surfaced")).toBe(true);
    expect(isIdeaStage("bogus")).toBe(false);
    expect(isIdeaStage(null)).toBe(false);
    expect(isIdeaStage(3)).toBe(false);
  });
});

describe("autoStageForTrade", () => {
  it("a buy of a ticker → owned", () => {
    expect(autoStageForTrade({ kind: "buy", assetClass: "equity", symbol: "NVDA", stillHeld: true })).toBe("owned");
  });

  it("a sell that closes the position → exited", () => {
    expect(autoStageForTrade({ kind: "sell", assetClass: "equity", symbol: "NVDA", stillHeld: false })).toBe("exited");
  });

  it("a partial sell (still held) → no transition", () => {
    expect(autoStageForTrade({ kind: "sell", assetClass: "equity", symbol: "NVDA", stillHeld: true })).toBeNull();
  });

  it("never transitions cash, balancing plugs, or synthesized cash symbols", () => {
    expect(autoStageForTrade({ kind: "buy", assetClass: "cash", symbol: "CASH-USD", stillHeld: true })).toBeNull();
    expect(autoStageForTrade({ kind: "buy", assetClass: "equity", symbol: "CASH-USD", stillHeld: true })).toBeNull();
  });

  it("never transitions a non-ticker string", () => {
    expect(autoStageForTrade({ kind: "buy", assetClass: "equity", symbol: "not a ticker!", stillHeld: true })).toBeNull();
  });

  it("normalizes case", () => {
    expect(autoStageForTrade({ kind: "buy", assetClass: "equity", symbol: "nvda", stillHeld: true })).toBe("owned");
  });
});

describe("daysInStage", () => {
  const NOW = Date.parse("2026-07-19T12:00:00Z");

  it("counts whole days from the stage-changed timestamp", () => {
    expect(daysInStage(NOW - 3 * 86_400_000, "2020-01-01", NOW)).toBe(3);
  });

  it("falls back to added-at when the stage timestamp is null (pre-migration rows)", () => {
    expect(daysInStage(null, new Date(NOW - 5 * 86_400_000).toISOString(), NOW)).toBe(5);
  });

  it("never goes negative", () => {
    expect(daysInStage(NOW + 86_400_000, "2020-01-01", NOW)).toBe(0);
  });
});
