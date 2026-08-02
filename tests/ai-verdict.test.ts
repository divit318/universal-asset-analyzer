import { describe, expect, it } from "vitest";
import { assembleVerdict, offlineVerdict, parseVerdictFields, type VerdictPlan } from "@/lib/ai/verdict";

/**
 * The verdict assembler is the shared "finish" step for BOTH the blocking
 * /api/ai/verdict route and the streamed /api/ai/report route. These tests pin
 * the properties that make "the streamed report is the same object as the
 * blocking one" structurally true rather than merely intended.
 */

const PLAN: VerdictPlan = {
  kind: "equity",
  task: "investment-thesis",
  prompt: "irrelevant for assembly",
  evidence: [
    "Company: Example Corp (EXMP)",
    "Forward P/E: 16.1",
    "Revenue growth: +85.2%",
    "Return on equity: 114.3%",
  ].join("\n"),
  fallback: {
    verdict: "neutral",
    name: "Example Corp",
    subject: "stock",
    reviewHint: "Review metrics and score below",
  },
};

const COMPLETE = {
  headline: "Example Corp compounds at 85% with a 16x forward multiple",
  thesis: "Revenue growth of +85.2% against a forward P/E of 16.1 is a rare combination.",
  catalysts: ["Revenue growth +85.2%", "Return on equity 114.3%"],
  risks: ["Multiple could compress", "Growth decelerating"],
  confidence: "high",
  timeHorizon: "long-term",
  keyMetrics: [{ label: "Fwd P/E", value: "16.1x", signal: "positive" }],
  verdict: "bullish",
};

describe("assembleVerdict", () => {
  it("passes through a complete generation unchanged", () => {
    const v = assembleVerdict(PLAN, COMPLETE, "qwen3:14b");

    expect(v.verdict).toBe("bullish");
    expect(v.headline).toBe(COMPLETE.headline);
    expect(v.thesis).toBe(COMPLETE.thesis);
    expect(v.catalysts).toEqual(COMPLETE.catalysts);
    expect(v.risks).toEqual(COMPLETE.risks);
    expect(v.confidence).toBe("high");
    expect(v.timeHorizon).toBe("long-term");
    expect(v.keyMetrics).toEqual(COMPLETE.keyMetrics);
    expect(v.model).toBe("qwen3:14b");
  });

  it("always yields mappable arrays when the model omits them", () => {
    // This is the exact crash that shipped once: a model returning valid JSON
    // without `catalysts` made the research page call .map() on undefined.
    const v = assembleVerdict(PLAN, { headline: "Only a headline" }, "m");

    expect(Array.isArray(v.catalysts)).toBe(true);
    expect(Array.isArray(v.risks)).toBe(true);
    expect(Array.isArray(v.keyMetrics)).toBe(true);
    expect(v.catalysts).toEqual([]);
    expect(v.headline).toBe("Only a headline");
  });

  it("falls back to the plan's verdict when the model omits or corrupts it", () => {
    expect(assembleVerdict(PLAN, {}, "m").verdict).toBe("neutral");
    expect(assembleVerdict(PLAN, { verdict: "very bullish" }, "m").verdict).toBe("neutral");
    expect(assembleVerdict(PLAN, { verdict: 7 }, "m").verdict).toBe("neutral");
  });

  it("rejects out-of-enum confidence and horizon rather than rendering them", () => {
    const v = assembleVerdict(PLAN, { confidence: "extremely high", timeHorizon: "forever" }, "m");
    expect(v.confidence).toBe("low");
    expect(v.timeHorizon).toBe("medium-term");
  });

  it("drops malformed keyMetrics entries instead of rendering undefined cells", () => {
    const v = assembleVerdict(
      PLAN,
      {
        keyMetrics: [
          { label: "Good", value: "1.0x", signal: "positive" },
          { label: "No value" },
          null,
          "not an object",
          { label: "Bad signal", value: "2.0x", signal: "sideways" },
        ],
      },
      "m",
    );

    expect(v.keyMetrics).toEqual([
      { label: "Good", value: "1.0x", signal: "positive" },
      { label: "Bad signal", value: "2.0x", signal: "neutral" },
    ]);
  });

  it("keeps non-string array members out of catalysts and risks", () => {
    const v = assembleVerdict(PLAN, { catalysts: ["real", 42, null, { a: 1 }], risks: "not an array" }, "m");
    expect(v.catalysts).toEqual(["real"]);
    expect(v.risks).toEqual([]);
  });

  it("runs grounding against the plan's evidence", () => {
    const v = assembleVerdict(PLAN, COMPLETE, "m");
    expect(v.grounding).toBeDefined();
  });

  it("produces an identical object from streamed fields and from a parsed blob", () => {
    // The streamed path accumulates fields one at a time; the blocking path
    // parses one blob. Same input values must give the same verdict.
    const streamed: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(COMPLETE)) streamed[k] = val;

    const a = assembleVerdict(PLAN, streamed, "m");
    const b = assembleVerdict(PLAN, { ...COMPLETE }, "m");

    // generatedAt is a timestamp; everything else must match exactly.
    const strip = (v: typeof a) => ({ ...v, generatedAt: "" });
    expect(strip(a)).toEqual(strip(b));
  });
});

