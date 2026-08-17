/**
 * Decision Memory — what the investor has already considered and declined.
 *
 * The recommendation engine is deliberately stateless from FACTS (same book +
 * same policy ⇒ same candidate theses); this module is the statement that the
 * INVESTOR is not stateless. Dismissing "reduce QQQM" means "I have considered
 * this action — do not present it again unless something material changes."
 * It does NOT mean "QQQM may be any size forever" (that is a policy exception,
 * an explicit, different act in the policy editor).
 *
 * ── Identity: the THESIS, not the card ───────────────────────────────────────
 *
 * Suppression keys on the underlying action, not the generated id, wording,
 * size or surface. "Trim QQQM 25.4% → 20%" today and "Trim QQQM 26.1% → 20%"
 * tomorrow are the same thesis (`reduce:QQQM`); "add bond ballast via IEF" and
 * "via SHY" are the same thesis (`gap:no_bonds` — the gap is the idea, the
 * ticker is an implementation detail). This is what stops the same question
 * being re-asked under a fresh id.
 *
 * ── Revival: material change only ────────────────────────────────────────────
 *
 * A dismissal stores the context it was made in. The thesis returns only when
 *   • the POLICY changed since (the ruler moved — every standing judgment is
 *     due a rehearing), or
 *   • the SUBJECT got materially worse: the position grew ≥5pp past its
 *     weight at dismissal, or the owning theme's score fell ≥12pts below its
 *     level at dismissal (which is also how major market moves — drawdowns,
 *     correlation spikes — legitimately reopen a considered question), or
 *   • the investor restores it explicitly.
 * No silent time-based return: a considered "no" does not expire on a timer.
 *
 * Consumed in lib/portfolio/report.ts — BEFORE decision cards are built — so
 * Decisions, the Today attention queue, the home spotlight and the digest all
 * inherit one shared memory instead of independently rediscovering the same
 * rejected idea.
 */

import type { Recommendation } from "./recommend";
import type { PortfolioEvaluation } from "./simulate";

/** Position must grow this many pp beyond its dismissed-at weight to revive a reduce/exit thesis. */
export const REVIVE_WEIGHT_GAIN_PP = 5;
/** Owning theme must fall this many points below its dismissed-at score to revive any thesis. */
export const REVIVE_THEME_DROP_PTS = 12;

/** One persisted dismissal, with the context needed to judge revival. */
export interface DecisionDismissal {
  thesisKey: string;
  dismissedAt: string;
  /** policy.updatedAt at dismissal (null = assumed defaults). */
  policyUpdatedAt: string | null;
  /** The owning alignment theme and its score when dismissed, when known. */
  themeId: string | null;
  themeScore: number | null;
  /** For reduce:/exit: theses — the subject's weight when dismissed. */
  subjectWeightPct: number | null;
  /** The card title at dismissal — display only, so the restore list reads like a memory, not a hash. */
  title: string;
}

/**
 * The canonical identity of a recommendation's underlying action.
 *
 *   reduce:SYM   any trim of that position (whatever the % or wording)
 *   exit:SYM     any full exit of that position
 *   gap:KIND     any candidate filling that structural gap (ticker-agnostic;
 *                the engine's rec ids already carry this shape)
 *   discover:SYM a researched new-investment proposal for that symbol
 *
 * Falls back to the raw id for anything unrecognized — an unknown shape must
 * still be suppressible rather than silently exempt.
 */
export function thesisKeyOf(rec: Pick<Recommendation, "id" | "action" | "symbol" | "subject">): string {
  if (rec.id.startsWith("gap:")) return rec.id;
  if (rec.id.startsWith("discover:")) return rec.id;
  const subject = (rec.symbol ?? rec.subject ?? "").toUpperCase();
  if (rec.action === "REDUCE" && subject) return `reduce:${subject}`;
  if (rec.action === "SELL" && subject) return `exit:${subject}`;
  if (rec.action === "INVESTIGATE" && subject) return `discover:${subject}`;
  return rec.id;
}

