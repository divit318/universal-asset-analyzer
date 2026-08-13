import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAsset } from "@/lib/asset-resolution";

// resolveAction() must be tested against a controlled resolver — the policy
// under test is eligibility (intent × resolution), not Yahoo's search.
vi.mock("@/lib/asset-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/asset-resolution")>();
  return { ...actual, resolveAssetMention: vi.fn() };
});

import { resolveAssetMention } from "@/lib/asset-resolution";
import { reconcileAnswer, resolveAction } from "@/lib/ai-app-assistant";

const mockResolve = vi.mocked(resolveAssetMention);

const strong = (symbol: string, name: string): ResolvedAsset => ({
  symbol, name, type: "Equity", exchange: null, resolution: "strong",
});
const ambiguous = (symbol: string, name: string, altSymbol: string, altName: string): ResolvedAsset => ({
  symbol, name, type: "Equity", exchange: null, resolution: "ambiguous",
  alternative: { symbol: altSymbol, name: altName },
});

beforeEach(() => {
  mockResolve.mockReset();
});

describe("resolveAction — eligibility (intent × resolution)", () => {
  it("strong resolution keeps the model's high intent (may auto-fire)", async () => {
    mockResolve.mockResolvedValue(strong("TSLA", "Tesla, Inc."));
    const { action } = await resolveAction({ destination: "watchlist", watchlistAdd: ["Tesla"], confidence: "high" });
    expect(action?.confidence).toBe("high");
    expect(action?.mutation?.items).toEqual([{ symbol: "TSLA", name: "Tesla, Inc." }]);
  });

  it("AMBIGUOUS resolution caps high intent at medium — never auto-fires (Reliance regression)", async () => {
    mockResolve.mockResolvedValue(ambiguous("RS", "Reliance, Inc.", "RELIANCE.NS", "Reliance Industries Limited"));
    const { action, ambiguous: amb } = await resolveAction({
      destination: "watchlist", watchlistAdd: ["Reliance"], confidence: "high",
    });
    expect(action?.confidence).toBe("medium");
    expect(amb).toHaveLength(1);
    // The chip must name the instrument and read as a question.
    expect(action?.label).toBe("Add Reliance, Inc. (RS) to Watchlist?");
  });

  it("no resolution at all → NO action (fake-company regression: never a misleading 'Open Watchlist')", async () => {
    mockResolve.mockResolvedValue(null);
    const outcome = await resolveAction({ destination: "watchlist", watchlistAdd: ["Blorptech Industries"], confidence: "high" });
    expect(outcome.action).toBeUndefined();
    expect(outcome.unresolved).toEqual(["Blorptech Industries"]);
    expect(outcome.wantedAdd).toBe(true);
  });

  it("mutation labels always name the instrument, at every confidence", async () => {
    mockResolve.mockResolvedValue(strong("TSLA", "Tesla, Inc."));
    const { action } = await resolveAction({ destination: "watchlist", watchlistAdd: ["Tesla"], confidence: "low" });
    expect(action?.label).toBe("Add Tesla, Inc. (TSLA) to Watchlist");
    expect(action?.confidence).toBe("low");
  });

  it("navigation with an ambiguous symbol is also capped at medium", async () => {
    mockResolve.mockResolvedValue(ambiguous("RS", "Reliance, Inc.", "RELIANCE.NS", "Reliance Industries Limited"));
    const { action } = await resolveAction({ destination: "research", symbols: ["Reliance"], confidence: "high" });
    expect(action?.confidence).toBe("medium");
    expect(action?.label).toContain("RS");
  });
});

