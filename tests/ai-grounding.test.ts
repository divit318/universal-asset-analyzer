import { describe, it, expect } from "vitest";
import {
  collectClaimText,
  extractCitationTags,
  extractNumericClaims,
  verifyGrounding,
} from "@/lib/ai/grounding";

describe("extractCitationTags", () => {
  it("extracts distinct source:tag citations in first-seen order", () => {
    const text = "P/E is 14 [yahoo:valuation]. ROE strong [platform:score]. Cheap [yahoo:valuation].";
    expect(extractCitationTags(text)).toEqual(["yahoo:valuation", "platform:score"]);
  });

  it("handles bare [news] and narrowed filing tags", () => {
    expect(extractCitationTags("See filing [edgar:10-K 2024-11-01] and [news].")).toEqual([
      "edgar:10-k 2024-11-01",
      "news",
    ]);
  });

  it("returns [] when there are no citations", () => {
    expect(extractCitationTags("A prose answer with no tags.")).toEqual([]);
  });
});

describe("extractNumericClaims", () => {
  it("classifies percents, multiples, currency and magnitudes", () => {
    const claims = extractNumericClaims("Trades at 15.2x, up 12.3%, market cap $1.2B, revenue 4,500 cr.");
    const byKind = Object.fromEntries(claims.map((c) => [c.kind, c.value]));
    expect(byKind.multiple).toBeCloseTo(15.2);
    expect(byKind.percent).toBeCloseTo(12.3);
    // $1.2B and 4,500cr both scale to magnitude; assert both present.
    const mags = claims.filter((c) => c.kind === "magnitude").map((c) => c.value);
    expect(mags).toContain(1.2e9);
    expect(mags).toContain(4500 * 1e7);
  });

  it("scales K/M/B/T and Indian cr/lakh suffixes", () => {
    const vals = (t: string) => extractNumericClaims(t).map((c) => c.value);
    expect(vals("$500K")).toContain(5e5);
    expect(vals("$3.5M")).toContain(3.5e6);
    expect(vals("$2T")).toContain(2e12);
    expect(vals("₹12 lakh")).toContain(12 * 1e5);
  });

  it("skips 4-digit years and small list counts, keeps real figures", () => {
    const claims = extractNumericClaims("In 2024 the top 3 segments grew; margin hit 28%.");
    expect(claims.map((c) => c.raw.trim())).not.toContain("2024");
    expect(claims.some((c) => c.kind === "percent" && c.value === 28)).toBe(true);
    // "3" is a small count → skipped.
    expect(claims.some((c) => c.kind === "plain" && c.value === 3)).toBe(false);
  });

  it("does not read filing form numbers as claims", () => {
    const claims = extractNumericClaims("The 10-K and 8-K were filed; debt is $4.2B.");
    expect(claims.some((c) => c.value === 10 || c.value === 8)).toBe(false);
    expect(claims.some((c) => c.value === 4.2e9)).toBe(true);
  });
});

describe("verifyGrounding — numeric tracing", () => {
  const evidence = "Valuation: P/E 17.94, EV/EBITDA 12.1x. Growth: revenue +11%. Market cap $1.23B.";

  it("passes an answer whose figures all trace to the evidence (with rounding)", () => {
    const answer = "It trades at ~18x earnings [yahoo:valuation] with 11% growth and a $1.2B cap.";
    const r = verifyGrounding(answer, evidence, { allowedTags: ["yahoo:valuation"] });
    expect(r.unsupportedNumbers).toEqual([]);
    expect(r.groundingScore).toBeGreaterThanOrEqual(0.9);
    expect(r.level).toBe("high");
  });

  it("flags a fabricated figure that appears nowhere in the evidence", () => {
    const answer = "Revenue grew 47% [yahoo:valuation] and the P/E is 18.";
    const r = verifyGrounding(answer, evidence, { allowedTags: ["yahoo:valuation"] });
    expect(r.unsupportedNumbers.join(" ")).toContain("47%");
    expect(r.numbersChecked).toBeGreaterThanOrEqual(2);
    expect(r.groundingScore).toBeLessThan(0.85);
    expect(r.flags.some((f) => f.includes("could not be traced"))).toBe(true);
  });

  it("never matches a percent to a same-valued dollar amount", () => {
    // Evidence has $12 (magnitude) but no 12% — an answer claiming "12%" is unsupported.
    const r = verifyGrounding("Margin is 12%.", "Share price is $12.00.", {});
    expect(r.unsupportedNumbers).toContain("12%");
  });

  it("scores 1.0 numeric support when the answer makes no quantitative claims", () => {
    const r = verifyGrounding("The company has a strong competitive moat.", evidence, {
      allowedTags: ["yahoo:valuation"],
    });
    expect(r.numbersChecked).toBe(0);
    expect(r.groundingScore).toBe(1);
  });
});

