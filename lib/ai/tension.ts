/**
 * The research brief — deterministic synthesis, computed BEFORE the model runs.
 *
 * ## Why this exists
 *
 * The verdict prompt used to hand the model a flat list of ~30 metrics
 * ("Forward P/E: 13.79x", "ROE: 8.0%", …) and ask for "a structured investment
 * verdict". Two things follow from that design, and both were visible in the
 * output:
 *
 *   1. **The model restates.** Given a list of numbers and no analysis, the
 *      cheapest correct answer is to read the numbers back. Every figure it
 *      quoted was already on screen in a card, so the verdict added narration
 *      but no information. That is the "AI slop" complaint, and it is a
 *      property of the INPUT, not of the model or the wording of the prompt.
 *   2. **Whatever synthesis appeared was luck.** When a DIS verdict did name
 *      the real tension (analysts bullish, growth weak), nothing in the
 *      pipeline had asked for it — the model happened to notice. A property
 *      you get by accident is a property you cannot rely on.
 *
 * So the interesting work is moved out of the model and into code. This module
 * computes, from data the platform already has:
 *
 *   - **signals** — every scored dimension on one 0–100 scale, so they are
 *     comparable at all;
 *   - **conflicts** — the pairs that genuinely disagree, ranked by how far
 *     apart they are. This is the thing worth writing about, and it is now
 *     identified deterministically rather than hoped for;
 *   - **trends** — multi-year direction for margins, revenue and FCF. The old
 *     fact block carried only point-in-time YoY, so the model could not
 *     distinguish "margins improving" from "margins high", which is most of
 *     what matters in a turnaround;
 *   - **triggers** — the measurable thresholds that would move the verdict,
 *     derived from whichever buckets are actually weak.
 *
 * The model's remaining job is to explain the conflict in plain English. That
 * is a job it is good at, and it is the only part of this that a human analyst
 * would call judgment.
 *
 * Everything here is pure: `CompanyContext` in, plain data out. No I/O, no
 * model, unit-testable in isolation (tests/ai-tension.test.ts).
 */

import type { CompanyContext } from "./types";
import type { AnnualPoint, FinancialStatements, ScoreResult } from "../types";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** One scored dimension, normalized to 0–100 so dimensions can be compared. */
export interface SignalReading {
  key: string;
  /** Display name — matches the Conviction tab's bucket label exactly. */
  label: string;
  score: number;
  stance: "supportive" | "opposed" | "mixed";
  /** The evidence behind the number, when the bucket supplied any. */
  detail: string | null;
}

/** Two signals that disagree. The gap is what makes it worth writing about. */
export interface Conflict {
  positive: SignalReading;
  negative: SignalReading;
  /** Points of disagreement (0–100). Higher = sharper tension. */
  gap: number;
  /** One line stating the disagreement in the product's own vocabulary. */
  statement: string;
}

/** Multi-year direction for one line item. */
export interface TrendReading {
  label: string;
  direction: "improving" | "deteriorating" | "flat";
  detail: string;
}

export interface ResearchBrief {
  signals: SignalReading[];
  conflicts: Conflict[];
  trends: TrendReading[];
  /** Measurable events that would change the verdict. */
  triggers: string[];
  strongestPositives: string[];
  strongestNegatives: string[];
  /** True when the evidence is genuinely one-directional (no conflict found). */
  coherent: boolean;
}

/* -------------------------------------------------------------------------- */
/* Signals                                                                     */
/* -------------------------------------------------------------------------- */

/** ≥ this is a supportive signal; ≤ OPPOSED is an opposing one. Between = mixed. */
const SUPPORTIVE = 60;
const OPPOSED = 45;
/** Below this gap two signals are not really disagreeing, just differing. */
const MIN_CONFLICT_GAP = 25;

function stanceOf(score: number): SignalReading["stance"] {
  if (score >= SUPPORTIVE) return "supportive";
  if (score <= OPPOSED) return "opposed";
  return "mixed";
}

