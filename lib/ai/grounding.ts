/**
 * Grounding Verification Layer — the enforcement half of the copilot's
 * "ground every claim, never invent numbers" contract.
 *
 * The prompt layer (lib/ai/prompt.ts) *asks* the model to cite its sources and
 * refuse to fabricate figures. Nothing, until now, *checked* that it did. This
 * module closes that loop: given a generated answer and the evidence it was
 * supposed to reason over, it
 *
 *   1. extracts the `[source:tag]` citations the model emitted and flags any
 *      that do not correspond to a real evidence source, and
 *   2. extracts every financial figure in the answer and traces it back to a
 *      compatible number in the evidence, flagging figures that appear nowhere
 *      (candidate fabrications).
 *
 * It returns a GroundingReport with a 0–1 score and human-readable flags. This
 * replaces the platform's cosmetic "confidence" affordances with a signal
 * derived from the actual output, and — because it takes plain strings — it is
 * reusable by every AI feature (copilot, IC agents, verdict, compare, thematic),
 * not just the copilot.
 *
 * Everything here is pure and dependency-free so it is trivially unit-testable
 * and runs offline (no Ollama, no network) as a regression net.
 *
 * Design bias: a *false* "unsupported" (flagging a correct number as fabricated)
 * erodes trust in the verifier itself, so the matcher is deliberately tolerant —
 * it forgives rounding, formatting, magnitude suffixes, and locale separators,
 * and skips tokens that are not financial claims (years, small counts, filing
 * form numbers). We would rather miss a borderline fabrication than cry wolf on
 * a real figure.
 */

/** What kind of quantity a figure represents — governs cross-matching. */
export type ClaimKind = "percent" | "multiple" | "magnitude" | "plain";

/** A financial figure lifted out of a block of text. */
export interface NumericClaim {
  /** The matched substring, e.g. "$1.2B", "12.3%", "15x". */
  raw: string;
  /** Canonical numeric value: percents/multiples as-is; magnitudes scaled out. */
  value: number;
  kind: ClaimKind;
}

/** The verdict for one generated answer against its evidence. */
export interface GroundingReport {
  /** Distinct citation tags the answer emitted, first-seen order. */
  citedTags: string[];
  /** Cited tags that match no provided source (only computed when the allowed
   *  set is known). These are fabricated citations. */
  invalidCitations: string[];
  /** How many financial figures were evaluated. */
  numbersChecked: number;
  /** Figures (as written) that could not be traced to the evidence. */
  unsupportedNumbers: string[];
  /** Composite 0–1 grounding score (higher = better grounded). */
  groundingScore: number;
  /** Coarse label derived from the score, for UI. */
  level: "high" | "medium" | "low";
  /** Human-readable warnings, most important first. */
  flags: string[];
}

export interface VerifyOptions {
  /**
   * The source tags that legitimately exist in the evidence (e.g. the
   * `source` of every ContextBlock: "yahoo:valuation", "edgar:statements"…).
   * When provided, citations outside this set are flagged as invalid. When
   * omitted, citation validity is not scored (we can't know what was allowed).
   */
  allowedTags?: string[];
  /** Relative tolerance for matching a figure to the evidence. Default 0.04. */
  relTol?: number;
  /** Absolute tolerance floor (helps small percents like 0.9%→"1%"). Default 0.1. */
  absTol?: number;
}

/* -------------------------------------------------------------------------- */
/* Citations                                                                  */
/* -------------------------------------------------------------------------- */

// Matches the copilot's citation convention: [source:tag] or a bare [news].
// Tag bodies allow letters, digits, spaces and a few punctuation marks so
// "[edgar:10-K 2024-11-01]" resolves as one tag.
const CITATION_RE = /\[([a-z][a-z0-9]*(?::[^\]]+)?|news)\]/gi;

/** Extract distinct citation tags from an answer, in first-seen order. Pure. */
export function extractCitationTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    const tag = m[1].toLowerCase().trim();
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * A cited tag is valid if its source prefix (the part before the first ":")
 * matches the prefix of any allowed source tag. We match on prefix rather than
 * the whole tag because the model legitimately narrows a source — citing
 * "[edgar:10-K]" against an allowed "edgar:statements" source, or "[news:2]"
 * against "news". Exact-tag matching would flag those correct citations.
 */
