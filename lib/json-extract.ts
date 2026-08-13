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
 * small models routinely drop fields, and a bare `as T` cast then lies to
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
  return coerceParsedObject(parsed, defaults);
}

/**
 * The coercion half of {@link extractJsonObject}, for callers that already
 * hold a parsed value (the analysis seam delivers objects, not strings).
 * Same guarantees: every top-level key present, array-ness preserved,
 * defaults on any non-object input.
 */
export function coerceParsedObject<T extends Record<string, unknown>>(
  parsed: unknown,
  defaults: T,
): T {
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

/**
 * Like {@link extractJsonObject} but for TOP-LEVEL ARRAYS. Never throws.
 * - parse failure or non-array result → []
 * - if `sanitizeItem` is given, it maps each raw element to a valid item or null;
 *   nulls are dropped. Use it to guarantee per-item field presence.
 */
export function extractJsonArray<T>(
  raw: string,
  sanitizeItem?: (item: unknown) => T | null,
): T[] {
  let parsed: unknown;
  try {
    parsed = extractJson<unknown>(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  if (!sanitizeItem) return parsed as T[];
  const out: T[] = [];
  for (const item of parsed) {
    const v = sanitizeItem(item);
    if (v !== null) out.push(v);
  }
  return out;
}

/**
 * Salvage every complete JSON object out of a possibly-truncated array.
 *
 * A small model asked for a 20-item array of objects routinely runs out
 * of output budget mid-string, and one unterminated value at position 7716
 * makes `JSON.parse` reject the 12 perfectly good objects that came before it.
 * Discarding a whole stage's work over its last, incomplete entry is the wrong
 * trade — this walks the text with a brace-depth counter (string- and
 * escape-aware, so a `{` inside a rationale doesn't confuse it) and parses each
 * balanced `{…}` it closes, ignoring the trailing fragment.
 *
 * Strictly a fallback: callers should try `extractJsonArray` first, because a
 * well-formed response should be parsed as the single document it is.
 */
export function extractJsonObjectsLoose<T>(
  raw: string,
  sanitizeItem: (item: unknown) => T | null,
): T[] {
  const out: T[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) startIndex = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) continue;   // a stray closer before any opener
      depth--;
      if (depth === 0 && startIndex !== -1) {
        try {
          const value = sanitizeItem(JSON.parse(raw.slice(startIndex, i + 1)));
          if (value !== null) out.push(value);
        } catch {
          // One malformed object doesn't invalidate its siblings.
        }
        startIndex = -1;
      }
    }
  }
  return out;
}