describe("offlineVerdict", () => {
  it("is actionable rather than blank, and names the asset class", () => {
    const v = offlineVerdict(PLAN);
    expect(v.headline).toContain("Example Corp");
    expect(v.headline).toContain("AI provider");
    // Names both recovery paths, not just the local one.
    expect(v.thesis).toContain("devin auth login");
    expect(v.thesis).toContain("ollama serve");
    expect(v.thesis).toContain("stock");
    expect(v.risks).toContain("Review metrics and score below");
    expect(v.model).toBe("unavailable");
  });

  it("keeps the score-derived call instead of defaulting to neutral", () => {
    const bullish: VerdictPlan = { ...PLAN, fallback: { ...PLAN.fallback, verdict: "bullish" } };
    expect(offlineVerdict(bullish).verdict).toBe("bullish");
  });

  it("carries no grounding, because nothing was generated to verify", () => {
    expect(offlineVerdict(PLAN).grounding).toBeUndefined();
  });

  it("still exposes mappable arrays", () => {
    const v = offlineVerdict(PLAN);
    expect(v.catalysts.length).toBeGreaterThan(0);
    expect(Array.isArray(v.keyMetrics)).toBe(true);
  });
});

/**
 * Regression: the blocking path used `extractJsonObject(raw, {})`, which copies
 * only the keys present in the `defaults` argument. With `{}` that is no keys,
 * so a complete, valid verdict was reduced to `{}` and then re-expanded into
 * `defaultFields` — /api/ai/verdict returned an empty thesis, no catalysts, no
 * risks and confidence "low" for every symbol, discarding ~80s of inference.
 * The Excel/PDF exporters read that route, so exports shipped blank verdicts.
 */
describe("parseVerdictFields", () => {
  it("preserves every field the model emitted", () => {
    const parsed = parseVerdictFields(JSON.stringify(COMPLETE));
    expect(parsed).toEqual(COMPLETE);
  });

  it("survives the round trip through assembleVerdict", () => {
    const v = assembleVerdict(PLAN, parseVerdictFields(JSON.stringify(COMPLETE)), "ollama");
    expect(v.verdict).toBe("bullish");
    expect(v.thesis).toBe(COMPLETE.thesis);
    expect(v.catalysts).toEqual(COMPLETE.catalysts);
    expect(v.risks).toEqual(COMPLETE.risks);
    expect(v.confidence).toBe("high");
    expect(v.keyMetrics).toHaveLength(1);
  });

  it("unwraps markdown-fenced and preamble-wrapped output", () => {
    const raw = "Here is the analysis:\n```json\n" + JSON.stringify(COMPLETE) + "\n```";
    expect(parseVerdictFields(raw).verdict).toBe("bullish");
  });

  it("degrades to an empty bag on unparseable output, so assembly defaults", () => {
    expect(parseVerdictFields("the model refused to answer")).toEqual({});
    expect(parseVerdictFields("[1,2,3]")).toEqual({});
    expect(assembleVerdict(PLAN, parseVerdictFields("garbage"), "ollama").confidence).toBe("low");
  });
});
