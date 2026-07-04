/**
 * Robust JSON extraction from raw LLM responses.
 *
 * Small models like Mistral 7B frequently wrap JSON in preamble text
 * ("Here is the analysis:") and inconsistent markdown fences. This utility
 * handles all known patterns before falling back to raw JSON.parse so callers
 * never need to write their own fence-stripping logic.
 */

/**
 * Extract a JSON object or array from a raw LLM response string.
 * Throws SyntaxError if the response contains no parseable JSON.
 *
 * Strategies tried in order:
 *  1. Find the first `{`…last `}` (or `[`…`]`) substring and parse it
 *  2. Strip all markdown code fences and retry
 *  3. Attempt to parse the trimmed raw string directly
 */
export function extractJson<T>(raw: string): T {
  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");

  // Strategy 1a: outermost object
  if (firstBrace !== -1) {
    const lastBrace = raw.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as T;
      } catch { /* fall through */ }
    }
  }

  // Strategy 1b: outermost array
  if (firstBracket !== -1) {
    const lastBracket = raw.lastIndexOf("]");
    if (lastBracket > firstBracket) {
      try {
        return JSON.parse(raw.slice(firstBracket, lastBracket + 1)) as T;
      } catch { /* fall through */ }
    }
  }

  // Strategy 2: strip all markdown code fences and retry
  const stripped = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  return JSON.parse(stripped) as T;
}