describe("resolveAction — multi-add", () => {
  it("resolves every requested company independently", async () => {
    mockResolve
      .mockResolvedValueOnce(strong("AAPL", "Apple Inc."))
      .mockResolvedValueOnce(strong("MSFT", "Microsoft Corporation"))
      .mockResolvedValueOnce(strong("GOOGL", "Alphabet Inc."));
    const { action, unresolved } = await resolveAction({
      destination: "watchlist", watchlistAdd: ["Apple", "Microsoft", "Alphabet"], confidence: "high",
    });
    expect(action?.mutation?.items.map((i) => i.symbol)).toEqual(["AAPL", "MSFT", "GOOGL"]);
    expect(action?.label).toBe("Add 3 to Watchlist: AAPL, MSFT, GOOGL");
    expect(unresolved).toEqual([]);
  });

  it("partial resolution keeps the resolved items and reports the rest (never pretends completeness)", async () => {
    mockResolve
      .mockResolvedValueOnce(strong("AAPL", "Apple Inc."))
      .mockResolvedValueOnce(null);
    const outcome = await resolveAction({
      destination: "watchlist", watchlistAdd: ["Apple", "Blorptech"], confidence: "high",
    });
    expect(outcome.action?.mutation?.items).toEqual([{ symbol: "AAPL", name: "Apple Inc." }]);
    expect(outcome.unresolved).toEqual(["Blorptech"]);
  });

  it("accepts a bare string watchlistAdd (model schema drift)", async () => {
    mockResolve.mockResolvedValue(strong("TSLA", "Tesla, Inc."));
    const { action } = await resolveAction({ destination: "watchlist", watchlistAdd: "Tesla", confidence: "high" });
    expect(action?.mutation?.items).toEqual([{ symbol: "TSLA", name: "Tesla, Inc." }]);
  });
});

describe("reconcileAnswer — the text never claims more than the action does", () => {
  it("keeps the model's answer when everything resolved cleanly", () => {
    const action = {
      type: "navigate" as const, destination: "watchlist", href: "/watchlist?highlight=TSLA",
      label: "Add Tesla, Inc. (TSLA) to Watchlist", destinationLabel: "Watchlist", confidence: "high" as const,
      mutation: { kind: "watchlist_add" as const, items: [{ symbol: "TSLA", name: "Tesla, Inc." }] },
    };
    expect(
      reconcileAnswer("I'll add Tesla to your watchlist.", { action, unresolved: [], ambiguous: [], wantedAdd: true }, true),
    ).toBe("I'll add Tesla to your watchlist.");
  });

  it("all-unresolved add: says nothing was added, names the mention", () => {
    const text = reconcileAnswer(
      "I'll add Blorptech Industries to your watchlist.",
      { action: undefined, unresolved: ["Blorptech Industries"], ambiguous: [], wantedAdd: true },
      true,
    );
    expect(text).toContain('"Blorptech Industries"');
    expect(text).toContain("nothing was added");
  });

  it("ambiguous add: asks, naming both readings", () => {
    const pick = ambiguous("RS", "Reliance, Inc.", "RELIANCE.NS", "Reliance Industries Limited");
    const action = {
      type: "navigate" as const, destination: "watchlist", href: "/watchlist?highlight=RS",
      label: "Add Reliance, Inc. (RS) to Watchlist?", destinationLabel: "Watchlist", confidence: "medium" as const,
      mutation: { kind: "watchlist_add" as const, items: [{ symbol: "RS", name: "Reliance, Inc." }] },
    };
    const text = reconcileAnswer(
      "I'll add Reliance to your watchlist.",
      { action, unresolved: [], ambiguous: [{ mention: "Reliance", pick }], wantedAdd: true },
      true,
    );
    expect(text).toContain("Reliance, Inc. (RS)");
    expect(text).toContain("Reliance Industries Limited (RELIANCE.NS)");
    expect(text).toContain("Confirm");
  });

  it("partial add: lists exactly what will be added and what was not identified", () => {
    const action = {
      type: "navigate" as const, destination: "watchlist", href: "/watchlist?highlight=AAPL",
      label: "Add Apple Inc. (AAPL) to Watchlist", destinationLabel: "Watchlist", confidence: "high" as const,
      mutation: { kind: "watchlist_add" as const, items: [{ symbol: "AAPL", name: "Apple Inc." }] },
    };
    const text = reconcileAnswer(
      "I'll add Apple and Blorptech.",
      { action, unresolved: ["Blorptech"], ambiguous: [], wantedAdd: true },
      true,
    );
    expect(text).toContain("Apple Inc. (AAPL)");
    expect(text).toContain('"Blorptech"');
  });
});