describe("collectClaimText", () => {
  it("joins strings and string arrays, dropping empties", () => {
    const text = collectClaimText([
      "Thesis: cheap at 12x.",
      null,
      ["Catalyst A: 20% growth", "", "Catalyst B"],
      undefined,
    ]);
    expect(text).toContain("cheap at 12x");
    expect(text).toContain("Catalyst A: 20% growth");
    expect(text).toContain("Catalyst B");
    expect(text.split("\n")).toHaveLength(3); // empties removed
  });

  it("returns '' when everything is empty/nullish", () => {
    expect(collectClaimText([null, undefined, "", []])).toBe("");
  });
});

describe("verifyGrounding — structured-feature adoption (verdict/compare/IC shape)", () => {
  // Mirrors how the verdict route collects prose fields and verifies them
  // against the `facts` block it handed the model.
  const facts = "Forward P/E: 26.1x\nROE: 147.3%\nRevenue growth YoY: 4.9%\nComposite score: 71/100";

  it("passes a verdict whose catalysts/risks all cite real facts", () => {
    const claims = collectClaimText([
      "AAPL screens rich at 26x forward earnings.", // headline
      "High-quality compounder; ROE of 147% but only 4.9% revenue growth.", // thesis
      ["Composite score of 71/100 supports a constructive stance"], // catalysts
      ["Growth has decelerated to 4.9%"], // risks
    ]);
    const r = verifyGrounding(claims, facts);
    expect(r.unsupportedNumbers).toEqual([]);
    expect(r.level).toBe("high");
  });

  it("flags a verdict that invents a growth number", () => {
    const claims = collectClaimText([
      "AAPL is compounding revenue at 22% with a 71/100 score.",
    ]);
    const r = verifyGrounding(claims, facts);
    expect(r.unsupportedNumbers.join(" ")).toContain("22%");
    expect(r.groundingScore).toBeLessThan(1);
  });
});

describe("verifyGrounding — citations", () => {
  const evidence = "P/E 17.9 [yahoo:valuation].";

  it("flags a citation to a source that was never provided", () => {
    const r = verifyGrounding("Strong buy [bloomberg:terminal], P/E 18.", evidence, {
      allowedTags: ["yahoo:valuation", "platform:score"],
    });
    expect(r.invalidCitations).toContain("bloomberg:terminal");
    expect(r.flags.some((f) => f.includes("no known source"))).toBe(true);
  });

  it("accepts a narrowed citation whose prefix matches an allowed source", () => {
    const r = verifyGrounding("Per the annual report [edgar:10-K], debt fell.", "…", {
      allowedTags: ["edgar:statements"],
    });
    expect(r.invalidCitations).toEqual([]);
  });

  it("does not score citation validity when no allowed set is given", () => {
    const r = verifyGrounding("P/E 18 [made:up].", evidence, {});
    expect(r.invalidCitations).toEqual([]);
    expect(r.citedTags).toContain("made:up");
  });

  it("warns when quantitative claims are made with zero citations", () => {
    const r = verifyGrounding("The P/E is 18 and margins are 28%.", "P/E 18, margins 28%.", {
      allowedTags: ["yahoo:valuation"],
    });
    expect(r.flags.some((f) => f.includes("cites no sources"))).toBe(true);
  });
});
