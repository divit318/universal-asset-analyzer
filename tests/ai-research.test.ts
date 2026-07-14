import { describe, it, expect } from "vitest";
import { parseSections } from "@/lib/ai-research";

describe("parseSections", () => {
  it("defaults omitted section fields to '' on a valid-but-incomplete parse", () => {
    const raw = '{"summary":"Strong quarter.","verdict":"Buy"}';
    const sections = parseSections(raw);
    expect(sections.summary).toBe("Strong quarter.");
    expect(sections.verdict).toBe("Buy");
    expect(sections.investmentCase).toBe("");
    expect(sections.risks).toBe("");
  });

  it("keeps a non-string field's default instead of leaking the wrong type through", () => {
    const raw = '{"summary":{"nested":"object"},"verdict":"Buy"}';
    const sections = parseSections(raw);
    expect(typeof sections.summary).toBe("string");
  });

  it("falls back to showing the raw model text as the summary on total garbage", () => {
    const raw = "The company shows strong fundamentals but I could not format this as JSON.";
    const sections = parseSections(raw);
    expect(sections.summary).toBe(raw);
    expect(sections.investmentCase).toBe("");
    expect(sections.verdict).toBe("");
  });
});