function isCitationValid(tag: string, allowedPrefixes: Set<string>): boolean {
  const prefix = tag.split(":", 1)[0];
  return allowedPrefixes.has(prefix);
}

/* -------------------------------------------------------------------------- */
/* Numeric claims                                                             */
/* -------------------------------------------------------------------------- */

// Currency symbols and words that may precede a figure.
const CURRENCY_LEAD = /^(?:US\$|Rs\.?|INR|USD|EUR|GBP|[$₹€£])$/i;

// Magnitude suffixes → multiplier. Indian "cr"/"crore" (1e7) and "lakh" (1e5)
// are included because the platform covers NSE equities.
const SCALE: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  mm: 1e6,
  bn: 1e9,
  b: 1e9,
  t: 1e12,
  tn: 1e12,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
};

// One pass tokenizer. Captures an optional leading currency symbol, the number
// body (sign, digits, locale separators, decimals), and an optional trailing
// unit: %, x (multiple), or a magnitude word/suffix.
const NUMBER_RE =
  /(US\$|Rs\.?|INR|USD|[$₹€£])?\s?([+-]?\d[\d,]*(?:\.\d+)?)\s?(%|x\b|bps\b|cr(?:ores?)?\b|lakhs?\b|lac\b|mm\b|bn\b|tn\b|[kmbt]\b)?/gi;

// Filing forms ("10-K", "8-K", "S-1") and ISO-ish dates carry digits we must
// not read as financial claims. Stripped before scanning.
const NOISE_RE = /\b(?:10-K|10-Q|8-K|6-K|S-1|20-F|13[DFG])\b|\b\d{4}-\d{2}-\d{2}\b/gi;

function normalizeNumber(body: string): number {
  return parseFloat(body.replace(/,/g, ""));
}

/**
 * Extract financial figures from text. Skips tokens that are not investment
 * claims: 4-digit years, and bare small integers (≤ 12, no unit) which are
 * overwhelmingly list counts / section numbers in prose. Pure.
 */
