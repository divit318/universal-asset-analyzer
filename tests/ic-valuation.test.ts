import { describe, it, expect } from "vitest";
import { parseValuation } from "@/lib/ic-valuation";

describe("parseValuation", () => {
  it("fills omitted fields with conservative defaults on a valid-but-incomplete parse", () => {
    const raw = '{"currentPrice":"$100","approaches":[{"method":"DCF","priceTarget":"$120","confidence":"high"}]}';
    const result = parseValuation(raw);
    expect(result.currentPrice).toBe("$100");
    expect(result.scenarios).toEqual([]);
    expect(result.dcfSensitivity).toBe("");
  });

  it("drops nested approach/scenario items missing required fields instead of crashing", () => {
    const raw = '{"approaches":[{"priceTarget":"$120"},{"method":"DCF","priceTarget":"$130","confidence":"medium"}]}';
    const result = parseValuation(raw);
    expect(result.approaches).toHaveLength(1);
    expect(result.approaches[0].method).toBe("DCF");
  });

  it("normalizes an invented confidence variant to a valid enum value", () => {
    const raw = '{"approaches":[{"method":"DCF","priceTarget":"$120","confidence":"Extremely High"}]}';
    const result = parseValuation(raw);
    expect(result.approaches[0].confidence).toBe("medium");
  });

  it("returns [] arrays and 'n/a' placeholders on total garbage instead of throwing", () => {
    const result = parseValuation("not json at all");
    expect(result.currentPrice).toBe("n/a");
    expect(result.approaches).toEqual([]);
    expect(result.scenarios).toEqual([]);
  });
});
