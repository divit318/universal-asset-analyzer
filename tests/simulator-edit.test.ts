/**
 * Simulator editing (lib/portfolio/simulator/edit.ts) — the value-conservation
 * invariant. Every transform funds from / refills the cash sleeve so the
 * mandate's total never drifts with an edit, and the AI swap/rationale
 * contracts are validated the same way as every other model output.
 */
import { describe, expect, it } from "vitest";
import {
  addHolding,
  applyQuantityEdit,
  applySwap,
  availableCash,
  buildRationalePrompt,
  buildSwapPrompt,
  parseRationaleResponse,
  parseSwapResponse,
  removeHolding,
} from "../lib/portfolio/simulator/edit";
import type { SimHolding, SimProfile } from "../lib/portfolio/simulator/types";

const USD = "USD";

function book(): SimHolding[] {
  return [
    { symbol: "VOO", name: "Vanguard S&P 500", assetClass: "etf", currency: USD, quantity: 100, targetWeight: 50, rationale: "core", addedBy: "ai" },
    { symbol: "BND", name: "Total Bond", assetClass: "bond", currency: USD, quantity: 500, targetWeight: 36, rationale: "ballast", addedBy: "ai" },
    { symbol: null, name: "Cash (USD)", assetClass: "cash", currency: USD, quantity: 14_000, targetWeight: 14, rationale: null, addedBy: "ai" },
  ];
}
// Live prices: VOO 500 → 50k, BND 72 → 36k, cash 14k. Total 100k.
const totalOf = (h: SimHolding[], prices: Record<string, number>) =>
  h.reduce((s, x) => s + x.quantity * (x.symbol ? prices[x.symbol] : 1), 0);
const PRICES = { VOO: 500, BND: 72 };

describe("applyQuantityEdit", () => {
  it("funds an increase from the cash sleeve — total conserved", () => {
    const { holdings, changedSymbols, note } = applyQuantityEdit(book(), "VOO", 110, 500, USD);
    expect(changedSymbols).toEqual(["VOO"]);
    expect(note).toBeNull();
    expect(holdings.find((h) => h.symbol === "VOO")!.quantity).toBe(110);
    expect(availableCash(holdings)).toBeCloseTo(14_000 - 5_000, 2);
    expect(totalOf(holdings, PRICES)).toBeCloseTo(100_000, 2);
  });

  it("refills the sleeve on a trim — total conserved", () => {
    const { holdings } = applyQuantityEdit(book(), "BND", 400, 72, USD);
    expect(availableCash(holdings)).toBeCloseTo(14_000 + 100 * 72, 2);
    expect(totalOf(holdings, PRICES)).toBeCloseTo(100_000, 2);
  });

  it("caps a buy at what the sleeve can fund instead of minting money", () => {
    const { holdings, note } = applyQuantityEdit(book(), "VOO", 1_000, 500, USD);
    const voo = holdings.find((h) => h.symbol === "VOO")!;
    expect(voo.quantity).toBe(100 + Math.floor(14_000 / 500)); // +28 shares
    expect(note).toMatch(/Capped/);
    expect(availableCash(holdings)).toBeLessThan(500); // sleeve nearly drained
    expect(totalOf(holdings, PRICES)).toBeCloseTo(100_000, 2);
  });

  it("throws when there is no cash at all to fund an increase", () => {
    const noCash = book().filter((h) => h.assetClass !== "cash");
    expect(() => applyQuantityEdit(noCash, "VOO", 101, 500, USD)).toThrow(/cash/i);
  });

  it("treats quantity 0 as removal", () => {
    const { holdings } = applyQuantityEdit(book(), "VOO", 0, 500, USD);
    expect(holdings.find((h) => h.symbol === "VOO")).toBeUndefined();
    expect(availableCash(holdings)).toBeCloseTo(14_000 + 50_000, 2);
  });
});

describe("removeHolding", () => {
  it("returns the live value to the sleeve — total conserved", () => {
    const { holdings } = removeHolding(book(), "BND", 72, USD);
    expect(holdings.find((h) => h.symbol === "BND")).toBeUndefined();
    expect(availableCash(holdings)).toBeCloseTo(14_000 + 36_000, 2);
    expect(totalOf(holdings, PRICES)).toBeCloseTo(100_000, 2);
  });

  it("creates a cash sleeve if the book had none", () => {
    const noCash = book().filter((h) => h.assetClass !== "cash");
    const { holdings } = removeHolding(noCash, "BND", 72, USD);
    expect(availableCash(holdings)).toBeCloseTo(36_000, 2);
  });
});

