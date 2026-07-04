/**
 * Robust JSON extraction from raw LLM responses.
 *
 * Small models like Mistral 7B frequently wrap JSON in preamble text
 * ("Here is the analysis:") and inconsistent markdown fences. This utility
 * handles all known patterns before falling back to raw JSON.parse so callers
 * never need to write their own fence-stripping logic.
 */

interface Span {
  start: number;
  end: number; // inclusive index of the closing delimiter
}

function outermostSpan(raw: string, open: string, close: string): Span | null {
  const start = raw.indexOf(open);
  if (start === -1) return null;
  const end = raw.lastIndexOf(close);
  return end > start ? { start, end } : null;
}

function tryParseSpan(raw: string, span: Span | null): { value: unknown } | null {
  if (!span) return null;
  try {
    return { value: JSON.parse(raw.slice(span.start, span.end + 1)) };
  } catch {
    return null;
  }
}

/**
 * Extract a JSON object or array from a raw LLM response string.
 * Throws SyntaxError if the response contains no parseable JSON.
 *
 * Strategies tried in order:
 *  1. Outermost `{`…`}` and `[`…`]` spans; when both parse, the enclosing
 *     container wins (so `[{…}]` returns the array, while a stray `[1]` in
 *     prose before an object still returns the object)
 *  2. Strip all markdown code fences and retry
 *  3. Attempt to parse the trimmed raw string directly
 */
export function extractJson<T>(raw: string): T {
  const objSpan = outermostSpan(raw, "{", "}");
  const arrSpan = outermostSpan(raw, "[", "]");
  const obj = tryParseSpan(raw, objSpan);
  const arr = tryParseSpan(raw, arrSpan);

  if (obj && arr) {
    const arrEncloses =
      arrSpan!.start < objSpan!.start && arrSpan!.end > objSpan!.end;
    return (arrEncloses ? arr.value : obj.value) as T;
  }
  if (obj) return obj.value as T;
  if (arr) return arr.value as T;

  // Strategy 2/3: strip all markdown code fences and parse what remains.
  const stripped = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  return JSON.parse(stripped) as T;
}
