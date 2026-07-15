import { describe, it, expect } from "vitest";
import { JsonFieldStreamer } from "@/lib/ai/streaming-json";

/** Feed a string one character at a time — the worst case a token stream can produce. */
function streamCharByChar(text: string): { key: string; value: unknown }[] {
  const s = new JsonFieldStreamer();
  const out: { key: string; value: unknown }[] = [];
  for (const ch of text) out.push(...s.push(ch));
  out.push(...s.end());
  return out;
}

/** Feed in arbitrary chunks, to prove chunk boundaries don't matter. */
function streamInChunks(text: string, size: number): { key: string; value: unknown }[] {
  const s = new JsonFieldStreamer();
  const out: { key: string; value: unknown }[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...s.push(text.slice(i, i + size)));
  out.push(...s.end());
  return out;
}

const VERDICT = JSON.stringify({
  headline: "Apple's margins justify the premium multiple",
  thesis: "Gross margin of 46.2% and ROE of 147% support the 32x forward P/E.",
  catalysts: ["Services growth at 14% YoY", "Buyback of $90B authorized"],
  risks: ["China exposure at 19% of revenue", "iPhone unit growth flat"],
  confidence: "high",
  timeHorizon: "long-term",
  keyMetrics: [
    { label: "Forward P/E", value: "32.1x", signal: "negative" },
    { label: "ROE", value: "147%", signal: "positive" },
  ],
  verdict: "bullish",
});