export function extractNumericClaims(text: string): NumericClaim[] {
  const cleaned = text.replace(NOISE_RE, " ");
  const claims: NumericClaim[] = [];

  for (const m of cleaned.matchAll(NUMBER_RE)) {
    const [, lead, body, unitRaw] = m;
    if (body == null) continue;
    const value = normalizeNumber(body);
    if (!Number.isFinite(value)) continue;

    const unit = unitRaw?.toLowerCase();
    const hasCurrency = !!lead && CURRENCY_LEAD.test(lead.trim());
    const isInteger = Number.isInteger(value) && !body.includes(".");

    let kind: ClaimKind;
    let scaled = value;

    if (unit === "%") {
      kind = "percent";
    } else if (unit === "x" || unit === "bps") {
      kind = "multiple";
    } else if (unit && SCALE[unit] != null) {
      kind = "magnitude";
      scaled = value * SCALE[unit];
    } else if (hasCurrency) {
      kind = "magnitude";
    } else {
      kind = "plain";
    }

    // Skip rules — only for unitless plain integers.
    if (kind === "plain") {
      if (isInteger && value >= 1900 && value <= 2099) continue; // year
      if (isInteger && Math.abs(value) <= 12) continue; // list count / section no.
    }

    claims.push({ raw: (lead ? lead + " " : "") + body + (unitRaw ?? ""), value: scaled, kind });
  }

  return claims;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

/** Two figures are cross-comparable unless exactly one is a percent. A percent
 *  and a dollar amount are different scales and must never match; everything
 *  else (a P/E written "15", "15x", or a magnitude) may legitimately coincide. */
function kindsComparable(a: ClaimKind, b: ClaimKind): boolean {
  return (a === "percent") === (b === "percent");
}

function figureSupported(
  claim: NumericClaim,
  evidence: NumericClaim[],
  relTol: number,
  absTol: number,
): boolean {
  for (const ev of evidence) {
    if (!kindsComparable(claim.kind, ev.kind)) continue;
    const tol = Math.max(absTol, relTol * Math.abs(ev.value));
    if (Math.abs(claim.value - ev.value) <= tol) return true;
    // Precision-aware: "18" grounded by "17.94" (evidence rounded to the
    // answer's displayed precision).
    if (roundsTo(ev.value, claim.value)) return true;
  }
  return false;
}

/** True when `precise` rounds to `shown` at the decimal precision `shown` is
 *  written to (integer or one/two decimals). */
function roundsTo(precise: number, shown: number): boolean {
  for (const dp of [0, 1, 2]) {
    const f = 10 ** dp;
    if (Math.round(precise * f) / f === Math.round(shown * f) / f) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

function scoreToLevel(score: number): GroundingReport["level"] {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

/**
 * Verify a generated answer against the evidence it was grounded in.
 *
 * @param output   the model's answer
 * @param evidence the concatenated evidence text the model was given
 * @param opts     allowed source tags + matching tolerances
 */
export function verifyGrounding(
  output: string,
  evidence: string,
  opts: VerifyOptions = {},
): GroundingReport {
  const relTol = opts.relTol ?? 0.04;
  const absTol = opts.absTol ?? 0.1;

  // --- Citations ---
  const citedTags = extractCitationTags(output);
  let invalidCitations: string[] = [];
  if (opts.allowedTags) {
    const allowedPrefixes = new Set(
      opts.allowedTags.map((t) => t.toLowerCase().split(":", 1)[0]),
    );
    invalidCitations = citedTags.filter((t) => !isCitationValid(t, allowedPrefixes));
  }

  // --- Numeric grounding ---
  const claims = extractNumericClaims(output);
  const evidenceClaims = extractNumericClaims(evidence);
  const unsupportedNumbers: string[] = [];
  for (const c of claims) {
    if (!figureSupported(c, evidenceClaims, relTol, absTol)) {
      unsupportedNumbers.push(c.raw.trim());
    }
  }

  // --- Score: numbers dominate (fabricated figures are the worst failure),
  //     citation validity is a secondary signal. ---
  const numericSupport =
    claims.length === 0 ? 1 : (claims.length - unsupportedNumbers.length) / claims.length;
  const citationValidity =
    citedTags.length === 0 ? 1 : (citedTags.length - invalidCitations.length) / citedTags.length;
  const groundingScore = round2(0.75 * numericSupport + 0.25 * citationValidity);

  // --- Flags ---
  const flags: string[] = [];
  if (unsupportedNumbers.length > 0) {
    const preview = unsupportedNumbers.slice(0, 4).join(", ");
    flags.push(
      `${unsupportedNumbers.length} of ${claims.length} figures could not be traced to the evidence: ${preview}${unsupportedNumbers.length > 4 ? "…" : ""}`,
    );
  }
  if (invalidCitations.length > 0) {
    flags.push(
      `Citation${invalidCitations.length > 1 ? "s" : ""} to no known source: ${invalidCitations.map((t) => `[${t}]`).join(", ")}`,
    );
  }
  if (opts.allowedTags && citedTags.length === 0 && claims.length > 0) {
    flags.push("Makes quantitative claims but cites no sources.");
  }

  return {
    citedTags,
    invalidCitations,
    numbersChecked: claims.length,
    unsupportedNumbers,
    groundingScore,
    level: scoreToLevel(groundingScore),
    flags,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Join a set of prose fields — strings or string arrays, any of them nullable —
 * into one block for verification, dropping empties. Structured AI features
 * (verdict, compare, IC agents) return JSON; this collects their free-text
 * fields (thesis, catalysts, findings…) to check while ignoring the JSON keys
 * and enum fields that aren't claims. Pure.
 */
export function collectClaimText(
  fields: Array<string | string[] | null | undefined>,
): string {
  const out: string[] = [];
  for (const f of fields) {
    if (!f) continue;
    if (Array.isArray(f)) out.push(...f.filter(Boolean));
    else out.push(f);
  }
  return out.join("\n");
}
