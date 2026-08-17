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
 * and runs offline (no model, no network) as a regression net.
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
  /**
   * Claims whose NUMBER matched the evidence but whose sentence context
   * (entity, direction, metric, period/as-of) contradicts every fact that
   * number could have come from — "right number, wrong context". Only
   * populated by the facts-based verifier; empty for text-only verification.
   */
  contextViolations: string[];
}

/**
 * A tagged evidence figure for context-aware verification (audit F-22f).
 *
 * The text-based verifier can only prove a number was *transcribed* from the
 * evidence. Tagged facts let it also check the number was used in the right
 * sentence: about the right entity, with the right sign, as the right metric,
 * for the right period. Callers that already build structured fact sheets
 * (home brief, verdict facts, report sections) can verify at this level; free-
 * text evidence stays at transcription level — that boundary is the honest
 * statement of what the layer guarantees.
 */
export interface GroundedFact {
  value: number;
  kind: ClaimKind;
  /** Ticker/name this figure belongs to, e.g. "AAPL". */
  entity?: string | null;
  /** Canonical metric id — match against METRIC_LEXICON keys, e.g. "net margin". */
  metric?: string | null;
  /** "day" | "fy" | "quarter" | "yoy" | "sinceCost" — the period the value describes. */
  period?: string | null;
  /** Session day (YYYY-MM-DD) for day-basis figures — enables as-of checks. */
  sessionDate?: string | null;
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

/**
 * Unit-scale forgiveness for non-percent figures: financial tables state
 * values in thousands/millions/billions ("Revenue: 391,035" meaning $M) and a
 * model that correctly writes "$391B" was being flagged as fabricating —
 * observed live as 5/9 IC agents confidence-downgraded on reformatted
 * figures (ai-migration/10). The parity harness has scale-matched since
 * tranche 2; this ports the same tolerance to the production verifier.
 * Percents never scale (12% is not 12,000%).
 */
const UNIT_SCALES = [1e3, 1e6, 1e9] as const;

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
    if (claim.kind !== "percent" && ev.kind !== "percent") {
      for (const s of UNIT_SCALES) {
        if (Math.abs(claim.value - ev.value * s) <= relTol * Math.abs(ev.value * s)) return true;
        if (Math.abs(claim.value * s - ev.value) <= relTol * Math.abs(ev.value)) return true;
      }
    }
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
    contextViolations: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Context-aware verification against tagged facts (audit F-22f)              */
/* -------------------------------------------------------------------------- */

/** Words that assert a downward move. Stems, matched case-insensitively. */
const NEGATIVE_DIRECTION = /\b(declin\w*|fell|fall\w*|dropp?\w*|down|slipp?\w*|deteriorat\w*|shrank|shrink\w*|contract\w*|lost|loss)\b/i;
/** Words that assert an upward move. */
const POSITIVE_DIRECTION = /\b(grew|grow\w*|rose|rise\w*|gain\w*|up|increas\w*|climb\w*|advanc\w*|expand\w*|jump\w*|surg\w*)\b/i;

/** Sentence-level period markers → canonical period ids. */
const PERIOD_MARKERS: Array<[RegExp, string]> = [
  [/\b(quarterly|quarter|q[1-4])\b/i, "quarter"],
  [/\b(fiscal year|full[- ]year|fy\d{0,4}|annual(?:ly)?)\b/i, "fy"],
  [/\byear[- ]over[- ]year|yoy\b/i, "yoy"],
  [/\btoday|this session|intraday\b/i, "day"],
  [/\bsince (?:your )?(?:cost|purchase|entry)\b/i, "sinceCost"],
];

/**
 * Metric phrases the checker can recognize in a sentence. Longest match wins,
 * so "operating margin" is not swallowed by "margin". Facts should use these
 * exact ids in `metric`.
 */
const METRIC_LEXICON = [
  "operating margin",
  "net margin",
  "gross margin",
  "revenue growth",
  "eps growth",
  "revenue",
  "eps",
  "roe",
  "free cash flow",
  "dividend yield",
  "dividend",
  "market cap",
  "forward p/e",
  "trailing p/e",
  "p/e",
  "price target",
  "target",
  "upside",
  "alignment score",
] as const;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function factMatchesValue(claim: NumericClaim, fact: GroundedFact, relTol: number, absTol: number): boolean {
  if (!kindsComparable(claim.kind, fact.kind)) return false;
  const tol = Math.max(absTol, relTol * Math.abs(fact.value));
  return Math.abs(claim.value - fact.value) <= tol || roundsTo(fact.value, claim.value);
}

/** |claim| matches |fact| but the signs differ — a candidate direction flip. */
function matchesMagnitudeOnly(claim: NumericClaim, fact: GroundedFact, relTol: number, absTol: number): boolean {
  if (!kindsComparable(claim.kind, fact.kind)) return false;
  const tol = Math.max(absTol, relTol * Math.abs(fact.value));
  return Math.abs(Math.abs(claim.value) - Math.abs(fact.value)) <= tol && !factMatchesValue(claim, fact, relTol, absTol);
}

/**
 * The metric phrase governing THIS claim: the nearest lexicon phrase ending
 * within `range` chars before the number (dense stat sentences name many
 * metrics — "Price $X, ROE Y%, revenue +Z%" — and only the adjacent one is a
 * statement about the figure).
 */
function metricNearClaim(sentence: string, claimRaw: string, range = 48): string | null {
  const lower = sentence.toLowerCase();
  const at = lower.indexOf(claimRaw.trim().toLowerCase());
  if (at < 0) return null;
  // Clause-scoped: a metric named in an EARLIER clause is not a statement
  // about this figure ("…EPS growth of +28.7%, cheap at 32.5x forward
  // earnings" must not read "eps growth" as governing the 32.5x).
  const clauseStart = Math.max(lower.lastIndexOf(",", at), lower.lastIndexOf(";", at), lower.lastIndexOf(" — ", at)) + 1;
  let best: { m: string; end: number } | null = null;
  for (const m of METRIC_LEXICON) {
    let idx = lower.indexOf(m, clauseStart);
    while (idx >= 0) {
      const end = idx + m.length;
      if (end <= at + claimRaw.length && at - end <= range && (!best || end > best.end || (end === best.end && m.length > best.m.length))) {
        best = { m, end };
      }
      idx = lower.indexOf(m, idx + 1);
    }
  }
  return best?.m ?? null;
}

/** "revenue" names the same family as "revenue growth"; margins do not cross. */
function metricsRelated(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * The entity a claim is attributed to: the nearest ticker/alias mention BEFORE
 * the number, within the claim's own clause (comma/semicolon-delimited).
 * Financial prose attributes possessively — "Microsoft's revenue grew 16.4%" —
 * so the nearest preceding mention is the attribution in the overwhelming
 * case. Known miss: a back-referring clause ("AAPL outpaces MSFT with growth
 * of 16.4%") attributes to the SUBJECT but the nearest mention is MSFT; the
 * cost of that false positive is a regeneration, not a wrong figure on screen.
 */
function entityNearClaim(
  sentence: string,
  claimRaw: string,
  entities: Set<string>,
  aliases: Record<string, string[]> | undefined,
): string | null {
  const lower = sentence.toLowerCase();
  const at = lower.indexOf(claimRaw.trim().toLowerCase());
  if (at < 0) return null;
  const clauseStart = Math.max(lower.lastIndexOf(",", at), lower.lastIndexOf(";", at), lower.lastIndexOf(" — ", at)) + 1;
  const clause = lower.slice(clauseStart, at + claimRaw.length);
  let best: { e: string; idx: number } | null = null;
  for (const e of entities) {
    const names = [e, ...(aliases?.[e] ?? [])];
    for (const n of names) {
      const re = new RegExp(`\\b${n.toLowerCase()}(?:'s)?\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(clause))) {
        if (!best || m.index > best.idx) best = { e, idx: m.index };
      }
    }
  }
  return best?.e ?? null;
}

function periodOfSentence(sentence: string): string | null {
  for (const [re, id] of PERIOD_MARKERS) {
    if (re.test(sentence)) return id;
  }
  return null;
}

/**
 * Verify an answer against TAGGED facts: transcription first (does each number
 * exist at all?), then per-sentence context — entity, direction, metric,
 * period, and day-figure as-of (a "today" claim whose only matching fact
 * describes a finished session older than the previous one is a violation:
 * the AAPL -8.7% case, where every number was individually real).
 *
 * What this still cannot catch: claims with no numbers, causal misattribution,
 * misleading-but-true framing, arithmetic the model derived itself, and
 * anything verified against free text rather than tagged facts.
 */
export function verifyGroundingWithFacts(
  output: string,
  facts: GroundedFact[],
  opts: VerifyOptions & {
    now?: number;
    /**
     * Additional free-text evidence for the TRANSCRIPTION pass only (e.g. the
     * full prompt, whose prose may legitimately contain figures beyond the
     * tagged facts). Context checks still run against the tagged facts alone.
     */
    extraEvidence?: string;
    /** Company-name aliases per entity ticker, e.g. { AAPL: ["Apple"] }. */
    entityAliases?: Record<string, string[]>;
  } = {},
): GroundingReport {
  const relTol = opts.relTol ?? 0.04;
  const absTol = opts.absTol ?? 0.1;
  const now = opts.now ?? Date.now();

  // Base transcription pass against a text rendering of the facts.
  const evidenceText =
    facts
      .map((f) => `${f.entity ?? ""} ${f.metric ?? ""}: ${f.value}${f.kind === "percent" ? "%" : f.kind === "multiple" ? "x" : ""} ${f.period ?? ""}`)
      .join("\n") + (opts.extraEvidence ? `\n${opts.extraEvidence}` : "");
  const base = verifyGrounding(output, evidenceText, opts);

  const entities = new Set(facts.map((f) => f.entity?.toUpperCase()).filter((e): e is string => !!e));
  const contextViolations: string[] = [];

  for (const sentence of sentencesOf(output)) {
    const claims = extractNumericClaims(sentence);
    if (claims.length === 0) continue;

    const mentioned = [...entities].filter((e) => {
      if (new RegExp(`\\b${e}\\b`, "i").test(sentence)) return true;
      const aliases = opts.entityAliases?.[e] ?? [];
      return aliases.some((a) => new RegExp(`\\b${a}\\b`, "i").test(sentence));
    });
    const sentencePeriod = periodOfSentence(sentence);
    const negative = NEGATIVE_DIRECTION.test(sentence);
    const positive = POSITIVE_DIRECTION.test(sentence);

    // Which way the sentence says things moved, when it says so unambiguously.
    const dirStated: "up" | "down" | null = negative !== positive ? (negative ? "down" : "up") : null;

    for (const claim of claims) {
      const valueMatches = facts.filter((f) => factMatchesValue(claim, f, relTol, absTol));
      const signFlips = facts.filter((f) => matchesMagnitudeOnly(claim, f, relTol, absTol));

      // Standard financial prose states magnitude + direction word ("down
      // 8.7%") for a signed figure (-8.7). A magnitude match whose sign AGREES
      // with the stated direction is a legitimate match and flows into the
      // context checks below; one that DISAGREES is a direction inversion.
      let matched = valueMatches;
      if (matched.length === 0 && signFlips.length > 0) {
        if (!dirStated) continue; // ambiguous — leave to the base pass
        const consistent = signFlips.filter((f) => (f.value < 0) === (dirStated === "down"));
        if (consistent.length > 0) {
          matched = consistent;
        } else {
          contextViolations.push(
            `"${claim.raw.trim()}": magnitude matches ${signFlips[0].metric ?? "a figure"} of ${signFlips[0].value}, but the sentence asserts the opposite direction`,
          );
          continue;
        }
      }
      if (matched.length === 0) continue; // pure fabrication — already in unsupportedNumbers

      // Direction: the sentence asserts a move; every signed-change fact this
      // number matches moved the OTHER way ("revenue declined 16.4%" against
      // a +16.4% growth fact).
      if (dirStated) {
        const signed = matched.filter(
          (f) =>
            f.kind === "percent" &&
            (f.period === "yoy" || f.period === "day" || /growth|change/i.test(f.metric ?? "")),
        );
        if (signed.length > 0 && signed.every((f) => (f.value < 0) !== (dirStated === "down"))) {
          contextViolations.push(
            `"${claim.raw.trim()}": matches ${signed[0].metric ?? "a figure"} of ${signed[0].value}, but the sentence asserts the opposite direction`,
          );
          continue;
        }
      }

      // Entity: this claim is attributed (nearest preceding mention in its
      // clause) to an entity none of its matching facts belong to — the
      // "MSFT's revenue grew 16.4%" swap, where the number is AAPL's.
      const nearEntity = entityNearClaim(sentence, claim.raw, entities, opts.entityAliases);
      if (nearEntity) {
        const entityOk = matched.some((f) => !f.entity || f.entity.toUpperCase() === nearEntity);
        if (!entityOk) {
          contextViolations.push(
            `"${claim.raw.trim()}": belongs to ${matched.map((f) => f.entity).filter(Boolean).join("/")}, but the sentence attributes it to ${nearEntity}`,
          );
          continue;
        }
      } else if (mentioned.length > 0) {
        // No attribution found near the claim — fall back to sentence-level
        // membership (weaker, but catches a single-entity sentence).
        const entityOk = matched.some((f) => !f.entity || mentioned.includes(f.entity.toUpperCase()));
        if (!entityOk) {
          contextViolations.push(
            `"${claim.raw.trim()}": belongs to ${matched.map((f) => f.entity).filter(Boolean).join("/")}, but the sentence is about ${mentioned.join("/")}`,
          );
          continue;
        }
      }

      // Metric: the phrase ADJACENT to this number names a metric; every fact
      // this number matches carries an unrelated label, while the named metric
      // exists in the facts with another value — the "net vs operating margin"
      // swap. Adjacency (not whole-sentence) keeps dense stat sentences
      // ("Price $X, ROE Y%, revenue +Z%") from cross-firing.
      const nearMetric = metricNearClaim(sentence, claim.raw);
      if (nearMetric) {
        const labelled = matched.filter((f) => f.metric);
        const metricOk = labelled.length === 0 || labelled.some((f) => metricsRelated(f.metric!, nearMetric));
        const namedElsewhere = facts.some(
          (f) => f.metric && metricsRelated(f.metric, nearMetric) && !matched.includes(f),
        );
        if (!metricOk && namedElsewhere) {
          contextViolations.push(
            `"${claim.raw.trim()}": is ${labelled[0].metric}, but the sentence calls it ${nearMetric}`,
          );
          continue;
        }
      }

      // Period: the sentence claims a period; no matching fact carries it,
      // while the facts DO know this number's period — FY revenue sold as a
      // quarter, since-cost sold as today.
      if (sentencePeriod) {
        const withPeriod = matched.filter((f) => f.period);
        const periodOk = withPeriod.length === 0 || withPeriod.some((f) => f.period === sentencePeriod);
        if (!periodOk) {
          contextViolations.push(
            `"${claim.raw.trim()}": is a ${withPeriod[0].period} figure, but the sentence presents it as ${sentencePeriod}`,
          );
          continue;
        }
        // As-of: "today" backed only by day-figures from finished sessions —
        // the F-22 homepage case, where every number was individually real.
        if (sentencePeriod === "day") {
          const dayFacts = matched.filter((f) => f.period === "day");
          const staleOnly =
            dayFacts.length > 0 &&
            dayFacts.every((f) => {
              if (!f.sessionDate) return false;
              const gap = now - Date.parse(`${f.sessionDate}T00:00:00`);
              return gap > 3 * 24 * 3_600_000;
            });
          if (staleOnly) {
            contextViolations.push(
              `"${claim.raw.trim()}": presented as today, but the matching figure describes the ${dayFacts[0].sessionDate} session`,
            );
          }
        }
      }
    }
  }

  // Context violations are wrong claims made of real numbers — score them
  // exactly as harshly as fabrications.
  const claims = base.numbersChecked;
  const bad = Math.min(claims, base.unsupportedNumbers.length + contextViolations.length);
  const numericSupport = claims === 0 ? 1 : (claims - bad) / claims;
  const citationValidity =
    base.citedTags.length === 0 ? 1 : (base.citedTags.length - base.invalidCitations.length) / base.citedTags.length;
  const groundingScore = round2(0.75 * numericSupport + 0.25 * citationValidity);

  const flags = [...base.flags];
  if (contextViolations.length > 0) {
    flags.unshift(
      `${contextViolations.length} figure(s) match the evidence but contradict their sentence's context: ${contextViolations[0]}${contextViolations.length > 1 ? " …" : ""}`,
    );
  }

  return {
    ...base,
    contextViolations,
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
