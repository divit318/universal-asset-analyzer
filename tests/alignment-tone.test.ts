/**
 * Alignment severity contract (2026-08-17 ruling 3).
 *
 * Alignment is a fit diagnostic, not a directional call — its severity
 * ceiling is WARNING. Before this ruling, /home rendered an alignment of 50
 * as negative/red while the portfolio panel rendered the same 50 as warning.
 * One mapping now lives in lib/portfolio/alignment/tone.ts; these tests pin
 * it to the engine's own label bands and to the warning ceiling.
 */
import { describe, expect, it } from "vitest";
import { alignmentLabelOf } from "@/lib/portfolio/alignment/engine";
import { alignmentToneOf, type AlignmentTone } from "@/lib/portfolio/alignment/tone";

describe("alignmentToneOf", () => {
  it("never renders negative — warning is the severity ceiling", () => {
    for (let s = 0; s <= 100; s++) {
      expect(["positive", "neutral", "warning"]).toContain(alignmentToneOf(s));
    }
    expect(alignmentToneOf(null)).toBe("neutral");
  });

  it("flips severity exactly at the engine's own label edges (70, 55)", () => {
    expect(alignmentToneOf(70)).toBe("positive");
    expect(alignmentToneOf(69)).toBe("neutral");
    expect(alignmentToneOf(55)).toBe("neutral");
    expect(alignmentToneOf(54)).toBe("warning");
  });

  it("agrees with alignmentLabelOf about which side of every edge a score sits on", () => {
    // "Well/Strongly aligned" ⇔ positive; "Mixed" ⇔ neutral;
    // "Strained/Misaligned" ⇔ warning. Same numbers, same bands, two vocabularies.
    const toneForLabel: Record<string, AlignmentTone> = {
      "Strongly aligned": "positive",
      "Well aligned": "positive",
      Mixed: "neutral",
      Strained: "warning",
      Misaligned: "warning",
    };
    for (let s = 0; s <= 100; s++) {
      expect(alignmentToneOf(s), `score ${s}`).toBe(toneForLabel[alignmentLabelOf(s)]);
    }
  });
});
