import { describe, it, expect } from "vitest";
import { extractJson, extractJsonObject, extractJsonArray } from "@/lib/json-extract";

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

describe("extractJsonObject", () => {
  const defaults = { verdict: "hold", confidence: 0, actionItems: [] as string[] };

  it("returns parsed values when the model provides them", () => {
    const raw = '{"verdict":"buy","confidence":80,"actionItems":["trim NVDA"]}';
    expect(extractJsonObject(raw, defaults)).toEqual({
      verdict: "buy",
      confidence: 80,
      actionItems: ["trim NVDA"],
    });
  });

  it("fills omitted fields from defaults (the real crash case)", () => {
    // model dropped actionItems entirely
    const raw = '{"verdict":"buy","confidence":80}';
    const out = extractJsonObject(raw, defaults);
    expect(out.actionItems).toEqual([]);
    expect(Array.isArray(out.actionItems)).toBe(true);
  });

  it("keeps the default when a field is null", () => {
    const raw = '{"verdict":"sell","confidence":null,"actionItems":null}';
    const out = extractJsonObject(raw, defaults);
    expect(out.confidence).toBe(0);
    expect(out.actionItems).toEqual([]);
  });

  it("preserves array-ness when the model returns a non-array for an array field", () => {
    const raw = '{"actionItems":"just one string"}';
    expect(extractJsonObject(raw, defaults).actionItems).toEqual([]);
  });

  it("falls back to defaults on unparseable input instead of throwing", () => {
    expect(extractJsonObject("the model refused to answer", defaults)).toEqual(defaults);
  });

  it("falls back to defaults when the parse yields an array, not an object", () => {
    expect(extractJsonObject("[1,2,3]", defaults)).toEqual(defaults);
  });

  it("tolerates markdown-fenced partial objects", () => {
    const raw = '```json\n{"verdict":"buy"}\n```';
    const out = extractJsonObject(raw, defaults);
    expect(out.verdict).toBe("buy");
    expect(out.actionItems).toEqual([]);
  });

  it("does not mutate the caller's defaults object", () => {
    const d = { items: [] as number[] };
    extractJsonObject('{"items":[1,2]}', d);
    expect(d.items).toEqual([]);
  });
});

describe("extractJsonArray", () => {
  it("parses a clean top-level array", () => {
    const raw = '[{"symbol":"AAPL"},{"symbol":"MSFT"}]';
    expect(extractJsonArray<{ symbol: string }>(raw)).toEqual([
      { symbol: "AAPL" },
      { symbol: "MSFT" },
    ]);
  });

  it("returns [] on parse failure instead of throwing", () => {
    expect(extractJsonArray("the model refused to answer")).toEqual([]);
  });

  it("returns [] when the parsed result is an object, not an array", () => {
    expect(extractJsonArray('{"symbol":"AAPL"}')).toEqual([]);
  });

  it("parses fenced arrays", () => {
    const raw = '```json\n[1, 2, 3]\n```';
    expect(extractJsonArray<number>(raw)).toEqual([1, 2, 3]);
  });

  it("passes items through unchanged when no sanitizer is given", () => {
    const raw = '[{"a":1},{"b":2}]';
    expect(extractJsonArray(raw)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("uses sanitizeItem to validate and drop invalid rows", () => {
    const raw = '[{"symbol":"AAPL"},{"nope":true},{"symbol":"MSFT"}]';
    const out = extractJsonArray<{ symbol: string }>(raw, (item) => {
      const obj = item as { symbol?: unknown };
      return typeof obj.symbol === "string" ? { symbol: obj.symbol } : null;
    });
    expect(out).toEqual([{ symbol: "AAPL" }, { symbol: "MSFT" }]);
  });

  it("drops all items and returns [] when every item fails sanitizeItem", () => {
    const raw = '[{"nope":1},{"nope":2}]';
    const out = extractJsonArray<{ symbol: string }>(raw, (item) => {
      const obj = item as { symbol?: unknown };
      return typeof obj.symbol === "string" ? { symbol: obj.symbol } : null;
    });
    expect(out).toEqual([]);
  });
});
