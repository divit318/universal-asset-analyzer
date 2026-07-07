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

/**
 * Like {@link extractJson}, but SCHEMA-SAFE: coerces the parsed object against a
 * caller-supplied `defaults` shape so callers never crash on a field the model
 * omitted. `extractJson` only guarantees *parseable* JSON, not *complete* JSON —
 * small local models routinely drop fields, and a bare `as T` cast then lies to
 * TypeScript (observed: a missing `actionItems` array crashed the portfolio brief).
 *
 * Guarantees the returned object has every top-level key present with a value of
 * the same broad kind as its default:
 *  - a missing / null / undefined field falls back to its default
 *  - a field whose default is an array but whose parsed value is NOT an array
 *    falls back to the default (prevents `.map`/`.length` crashes)
 *  - on any parse failure, or a non-object result, returns a copy of `defaults`
 *
 * It does not recurse into nested objects — pass conservative defaults (e.g.
 * empty arrays) for the fields the UI iterates, which is where crashes occur.
 */
export function extractJsonObject<T extends Record<string, unknown>>(
  raw: string,
  defaults: T,
): T {
  let parsed: unknown;
  try {
    parsed = extractJson<unknown>(raw);
  } catch {
    return { ...defaults };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...defaults };
  }
  const src = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const dv = defaults[key];
    const pv = src[key];
    if (pv === undefined || pv === null) continue; // keep default
    if (Array.isArray(dv) && !Array.isArray(pv)) continue; // preserve array-ness
    out[key] = pv;
  }
  return out as T;
}
