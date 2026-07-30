/**
 * The Pipeline board's row builder (lib/idea-stage.ts).
 *
 * The property under test is the one that broke: the Owned column IS the set of
 * quoted holdings. It used to be a separately-stored `watchlist.stage`, so BND
 * and VTI — bought, then removed from the ledger — sat in Owned for a portfolio
 * that held neither, while a held forex position sat under Surfaced. Both
 * directions are pinned here, plus the exclusions that make the Owned count
 * legitimately smaller than the Holdings count.
 */
import { describe, expect, it } from "vitest";
import {
  buildPipelineRows,
  effectiveStage,
  isPipelineSymbol,
  type HeldPosition,
  type TrackedIdea,
} from "../lib/idea-stage";
import { assetClassForSymbol } from "../lib/assets/registry";
import { displayAssetName } from "../lib/format";

const NOW = Date.parse("2026-07-29T00:00:00Z");

const idea = (over: Partial<TrackedIdea> & { symbol: string }): TrackedIdea => ({
  name: over.symbol,
  stage: "surfaced",
  stageChangedAt: null,
  addedAt: "2026-07-01T00:00:00Z",
  source: null,
  sourceDetail: null,
  ...over,
});

const held = (over: Partial<HeldPosition> & { symbol: string | null }): HeldPosition => ({
  name: over.symbol ?? "Unnamed",
  assetClass: "equity",
  acquiredAt: "2026-07-01",
  ...over,
});

describe("isPipelineSymbol", () => {
  it("accepts every shape a market actually quotes", () => {
    for (const s of ["AAPL", "BRK-B", "PBR-A", "HE=F", "USDCHF=X", "^GSPC", "USD136148-USD", "RY.TO"]) {
      expect(isPipelineSymbol(s), s).toBe(true);
    }
  });

  it("rejects the two things a research pipeline cannot act on", () => {
    // Cash: a synthetic lot no provider quotes.
    expect(isPipelineSymbol("CASH-USD")).toBe(false);
    // Manually-valued assets (property, private stakes, collectibles) carry no symbol.
    expect(isPipelineSymbol(null)).toBe(false);
    expect(isPipelineSymbol("")).toBe(false);
    expect(isPipelineSymbol("not a ticker!")).toBe(false);
  });
});

describe("effectiveStage", () => {
  it("calls a held name owned whatever its stored stage says", () => {
    for (const stored of ["surfaced", "researching", "thesis", "owned", "passed", "exited"] as const) {
      expect(effectiveStage(stored, true)).toBe("owned");
    }
  });

  it("reads a stale `owned` on an unheld name as exited", () => {
    expect(effectiveStage("owned", false)).toBe("exited");
  });

  it("leaves every other stage of an unheld name alone", () => {
    expect(effectiveStage("surfaced", false)).toBe("surfaced");
    expect(effectiveStage("researching", false)).toBe("researching");
    expect(effectiveStage("thesis", false)).toBe("thesis");
    expect(effectiveStage("passed", false)).toBe("passed");
  });
});

