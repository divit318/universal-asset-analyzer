/**
 * Thesis → evidence → verdict, derived rather than written.
 *
 * The complaint this answers is that AI research prose states conclusions and
 * leaves the reader to trust them. Here the conclusion is the score the page
 * already shows, and the evidence is the actual factors that produced it: every
 * supporting and opposing line below is a `ScoreFactor` from the same
 * `ScoreResult` rendered by the conviction card, so the case can never drift
 * from the number it is explaining. No model is called.
 *
 * Callers may pass `extras` — evidence measured elsewhere on the page (capture
 * ratios from behavior.ts, portfolio overlap from overlap.ts) that the scorer
 * has no input for. Keeping that an explicit parameter, rather than importing
 * those modules here, is what stops this file from quietly becoming a second
 * scoring engine with its own opinion.
 */

import type { ScoreResult } from "../../types";
import { RECOMMENDATION_LABEL } from "../../recommendation";
import type { FundMandate } from "./exposure";
import { describeMandate } from "./exposure";

export interface EvidenceLine {
  label: string;
  detail: string;
  /** 0–1 share of the factor's available points, for ordering and weight. */
  strength: number;
}

export interface ThesisCase {
  thesis: string;
  supports: EvidenceLine[];
  against: EvidenceLine[];
  verdict: string;
}

/** Factor scored at or above this share of its max counts as support. */
const SUPPORT_AT = 0.6;
/** At or below this, it counts against. */
const AGAINST_AT = 0.4;

export interface ThesisInput {
  name: string;
  score: ScoreResult;
  mandate: FundMandate;
  extras?: { supports?: EvidenceLine[]; against?: EvidenceLine[] };
}

export function buildThesisCase({ name, score, mandate, extras }: ThesisInput): ThesisCase {
  const factors = score.buckets.flatMap((b) =>
    b.factors
      // "n/a" is `mk()`'s marker for a missing input, carrying half credit that
      // means nothing. Treating it as evidence either way would be inventing it.
      .filter((f) => f.detail !== "n/a" && f.detail !== "" && f.max > 0)
      .map((f) => ({ bucket: b.name, ...f, ratio: f.points / f.max })),
  );

  const supports: EvidenceLine[] = factors
    .filter((f) => f.ratio >= SUPPORT_AT)
    .sort((a, b) => b.ratio - a.ratio)
    .map((f) => ({ label: f.label, detail: f.detail, strength: f.ratio }));

  const against: EvidenceLine[] = factors
    .filter((f) => f.ratio <= AGAINST_AT)
    .sort((a, b) => a.ratio - b.ratio)
    .map((f) => ({ label: f.label, detail: f.detail, strength: 1 - f.ratio }));

  if (extras?.supports) supports.push(...extras.supports);
  if (extras?.against) against.push(...extras.against);

  /* ── Thesis ──────────────────────────────────────────────────────────────
     Named for the bucket actually carrying the score, so the sentence is a
     claim about this fund rather than a template. */
  const strongestBucket = score.buckets
    .filter((b) => b.max > 0)
    .slice()
    .sort((a, b) => b.points / b.max - a.points / a.max)[0];
  const weakestBucket = score.buckets
    .filter((b) => b.max > 0)
    .slice()
    .sort((a, b) => a.points / a.max - b.points / b.max)[0];

  const mandateWords = describeMandate(mandate);
  const subject = mandateWords ? `${mandateWords} exposure` : "this exposure";
  const thesis = strongestBucket
    ? `${name} is a way to own ${subject}, and the case for it rests on ${strongestBucket.name.toLowerCase()}.`
    : `${name} is a way to own ${subject}.`;

  /* ── Verdict ─────────────────────────────────────────────────────────────
     States the balance rather than repeating the score badge: which side of
     the evidence won, and what the reader gives up by taking it. */
  const label = RECOMMENDATION_LABEL[score.recommendation];
  const balance =
    supports.length > against.length
      ? `The supporting evidence outweighs the objections`
      : supports.length < against.length
        ? `The objections outnumber the supporting evidence`
        : `The evidence is genuinely balanced`;
  const cost = weakestBucket && strongestBucket && weakestBucket.name !== strongestBucket.name
    ? `, and the price of this exposure is ${weakestBucket.name.toLowerCase()}`
    : "";
  const verdict = `${balance}${cost} — ${score.composite}/100, ${label}.`;

  return { thesis, supports, against, verdict };
}
