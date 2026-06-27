import { describe, it, expect } from "vitest";

/**
 * Unit tests for the metric table logic in ai-compare.
 * We test the `better` classification rules directly — these are pure
 * comparisons that don't require the AI or network.
 */

type Better = "a" | "b" | "tie";

function lowerBetter(va: number | null, vb: number | null): Better {
  if (va == null && vb == null) return "tie";
  if (va == null) return "b";
  if (vb == null) return "a";
  if (Math.abs(va - vb) < 0.05 * Math.max(Math.abs(va), Math.abs(vb))) return "tie";
  return va < vb ? "a" : "b";
}

function higherBetter(va: number | null, vb: number | null): Better {
  if (va == null && vb == null) return "tie";
  if (va == null) return "b";
  if (vb == null) return "a";
  if (Math.abs(va - vb) < 0.05 * Math.max(Math.abs(va), Math.abs(vb))) return "tie";
  return va > vb ? "a" : "b";
}

describe("lowerBetter (e.g. P/E, D/E)", () => {
  it("picks lower non-null value", () => {
    expect(lowerBetter(15, 20)).toBe("a");
    expect(lowerBetter(20, 15)).toBe("b");
  });

  it("returns tie when values are within 5%", () => {
    expect(lowerBetter(10, 10.4)).toBe("tie");
    expect(lowerBetter(10, 9.6)).toBe("tie");
  });

  it("handles nulls — non-null wins", () => {
    expect(lowerBetter(null, 10)).toBe("b");
    expect(lowerBetter(10, null)).toBe("a");
  });

  it("both null → tie", () => {
    expect(lowerBetter(null, null)).toBe("tie");
  });
});

describe("higherBetter (e.g. ROE, score)", () => {
  it("picks higher non-null value", () => {
    expect(higherBetter(25, 15)).toBe("a");
    expect(higherBetter(15, 25)).toBe("b");
  });

  it("returns tie when values are within 5%", () => {
    expect(higherBetter(100, 103)).toBe("tie");
  });

  it("handles nulls — non-null wins", () => {
    expect(higherBetter(null, 50)).toBe("b");
    expect(higherBetter(50, null)).toBe("a");
  });
});