describe("buildPipelineRows — Owned reconciles with Holdings", () => {
  const holdings: HeldPosition[] = [
    held({ symbol: "AAPL", name: "Apple Inc." }),
    held({ symbol: "VOO", name: "Vanguard S&P 500 ETF", assetClass: "etf" }),
    held({ symbol: "USDCHF=X", name: "USD/CHF", assetClass: "forex" }),
    // Excluded: cash and the three manually-valued assets, which have no ticker.
    held({ symbol: null, name: "USD Cash", assetClass: "cash" }),
    held({ symbol: null, name: "Small Land Parcel - Rural TX", assetClass: "real_estate" }),
    held({ symbol: null, name: "Acme AI Inc. - Series A", assetClass: "private_market" }),
    held({ symbol: null, name: "Rolex Daytona (2019)", assetClass: "alternative" }),
  ];

  const tracked: TrackedIdea[] = [
    idea({ symbol: "AAPL", name: "Apple Inc.", stage: "owned" }),
    // Held, but its row was never moved out of Surfaced (the forex case).
    idea({ symbol: "USDCHF=X", name: "USD/CHF", stage: "surfaced" }),
    // Stored `owned` with nothing in the ledger — the BND/VTI case.
    idea({ symbol: "BND", name: "Vanguard Total Bond Market Index Fund", stage: "owned" }),
    idea({ symbol: "VTI", name: "Vanguard Total Stock Market Index Fund ETF Shares", stage: "owned" }),
    idea({ symbol: "NVDA", name: "NVIDIA Corp." }),
    idea({ symbol: "BAC", name: "Bank of America", stage: "thesis" }),
  ];

  const rows = buildPipelineRows({ tracked, holdings, now: NOW });
  const inStage = (stage: string) => rows.filter((r) => r.stage === stage).map((r) => r.symbol).sort();

  it("shows exactly the quoted holdings as Owned — no more, no less", () => {
    const quotedHoldings = holdings
      .filter((h) => isPipelineSymbol(h.symbol))
      .map((h) => (h.symbol as string).toUpperCase())
      .sort();
    expect(inStage("owned")).toEqual(quotedHoldings);
  });

  it("drops a name the ledger no longer holds out of Owned", () => {
    expect(inStage("owned")).not.toContain("BND");
    expect(inStage("owned")).not.toContain("VTI");
    expect(inStage("exited")).toEqual(["BND", "VTI"]);
  });

  it("pulls a held name out of Surfaced even when its row was never moved", () => {
    expect(inStage("surfaced")).toEqual(["NVDA"]);
    expect(rows.find((r) => r.symbol === "USDCHF=X")?.stage).toBe("owned");
  });

  it("never surfaces cash or a manually-valued asset as an idea", () => {
    const names = rows.map((r) => r.name);
    for (const excluded of ["USD Cash", "Small Land Parcel - Rural TX", "Acme AI Inc. - Series A", "Rolex Daytona (2019)"]) {
      expect(names).not.toContain(excluded);
    }
  });

  it("merges a held-but-untracked holding in as a derived Owned row", () => {
    const voo = rows.find((r) => r.symbol === "VOO");
    expect(voo).toMatchObject({ stage: "owned", tracked: false, held: true, assetClass: "etf" });
  });

  it("flags held-ness independently of tracking", () => {
    expect(rows.find((r) => r.symbol === "AAPL")).toMatchObject({ tracked: true, held: true });
    expect(rows.find((r) => r.symbol === "BND")).toMatchObject({ tracked: true, held: false });
  });

  it("leaves the rest of the funnel untouched", () => {
    expect(inStage("thesis")).toEqual(["BAC"]);
    expect(inStage("researching")).toEqual([]);
  });

  it("carries a class for filtering: the holding's own, else the symbol's shape", () => {
    // A holding states its class; a watchlist row has only its symbol to go on.
    expect(rows.find((r) => r.symbol === "USDCHF=X")?.assetClass).toBe("forex");
    expect(rows.find((r) => r.symbol === "NVDA")?.assetClass).toBeNull();
  });

  it("counts days in stage from the stage change, and from inception when untracked", () => {
    const bac = buildPipelineRows({
      tracked: [idea({ symbol: "BAC", stage: "thesis", stageChangedAt: NOW - 3 * 86_400_000 })],
      holdings: [],
      now: NOW,
    })[0];
    expect(bac.daysInStage).toBe(3);
    expect(rows.find((r) => r.symbol === "VOO")?.daysInStage).toBe(28);
  });
});

describe("assetClassForSymbol", () => {
  it("reads the classes Yahoo's symbol suffixes actually declare", () => {
    expect(assetClassForSymbol("HE=F")).toBe("commodity");
    expect(assetClassForSymbol("USDCHF=X")).toBe("forex");
    expect(assetClassForSymbol("USDT-USD")).toBe("crypto");
  });

  it("refuses to guess where the symbol says nothing", () => {
    // No symbol distinguishes an equity from an ETF or a REIT.
    expect(assetClassForSymbol("AAPL")).toBeNull();
    expect(assetClassForSymbol("VOO")).toBeNull();
    expect(assetClassForSymbol("")).toBeNull();
  });
});

describe("displayAssetName", () => {
  it("drops Yahoo's duplicated quote currency exactly once", () => {
    expect(displayAssetName("BTC-USD", "Bitcoin USD")).toBe("Bitcoin");
    expect(displayAssetName("USDT-USD", "Tether USDt USD")).toBe("Tether USDt");
    expect(displayAssetName("USDC-USD", "USD Coin USD")).toBe("USD Coin");
    // The token really is called "World Liberty Financial USD" — strip one, not both.
    expect(displayAssetName("USD136148-USD", "World Liberty Financial USD USD")).toBe(
      "World Liberty Financial USD",
    );
  });

  it("leaves everything that isn't a currency-quoted pair alone", () => {
    expect(displayAssetName("AAPL", "Apple Inc.")).toBe("Apple Inc.");
    expect(displayAssetName("USDCHF=X", "USD/CHF")).toBe("USD/CHF");
    // A hyphenated share class must never have a letter shaved off its name.
    expect(displayAssetName("PBR-A", "Petróleo Brasileiro S.A. - Petrobras")).toBe(
      "Petróleo Brasileiro S.A. - Petrobras",
    );
    expect(displayAssetName("SCHW-PD", "The Charles Schwab Corporation")).toBe("The Charles Schwab Corporation");
  });

  it("never strips a name down to nothing", () => {
    expect(displayAssetName("FOO-USD", " USD")).toBe(" USD");
    expect(displayAssetName("USD-USD", "USD")).toBe("USD");
  });
});