/** The revival context captured WHEN dismissing — the baseline "material change" is measured against. */
export function dismissalContextFor(
  rec: Recommendation,
  evaluation: PortfolioEvaluation,
): Omit<DecisionDismissal, "dismissedAt"> {
  const themeId = rec.theme;
  const theme = themeId ? evaluation.alignment.themes.find((t) => t.id === themeId) : null;
  const subjectSymbol = rec.symbol?.toUpperCase() ?? null;
  const holding = subjectSymbol
    ? evaluation.holdings.find((h) => h.symbol?.toUpperCase() === subjectSymbol)
    : null;
  return {
    thesisKey: thesisKeyOf(rec),
    policyUpdatedAt: evaluation.policy.updatedAt,
    themeId: themeId ?? null,
    themeScore: theme?.score ?? null,
    subjectWeightPct: holding ? Math.round(holding.weight * 10) / 10 : null,
    title: rec.title,
  };
}

export interface DecisionMemoryVerdict {
  /** Theses still suppressed, with the reason they stay down. */
  suppressed: { rec: Recommendation; dismissal: DecisionDismissal }[];
  /** Recommendations that survive (not dismissed, or legitimately revived). */
  active: Recommendation[];
  /** Dismissed theses that REVIVED this build, with the material change that revived them. */
  revived: { rec: Recommendation; reason: string }[];
}

/**
 * Why a dismissed thesis is allowed back, or null to keep suppressing.
 * Deterministic; every revival names its cause so the card can say
 * "you dismissed this on {date}, but {reason}".
 */
export function revivalReason(
  d: DecisionDismissal,
  rec: Recommendation,
  evaluation: PortfolioEvaluation,
): string | null {
  // 1. The policy moved — every standing judgment gets a rehearing.
  if ((evaluation.policy.updatedAt ?? null) !== d.policyUpdatedAt) {
    return "your policy changed since you dismissed it";
  }

  // 2. The subject position got materially bigger (reduce/exit theses).
  if (d.subjectWeightPct != null && rec.symbol) {
    const holding = evaluation.holdings.find((h) => h.symbol?.toUpperCase() === rec.symbol!.toUpperCase());
    if (holding && holding.weight >= d.subjectWeightPct + REVIVE_WEIGHT_GAIN_PP) {
      return `${rec.symbol} grew from ${d.subjectWeightPct.toFixed(1)}% to ${holding.weight.toFixed(1)}% of the book since you dismissed it`;
    }
  }

  // 3. The owning theme deteriorated materially — the umbrella for market /
  //    fundamental change, since stress, correlation and drift all land there.
  if (d.themeId && d.themeScore != null) {
    const theme = evaluation.alignment.themes.find((t) => t.id === d.themeId);
    if (theme?.score != null && theme.score <= d.themeScore - REVIVE_THEME_DROP_PTS) {
      return `the ${theme.label} theme fell from ${d.themeScore} to ${theme.score} since you dismissed it`;
    }
  }

  return null;
}

/**
 * Partition freshly generated recommendations against the investor's memory.
 * Pure; called once per report build so every surface shares one verdict.
 */
export function applyDecisionMemory(
  recs: Recommendation[],
  dismissals: DecisionDismissal[],
  evaluation: PortfolioEvaluation,
): DecisionMemoryVerdict {
  const byKey = new Map(dismissals.map((d) => [d.thesisKey, d]));
  const active: Recommendation[] = [];
  const suppressed: DecisionMemoryVerdict["suppressed"] = [];
  const revived: DecisionMemoryVerdict["revived"] = [];

  for (const rec of recs) {
    const d = byKey.get(thesisKeyOf(rec));
    if (!d) {
      active.push(rec);
      continue;
    }
    const reason = revivalReason(d, rec, evaluation);
    if (reason) {
      revived.push({ rec, reason });
      active.push({
        ...rec,
        // The card owns its history: a revived thesis says why it is back
        // instead of pretending to be new.
        rationale: `${rec.rationale} (You dismissed this on ${new Date(d.dismissedAt).toLocaleDateString()}, but ${reason}.)`,
      });
    } else {
      suppressed.push({ rec, dismissal: d });
    }
  }

  return { active, suppressed, revived };
}
