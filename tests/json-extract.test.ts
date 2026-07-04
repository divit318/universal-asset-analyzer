import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/json-extract";

describe("extractJson", () => {
  it("parses clean JSON objects", () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses clean JSON arrays", () => {
    expect(extractJson<number[]>("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n{"verdict": "bullish"}\n```';
    expect(extractJson<{ verdict: string }>(raw)).toEqual({ verdict: "bullish" });
  });

  it("ignores preamble and trailing prose around an object", () => {
    const raw = 'Here is the analysis you asked for:\n{"score": 72}\nLet me know if you need more.';
    expect(extractJson<{ score: number }>(raw)).toEqual({ score: 72 });
  });

  it("ignores preamble around an array", () => {
    const raw = "Sure! The mappings are:\n[{\"symbol\": \"AAPL\", \"tier\": 1}]";
    expect(extractJson<{ symbol: string; tier: number }[]>(raw)).toEqual([
      { symbol: "AAPL", tier: 1 },
    ]);
  });

  it("handles nested braces inside string values", () => {
    const raw = '{"note": "uses {curly} braces", "ok": true}';
    expect(extractJson<{ note: string; ok: boolean }>(raw)).toEqual({
      note: "uses {curly} braces",
      ok: true,
    });
  });

  it("prefers the object when an earlier stray bracket exists", () => {
    const raw = 'Ranked [1] overall: {"rank": 1}';
    expect(extractJson<{ rank: number }>(raw)).toEqual({ rank: 1 });
  });

  it("throws SyntaxError when no JSON is present", () => {
    expect(() => extractJson("no json here at all")).toThrow(SyntaxError);
  });

  it("throws on truncated JSON", () => {
    expect(() => extractJson('{"a": 1, "b":')).toThrow();
  });
});
