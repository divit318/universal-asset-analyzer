/**
 * The stored stage's surviving logic: vocabulary validation, the ledger's
 * unambiguous auto-transitions, and effectiveStage (the ledger wins in both
 * directions). The manual funnel that used to live here was replaced by the
 * evidence-derived workflow — see tests/idea-evidence.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  autoStageForTrade,
  effectiveStage,
  IDEA_STAGES,
  isIdeaStage,
  isPipelineSymbol,
} from "@/lib/idea-stage";

describe("stage vocabulary", () => {
  it("lists every value the column may store", () => {
    expect(IDEA_STAGES).toEqual(["surfaced", "researching", "thesis", "owned", "passed", "exited"]);
  });

  it("validates stage strings", () => {
    expect(isIdeaStage("owned")).toBe(true);
    expect(isIdeaStage("surfaced")).toBe(true);
    expect(isIdeaStage("bogus")).toBe(false);
    expect(isIdeaStage(null)).toBe(false);
    expect(isIdeaStage(3)).toBe(false);
  });
});

describe("isPipelineSymbol", () => {
  it("accepts everything a market quotes", () => {
    for (const sym of ["NVDA", "BRK.B", "HE=F", "USDCHF=X", "^GSPC", "BTC-USD"]) {
      expect(isPipelineSymbol(sym)).toBe(true);
    }
  });

  it("rejects cash, nulls and non-tickers", () => {
    expect(isPipelineSymbol("CASH-USD")).toBe(false);
    expect(isPipelineSymbol(null)).toBe(false);
    expect(isPipelineSymbol("not a ticker!")).toBe(false);
  });
});

describe("effectiveStage — the ledger wins in both directions", () => {
  it("a held name reads owned whatever is stored", () => {
    expect(effectiveStage("surfaced", true)).toBe("owned");
    expect(effectiveStage("passed", true)).toBe("owned");
  });

  it("a stored owned for a name no longer held reads exited", () => {
    expect(effectiveStage("owned", false)).toBe("exited");
  });

  it("otherwise the stored value stands", () => {
    expect(effectiveStage("passed", false)).toBe("passed");
    expect(effectiveStage("surfaced", false)).toBe("surfaced");
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