/**
 * Every scored dimension on one scale.
 *
 * Score buckets are points/max; analyst consensus is derived from the ratings
 * split rather than the bucket, because the bucket blends target upside into
 * the same number and the disagreement worth surfacing is specifically
 * "what analysts think" vs "what our engine thinks" (§17).
 */
export function readSignals(ctx: CompanyContext): SignalReading[] {
  const out: SignalReading[] = [];
  const score = ctx.score;

  if (score) {
    for (const b of score.buckets) {
      if (b.max <= 0) continue;
      const pct = Math.round((b.points / b.max) * 100);
      // Factors carry the "why" the Conviction tab renders; reuse them so the
      // brief and the UI can never describe the same bucket differently.
      const detail = b.factors
        .filter((f) => f.detail && f.detail !== "n/a")
        .map((f) => f.detail)
        .join("; ");
      out.push({
        key: b.name.toLowerCase().replace(/\s+/g, "-"),
        label: b.name,
        score: pct,
        stance: stanceOf(pct),
        detail: detail || null,
      });
    }
  }

  const a = ctx.analyst;
  if (a) {
    const bullish = a.strongBuy + a.buy;
    const bearish = a.sell + a.strongSell;
    const total = bullish + a.hold + bearish;
    if (total > 0) {
      // Share of the panel that is positive, on the same 0–100 scale.
      const pct = Math.round((bullish / total) * 100);
      out.push({
        key: "analyst-consensus",
        label: "Analyst consensus",
        score: pct,
        stance: stanceOf(pct),
        detail: `${bullish} buy / ${a.hold} hold / ${bearish} sell of ${total}${
          a.upsidePercent != null
            ? `; mean target implies ${a.upsidePercent >= 0 ? "+" : ""}${a.upsidePercent.toFixed(1)}%`
            : ""
        }`,
      });
    }
  }

  const m = ctx.momentum;
  if (m && typeof m.score === "number") {
    const pct = Math.round(m.score);
    out.push({
      key: "price-momentum",
      label: "Price momentum",
      score: pct,
      stance: stanceOf(pct),
      detail: [
        m.return3m != null ? `3m ${m.return3m >= 0 ? "+" : ""}${m.return3m.toFixed(1)}%` : null,
        m.vsSma200 != null ? `vs SMA200 ${m.vsSma200 >= 0 ? "+" : ""}${m.vsSma200.toFixed(1)}%` : null,
        `trend ${m.trend}`,
      ]
        .filter(Boolean)
        .join("; "),
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Conflicts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The genuine disagreements, strongest first.
 *
 * Every supportive signal is paired against every opposing one; the gap ranks
 * them. Capped at three because a verdict that names five tensions has named
 * none — prioritization is the point (§4).
 */
export function findConflicts(signals: SignalReading[]): Conflict[] {
  const pos = signals.filter((s) => s.stance === "supportive");
  const neg = signals.filter((s) => s.stance === "opposed");

  const conflicts: Conflict[] = [];
  for (const p of pos) {
    for (const n of neg) {
      const gap = p.score - n.score;
      if (gap < MIN_CONFLICT_GAP) continue;
      conflicts.push({
        positive: p,
        negative: n,
        gap,
        statement: `${p.label} is strong (${p.score}/100) while ${n.label} is weak (${n.score}/100) — a ${gap}-point disagreement`,
      });
    }
  }
  return conflicts.sort((a, b) => b.gap - a.gap).slice(0, 3);
}

/* -------------------------------------------------------------------------- */
/* Trends                                                                      */
/* -------------------------------------------------------------------------- */

/** Last value minus the earliest of the trailing window, as a direction. */
function direction(delta: number, flatBand: number): TrendReading["direction"] {
  if (delta > flatBand) return "improving";
  if (delta < -flatBand) return "deteriorating";
  return "flat";
}

function lastN(points: AnnualPoint[] | undefined, n: number): AnnualPoint[] {
  if (!points || points.length === 0) return [];
  return points.slice(-n).filter((p) => p && typeof p.value === "number" && isFinite(p.value));
}

/**
 * Multi-year direction for the lines that decide whether a cheap stock is
 * cheap for a reason. Margins in percentage POINTS, growth rates as CAGR.
 *
 * Returns only what the statements actually support — a company with two years
 * of data gets two-year trends or none, never an extrapolation.
 */
export function readTrends(statements: FinancialStatements | null): TrendReading[] {
  if (!statements) return [];
  const out: TrendReading[] = [];

  const marginSeries: Array<[string, AnnualPoint[] | undefined]> = [
    ["Operating margin", statements.operatingMargin],
    ["Gross margin", statements.grossMargin],
    ["Net margin", statements.netMargin],
  ];

  for (const [label, series] of marginSeries) {
    const pts = lastN(series, 4);
    if (pts.length < 2) continue;
    const first = pts[0].value as number;
    const last = pts[pts.length - 1].value as number;
    // Series may arrive as a fraction (0.193) or already as percent (19.3).
    const scale = Math.abs(last) <= 1 ? 100 : 1;
    const deltaPp = (last - first) * scale;
    out.push({
      label,
      direction: direction(deltaPp, 0.5),
      detail: `${(first * scale).toFixed(1)}% (FY${pts[0].fy}) → ${(last * scale).toFixed(1)}% (FY${
        pts[pts.length - 1].fy
      }), ${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(1)}pp over ${pts.length} years`,
    });
  }

  if (statements.revenueCagr != null && isFinite(statements.revenueCagr)) {
    const pct = statements.revenueCagr * (Math.abs(statements.revenueCagr) <= 1 ? 100 : 1);
    out.push({
      label: "Revenue CAGR",
      direction: direction(pct, 1),
      detail: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% compound over the reported years`,
    });
  }
  if (statements.fcfCagr != null && isFinite(statements.fcfCagr)) {
    const pct = statements.fcfCagr * (Math.abs(statements.fcfCagr) <= 1 ? 100 : 1);
    out.push({
      label: "Free cash flow CAGR",
      direction: direction(pct, 1),
      detail: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% compound over the reported years`,
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What would actually change the verdict — measurable, and specific to THIS
 * company's weak spots rather than a generic checklist.
 *
 * Derived from the opposing signals: a stock held back by Growth needs a
 * growth inflection to re-rate, and saying so with the current number attached
 * makes it checkable next quarter. This is §6's "what changes the verdict",
 * and it is computed rather than generated precisely so it cannot be vague.
 */
export function buildTriggers(ctx: CompanyContext, signals: SignalReading[]): string[] {
  const out: string[] = [];
  const s = ctx.snapshot;
  const by = (key: string) => signals.find((x) => x.key === key);

  const growth = by("growth");
  if (growth && growth.stance !== "supportive") {
    if (s?.earningsGrowth != null) {
      out.push(
        `EPS growth turning positive from ${(s.earningsGrowth * 100).toFixed(1)}% YoY — the Growth bucket (${growth.score}/100) is the binding constraint on the score`,
      );
    } else if (s?.revenueGrowth != null) {
      out.push(
        `Revenue growth accelerating from ${(s.revenueGrowth * 100).toFixed(1)}% YoY — the Growth bucket (${growth.score}/100) is the binding constraint`,
      );
    }
  }

  const quality = by("quality");
  if (quality && quality.stance !== "supportive" && s?.returnOnEquity != null) {
    out.push(
      `ROE sustained above 15% (currently ${(s.returnOnEquity * 100).toFixed(1)}%), which would lift Quality from ${quality.score}/100`,
    );
  }

  const health = by("financial-health");
  if (health && health.stance === "opposed" && s?.currentRatio != null) {
    out.push(
      `Current ratio recovering above 1.0x (currently ${s.currentRatio.toFixed(2)}x) — Financial Health is ${health.score}/100`,
    );
  }

  const valuation = by("valuation");
  if (valuation && valuation.stance === "supportive" && s?.forwardPE != null) {
    out.push(
      `Forward P/E re-rating above ${(s.forwardPE * 1.25).toFixed(1)}x would remove the valuation support currently scoring ${valuation.score}/100`,
    );
  }

  const analyst = by("analyst-consensus");
  if (analyst && ctx.analyst?.epsRevisionsDown30d != null && ctx.analyst.epsRevisionsDown30d > 0) {
    out.push(
      `Further downward EPS revisions (${ctx.analyst.epsRevisionsDown30d} in the last 30 days) would undercut the ${analyst.score}/100 analyst signal`,
    );
  }

  return out.slice(0, 4);
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

function describe(sig: SignalReading): string {
  return `${sig.label} ${sig.score}/100${sig.detail ? ` (${sig.detail})` : ""}`;
}

/** The complete deterministic brief. Pure. */
export function buildResearchBrief(ctx: CompanyContext): ResearchBrief {
  const signals = readSignals(ctx);
  const conflicts = findConflicts(signals);
  const trends = readTrends(ctx.statements);
  const triggers = buildTriggers(ctx, signals);

  const ranked = [...signals].sort((a, b) => b.score - a.score);
  const strongestPositives = ranked.filter((s) => s.stance === "supportive").slice(0, 3).map(describe);
  const strongestNegatives = ranked
    .filter((s) => s.stance === "opposed")
    .reverse()
    .slice(0, 3)
    .map(describe);

  return {
    signals,
    conflicts,
    trends,
    triggers,
    strongestPositives,
    strongestNegatives,
    coherent: conflicts.length === 0,
  };
}

/**
 * The brief as prompt lines.
 *
 * Deliberately ANALYSIS, not data: the raw metrics still reach the model via
 * buildEquityFacts (and the grounding checker still verifies every figure
 * against them). These lines tell the model what the numbers MEAN so it does
 * not spend its output rediscovering it.
 */
export function briefFactLines(brief: ResearchBrief, score: ScoreResult | null): string[] {
  const out: string[] = ["--- DETERMINISTIC ANALYSIS (computed by the platform; do not recompute) ---"];

  if (score) {
    out.push(
      `The verdict is already settled: composite ${score.composite}/100 → ${score.recommendation.replace(/_/g, " ")}. Explain WHY this is the right call.`,
    );
  }

  if (brief.conflicts.length > 0) {
    out.push("THE CENTRAL DISAGREEMENTS (strongest first — this is what the verdict must explain):");
    for (const c of brief.conflicts) out.push(`  - ${c.statement}`);
  } else if (brief.signals.length > 0) {
    out.push(
      "SIGNAL AGREEMENT: no material disagreement between signals — the evidence points one way. Say so plainly rather than manufacturing a tension.",
    );
  }

  if (brief.strongestPositives.length > 0) {
    out.push("STRONGEST SUPPORT:");
    for (const p of brief.strongestPositives) out.push(`  - ${p}`);
  }
  if (brief.strongestNegatives.length > 0) {
    out.push("STRONGEST OPPOSITION:");
    for (const n of brief.strongestNegatives) out.push(`  - ${n}`);
  }

  if (brief.trends.length > 0) {
    out.push("MULTI-YEAR TRENDS (direction matters more than level):");
    for (const t of brief.trends) out.push(`  - ${t.label}: ${t.direction} — ${t.detail}`);
  }

  if (brief.triggers.length > 0) {
    out.push("VERDICT TRIGGERS (measurable; computed from the weak buckets):");
    for (const t of brief.triggers) out.push(`  - ${t}`);
  }

  return out;
}
