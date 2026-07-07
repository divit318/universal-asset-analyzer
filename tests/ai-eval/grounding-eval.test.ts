/**
 * AI grounding eval harness runner.
 *
 * Runs the grounding verifier over every golden fixture and asserts the verdict
 * matches expectations. This is the offline regression net for AI answer
 * quality: it proves the verifier catches fabricated figures and phantom
 * sources while leaving correctly-grounded, rounded, and locale-formatted
 * figures alone (no false alarms).
 */

import { describe, it, expect } from "vitest";
import { verifyGrounding } from "@/lib/ai/grounding";
import { GROUNDING_EVAL_CASES } from "./fixtures";

describe("AI grounding eval harness", () => {
  for (const c of GROUNDING_EVAL_CASES) {
    it(c.name, () => {
      const r = verifyGrounding(c.answer, c.evidence, { allowedTags: c.allowedTags });
      const unsupported = r.unsupportedNumbers.join(" | ");

      if (c.expect.minScore != null) {
        expect(r.groundingScore, `score too low; unsupported=[${unsupported}]`).toBeGreaterThanOrEqual(
          c.expect.minScore,
        );
      }
      if (c.expect.maxScore != null) {
        expect(r.groundingScore).toBeLessThanOrEqual(c.expect.maxScore);
      }
      if (c.expect.level != null) {
        expect(r.level).toBe(c.expect.level);
      }
      for (const needle of c.expect.mustFlag ?? []) {
        expect(unsupported, `expected "${needle}" to be flagged unsupported`).toContain(needle);
      }
      for (const needle of c.expect.mustNotFlag ?? []) {
        expect(unsupported, `"${needle}" was wrongly flagged as unsupported`).not.toContain(needle);
      }
      if (c.expect.invalidCitations != null) {
        expect([...r.invalidCitations].sort()).toEqual([...c.expect.invalidCitations].sort());
      }
    });
  }

  it("aggregate: clean cases outscore fabricated cases", () => {
    const score = (name: string) => {
      const c = GROUNDING_EVAL_CASES.find((x) => x.name === name)!;
      return verifyGrounding(c.answer, c.evidence, { allowedTags: c.allowedTags }).groundingScore;
    };
    expect(score("AAPL — well-grounded valuation answer")).toBeGreaterThan(
      score("AAPL — fabricated growth and margin figures"),
    );
  });
});