describe("JsonFieldStreamer", () => {
  it("emits every top-level field, in schema order", () => {
    const emitted = streamCharByChar(VERDICT);
    expect(emitted.map((e) => e.key)).toEqual([
      "headline",
      "thesis",
      "catalysts",
      "risks",
      "confidence",
      "timeHorizon",
      "keyMetrics",
      "verdict",
    ]);
  });

  it("produces an object identical to JSON.parse of the full output", () => {
    const s = new JsonFieldStreamer();
    for (const ch of VERDICT) s.push(ch);
    s.end();
    // This is the guarantee that makes streaming safe: the streamed report and
    // the non-streamed report are the SAME object, not merely similar.
    expect(s.result()).toEqual(JSON.parse(VERDICT));
  });

  it("is insensitive to chunk boundaries", () => {
    for (const size of [1, 2, 3, 7, 13, 64, 1000]) {
      const s = new JsonFieldStreamer();
      for (let i = 0; i < VERDICT.length; i += size) s.push(VERDICT.slice(i, i + size));
      s.end();
      expect(s.result(), `chunk size ${size}`).toEqual(JSON.parse(VERDICT));
    }
  });

  it("never emits a partial value — a field appears only once fully closed", () => {
    const s = new JsonFieldStreamer();

    // Feed a string value one character at a time; nothing may be emitted until
    // the closing quote arrives.
    const partial = '{"headline": "Apple is a';
    for (const ch of partial) {
      expect(s.push(ch)).toEqual([]);
    }

    // Still nothing — the string is open.
    expect(s.push(" great business")).toEqual([]);

    // Now close it.
    const emitted = s.push('"');
    expect(emitted).toEqual([{ key: "headline", value: "Apple is a great business" }]);
  });

  it("never emits a partial array — the whole array lands at once", () => {
    const s = new JsonFieldStreamer();
    expect(s.push('{"risks": ["China exposure"')).toEqual([]);
    expect(s.push(', "Flat unit growth"')).toEqual([]);
    const emitted = s.push("]");
    expect(emitted).toEqual([
      { key: "risks", value: ["China exposure", "Flat unit growth"] },
    ]);
  });

  it("handles nested objects inside arrays (keyMetrics)", () => {
    const emitted = streamCharByChar(VERDICT);
    const metrics = emitted.find((e) => e.key === "keyMetrics");
    expect(metrics?.value).toEqual([
      { label: "Forward P/E", value: "32.1x", signal: "negative" },
      { label: "ROE", value: "147%", signal: "positive" },
    ]);
  });

  it("strips a ```json code fence, which models emit constantly", () => {
    const fenced = "```json\n" + VERDICT + "\n```";
    const s = new JsonFieldStreamer();
    for (const ch of fenced) s.push(ch);
    s.end();
    expect(s.result()).toEqual(JSON.parse(VERDICT));
  });

  it("skips a prose preamble before the JSON", () => {
    const preamble = "Sure! Here is the investment verdict you asked for:\n\n" + VERDICT;
    const s = new JsonFieldStreamer();
    s.push(preamble);
    s.end();
    expect(s.result()).toEqual(JSON.parse(VERDICT));
  });

  it("ignores trailing commentary after the closing brace", () => {
    const s = new JsonFieldStreamer();
    s.push(VERDICT + "\n\nLet me know if you'd like more detail!");
    s.end();
    expect(s.result()).toEqual(JSON.parse(VERDICT));
  });

  it("handles escaped quotes inside string values", () => {
    const json = '{"thesis": "The CEO called it a \\"pivotal\\" year", "verdict": "bullish"}';
    const s = new JsonFieldStreamer();
    for (const ch of json) s.push(ch);
    s.end();
    expect(s.result()).toEqual({
      thesis: 'The CEO called it a "pivotal" year',
      verdict: "bullish",
    });
  });

  it("handles braces and brackets inside string values", () => {
    const json = '{"note": "use {this} and [that]", "verdict": "neutral"}';
    const s = new JsonFieldStreamer();
    s.push(json);
    s.end();
    expect(s.result()).toEqual({ note: "use {this} and [that]", verdict: "neutral" });
  });

  it("emits numbers, booleans, and nulls as scalars", () => {
    const json = '{"score": 73.5, "flagged": true, "target": null, "verdict": "neutral"}';
    const emitted = streamCharByChar(json);
    expect(emitted).toEqual([
      { key: "score", value: 73.5 },
      { key: "flagged", value: true },
      { key: "target", value: null },
      { key: "verdict", value: "neutral" },
    ]);
  });

  it("a truncated generation keeps the fields that DID complete", () => {
    // The model died mid-thesis. The headline was already complete and usable —
    // the user should keep it rather than lose the whole report.
    const truncated = '{"headline": "Apple margins justify the premium", "thesis": "Gross margin of';
    const s = new JsonFieldStreamer();
    const emitted = [...s.push(truncated), ...s.end()];

    expect(emitted).toEqual([
      { key: "headline", value: "Apple margins justify the premium" },
    ]);
    expect(s.result()).toEqual({ headline: "Apple margins justify the premium" });
  });

  it("skips one malformed field without killing the rest of the stream", () => {
    // `confidence` is unquoted — invalid JSON. It must be dropped, not crash,
    // and the fields after it must still arrive.
    const json = '{"headline": "ok", "confidence": high, "verdict": "bullish"}';
    const s = new JsonFieldStreamer();
    s.push(json);
    s.end();
    const result = s.result();
    expect(result.headline).toBe("ok");
    expect(result.verdict).toBe("bullish");
    expect(result).not.toHaveProperty("confidence");
  });

  it("handles an empty object", () => {
    const s = new JsonFieldStreamer();
    s.push("{}");
    s.end();
    expect(s.result()).toEqual({});
  });

  it("does not spin forever on garbage input", () => {
    const s = new JsonFieldStreamer();
    expect(() => {
      s.push("not json at all, no braces here");
      s.end();
    }).not.toThrow();
    expect(s.result()).toEqual({});
  });

  it("handles whitespace and newlines between every token", () => {
    const pretty = JSON.stringify(JSON.parse(VERDICT), null, 2);
    expect(streamInChunks(pretty, 5).length).toBe(8);
    const s = new JsonFieldStreamer();
    s.push(pretty);
    s.end();
    expect(s.result()).toEqual(JSON.parse(VERDICT));
  });
});