describe("addHolding", () => {
  const input = { symbol: "gld", name: "SPDR Gold", assetClass: "commodity" as const, currency: USD, quantity: 10 };

  it("funds the buy from the sleeve and normalizes the symbol", () => {
    const { holdings, changedSymbols } = addHolding(book(), input, 200, USD);
    const gld = holdings.find((h) => h.symbol === "GLD")!;
    expect(gld.quantity).toBe(10);
    expect(gld.addedBy).toBe("user");
    expect(changedSymbols).toEqual(["GLD"]);
    expect(availableCash(holdings)).toBeCloseTo(14_000 - 2_000, 2);
  });

  it("caps at affordable whole units and rejects duplicates and overdrafts", () => {
    const { holdings, note } = addHolding(book(), { ...input, quantity: 1_000 }, 200, USD);
    expect(holdings.find((h) => h.symbol === "GLD")!.quantity).toBe(70); // 14k / 200
    expect(note).toMatch(/Capped/);
    expect(() => addHolding(book(), { ...input, symbol: "VOO" }, 500, USD)).toThrow(/already/);
    expect(() => addHolding(book(), { ...input, quantity: 1 }, 20_000, USD)).toThrow(/Not enough cash/);
  });
});

describe("applySwap", () => {
  it("replaces at equal value, keeps target weight, routes the residue to cash", () => {
    const { holdings, changedSymbols } = applySwap(
      book(), "VOO", { symbol: "vti", name: "Vanguard Total Market", why: "broader base" }, 500, 300, USD, USD,
    );
    const vti = holdings.find((h) => h.symbol === "VTI")!;
    expect(vti.quantity).toBe(Math.floor(50_000 / 300)); // 166 whole shares
    expect(vti.targetWeight).toBe(50);
    expect(vti.rationale).toBe("broader base");
    expect(changedSymbols).toEqual(["VTI"]);
    expect(holdings.find((h) => h.symbol === "VOO")).toBeUndefined();
    // 166 * 300 = 49,800 → 200 residue lands in cash
    expect(availableCash(holdings)).toBeCloseTo(14_200, 2);
    expect(totalOf(holdings, { VTI: 300, BND: 72 })).toBeCloseTo(100_000, 2);
  });

  it("rejects swapping to something already held or priced beyond the position", () => {
    expect(() => applySwap(book(), "VOO", { symbol: "BND", name: "x", why: null }, 500, 72, USD, USD)).toThrow(/already/);
    expect(() => applySwap(book(), "VOO", { symbol: "BRK-A", name: "x", why: null }, 500, 60_000, USD, USD)).toThrow(/exceeds/);
  });
});

describe("AI contracts", () => {
  const profile: SimProfile = {
    cash: 100_000, currency: USD, horizon: "long", targetDate: null, objective: "growth",
    riskAppetite: 7, maxDrawdownPct: 35, role: "standalone", complementRef: null,
    preferences: {}, followUps: [], intakeComplete: true,
  };

  it("swap prompt names the outgoing holding, the book and the menu", () => {
    const p = buildSwapPrompt(profile, book(), "VOO", "  VTI — Vanguard Total (core)");
    expect(p).toContain("Replace: VOO");
    expect(p).toContain("BND (bond)");
    expect(p).toContain("VTI — Vanguard Total");
    expect(p).toContain('"alternatives"');
  });

  it("swap parse drops held symbols, the outgoing symbol itself, junk and beyond-3", () => {
    const raw = JSON.stringify({
      alternatives: [
        { symbol: "VOO", name: "itself", why: "no" },
        { symbol: "BND", name: "already held", why: "no" },
        { symbol: "vti", name: "Vanguard Total", why: "ok" },
        { symbol: "!!", name: "junk", why: "no" },
        { symbol: "ITOT", name: "iShares Total", why: "ok" },
        { symbol: "SPLG", name: "SPDR 500", why: "ok" },
        { symbol: "SCHB", name: "Schwab Broad", why: "beyond 3" },
      ],
    });
    const alts = parseSwapResponse(raw, book(), "VOO");
    expect(alts.map((a) => a.symbol)).toEqual(["VTI", "ITOT", "SPLG"]);
  });

  it("rationale prompt lists the edited book and the symbols to narrate", () => {
    const p = buildRationalePrompt(profile, book(), ["VOO"]);
    expect(p).toContain("VOO (etf)");
    expect(p).toContain("Write rationales for: VOO");
  });

  it("rationale parse keeps only requested symbols with non-empty strings", () => {
    const out = parseRationaleResponse(
      JSON.stringify({ rationales: { VOO: "Core US beta at low cost", BND: "not asked", GLD: 42 } }),
      ["VOO", "GLD"],
    );
    expect(out).toEqual({ VOO: "Core US beta at low cost" });
  });
});
