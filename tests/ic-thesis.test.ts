import { describe, it, expect } from "vitest";
import { parseThesis } from "@/lib/ic-thesis";

describe("parseThesis", () => {
  it("fills omitted array fields with [] on a valid-but-incomplete parse", () => {
    const raw = '{"bull":"Strong pricing power.","bear":"Margin risk."}';
    const thesis = parseThesis(raw);
    expect(thesis.bull).toBe("Strong pricing power.");
    expect(thesis.keyCatalysts).toEqual([]);
    expect(thesis.keyRisks).toEqual([]);
    expect(thesis.keyDrivers).toEqual([]);
  });

  it("falls back to [] when an array field arrives as the wrong kind", () => {
    const raw = '{"bull":"ok","keyCatalysts":"not an array"}';
    const thesis = parseThesis(raw);
    expect(Array.isArray(thesis.keyCatalysts)).toBe(true);
    expect(thesis.keyCatalysts).toEqual([]);
  });

  it("never throws on total garbage and returns the unavailable-message default", () => {
    const thesis = parseThesis("the model refused to answer");
    expect(thesis.bull).toBe("Thesis formation unavailable — AI response could not be parsed.");
    expect(thesis.keyCatalysts).toEqual([]);
  });
});
