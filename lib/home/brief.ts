/**
 * Modules 1, 2, 4 — the AI narrative, from ONE model call.
 *
 * The brief asked for three auto-generated narratives on the homepage: a short
 * "Today's Brief", a long "AI Investment Brief", and a paragraph for Portfolio
 * Pulse. Implemented literally, that is three `runPrompt()` calls on page load.
 *
 * Three separate calls are three separate spends (and on the old local
 * backend they also serialized, so the homepage took three round-trips to settle).
 * This codebase has already measured that cost once and rejected per-section AI
 * generation for exactly this reason (see the platform layer's notes). So:
 *
 *   one call → one structured object → three modules.
 *
 * The model is asked for JSON with named sections. Sections are pushed to the
 * client as they become available, so Today's Brief can paint while the long
 * note is still being written.
 *
 * **This never fails.** AI unavailable, model returns garbage, JSON won't parse,
 * grounding check fails — every path lands on `deterministicBriefing()`, which
 * is assembled from the same engine outputs and is always true. AI narrates
 * here; it never decides. That is the same "engines decide, AI narrates, never
 * fails" split lib/mission-control.ts and lib/market-summary.ts already use.
 */

import { runPrompt } from "../ai";
import { verifyGroundingWithFacts, type GroundedFact } from "../ai/grounding";
import { extractJsonObject } from "../json-extract";
import { getScannerCache, putScannerCache } from "../db";
import type { MissionControlContext } from "../mission-control";
import type { UniversalPortfolioReport } from "../portfolio/report";
import type { HomeBrief } from "./contracts";

/**
 * The portfolio facts the narrative is allowed to state.
 *
 * Deliberately NOT read from `MissionControlContext.report`, which is the
 * *legacy* PortfolioReport. Portfolio Pulse renders the *universal* report, and
 * the two engines score health differently — so sourcing the prose from one and
 * the numbers from the other put "Health B · 72/100" in a badge directly above
 * an AI sentence reading "Health grade C (67/100)". Same page, same portfolio,
 * two answers.
 *
 * Both now come from the universal report. If the number in the prose ever
 * disagrees with the number in the badge again, it is a bug in one engine, not
 * an artifact of the homepage reading two.
 */
export interface BriefPortfolio {
  healthGrade: string;
  healthTotal: number;
  alertCount: number;
  todayChangePct: number;
  topRecommendation: string | null;
}

/** Projects the universal report onto the facts the brief may cite. */
export function toBriefPortfolio(report: UniversalPortfolioReport | null): BriefPortfolio | null {
  if (!report || report.holdingCount === 0) return null;

  const top = report.recommendations[0];
  return {
    healthGrade: report.health.grade,
    healthTotal: report.health.total,
    // Concentration findings are what the universal engine raises in place of
    // the legacy report's `alerts`.
    alertCount: report.concentration.length,
    todayChangePct: report.todayChangePct,
    topRecommendation: top ? `${top.action} ${top.symbol ?? top.subject} — ${top.rationale}` : null,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback — the floor, and the default                 */
/* ------------------------------------------------------------------ */

/**
 * The always-true briefing, assembled from engine output with no model
 * involved. Ships inside the digest (so the page has real text at first paint)
 * and is the fallback for every AI failure path.
 */
export function deterministicBriefing(
  ctx: MissionControlContext,
  portfolio: BriefPortfolio | null,
  unreadCount: number,
): string {
  const parts: string[] = [];
  if (ctx.regime) parts.push(ctx.regime.summary);

  // `regime.summary` already ends with today's dominant sectors ("Leading:
  // Energy, Technology."). The rotation engine's leaders are a *different*
  // measurement — multi-week relative strength, not today's price action — and
  // the two legitimately disagree. Labelling this line "Leading sectors:" (as
  // the old briefing did) put two contradictory-looking leader lists in
  // consecutive sentences. Name the timeframe so they read as what they are.
  if (ctx.rotation && ctx.rotation.leaders.length > 0) {
    parts.push(`Multi-week leadership: ${ctx.rotation.leaders.join(", ")}.`);
  }
  if (portfolio) {
    parts.push(`Portfolio health grade ${portfolio.healthGrade} (${portfolio.healthTotal}/100), ${portfolio.alertCount} concentration finding(s).`);
  }
  if (unreadCount > 0) {
    parts.push(`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`);
  }
  return parts.join(" ") || "No market or portfolio data available yet.";
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

function buildPrompt(ctx: MissionControlContext, portfolio: BriefPortfolio | null, unreadCount: number): string {
  const regime = ctx.regime
    ? `${ctx.regime.trend}${ctx.regime.breadthPct != null ? ` — ${ctx.regime.breadthPct}% of sectors advancing` : ""}. ${ctx.regime.summary} Dominant sectors: ${ctx.regime.dominantSectors.join(", ") || "none identified"}.`
    : "Market regime unavailable.";

  // Explicitly timeframed. The regime line above names today's dominant sectors;
  // these are multi-week relative-strength leaders. They routinely disagree, and
  // an unlabelled model will "reconcile" that by inventing a narrative.
  const rotation = ctx.rotation
    ? `Over the last several weeks — leaders: ${ctx.rotation.leaders.join(", ") || "none"}. Laggards: ${ctx.rotation.laggards.join(", ") || "none"}. (These are multi-week trends and may differ from today's movers above; that difference is normal and is not itself a signal.)`
    : "No sector rotation snapshot.";

  const portfolioDesc = portfolio
    ? [
        `Health grade ${portfolio.healthGrade} (${portfolio.healthTotal}/100).`,
        // One decimal, same as every chip and stat on the page — the brief once
        // said "+0.81%" beside a chip reading "+0.8%" (audit F-22 formatting).
        `Today ${portfolio.todayChangePct >= 0 ? "+" : ""}${portfolio.todayChangePct.toFixed(1)}%.`,
        `${portfolio.alertCount} concentration finding(s).`,
        portfolio.topRecommendation
          ? `Top recommendation: ${portfolio.topRecommendation}`
          : "The decision engine found no trade worth making.",
      ].join(" ")
    : "No portfolio is tracked.";

  return `You are a portfolio manager writing the morning note for one client.

Use ONLY the facts below. Do not invent tickers, prices, percentages, or events. If a fact is not given, do not assert it.

MARKET REGIME: ${regime}
SECTOR ROTATION: ${rotation}
PORTFOLIO: ${portfolioDesc}
UNREAD ALERTS: ${unreadCount}

Return ONLY valid JSON in exactly this shape:
{
  "headline": "2-4 sentences. What's happening, how it touches this portfolio, and the single most important thing to watch today.",
  "portfolioSummary": "1-2 sentences on the portfolio's current state. If no portfolio is tracked, say so plainly.",
  "note": {
    "regime": "1-2 sentences on the market regime and what it implies.",
    "opportunities": "1-2 sentences on where the biggest opportunity is.",
    "risks": "1-2 sentences on the biggest risk.",
    "portfolio": "2-3 sentences of portfolio observations.",
    "sectors": "1-2 sentences on which sectors to watch and why.",
    "macro": "1-2 sentences on macro developments.",
    "recommendations": ["3 to 5 short, specific, actionable recommendations"]
  }
}

No preamble. No markdown fences. JSON only.`;
}

/**
 * The brief's facts as TAGGED evidence (audit F-22f) — lets verification check
 * not just that a number was transcribed but that it is used as the right
 * quantity for the right period, including the as-of check on "today" claims.
 * Exported for tests.
 */
export function buildBriefFacts(
  ctx: MissionControlContext,
  portfolio: BriefPortfolio | null,
  now: number = Date.now(),
): GroundedFact[] {
  const d = new Date(now);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const today = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

  const facts: GroundedFact[] = [];
  if (ctx.regime?.breadthPct != null) {
    facts.push({ value: ctx.regime.breadthPct, kind: "percent", metric: "breadth", period: "day", sessionDate: today });
  }
  if (portfolio) {
    facts.push(
      { value: portfolio.todayChangePct, kind: "percent", metric: "portfolio day change", period: "day", sessionDate: today },
      { value: portfolio.healthTotal, kind: "plain", metric: "health grade" },
      { value: portfolio.alertCount, kind: "plain", metric: "concentration findings" },
    );
  }
  return facts;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parsed with `extractJsonObject`, not `extractJson`. `extractJson` guarantees
 * *parseable* JSON, not *complete* JSON — it throws on garbage and casts
 * whatever it does parse straight to `T`, so a field the model dropped becomes
 * an `undefined` that TypeScript swears is a string. That exact pattern has
 * already crashed the portfolio brief once. Defaults below are the schema
 * contract; anything the model omits reads as absent rather than exploding.
 */
interface RawBrief extends Record<string, unknown> {
  headline: unknown;
  portfolioSummary: unknown;
  note: unknown;
}

const RAW_DEFAULTS: RawBrief = { headline: "", portfolioSummary: "", note: null };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Narrow the model's `note` blob, which may be absent, null, or the wrong shape. */
function readNote(v: unknown): HomeBrief["note"] {
  if (!v || typeof v !== "object") return null;
  const n = v as Record<string, unknown>;
  if (!str(n.regime)) return null;

  return {
    regime: str(n.regime),
    opportunities: str(n.opportunities),
    risks: str(n.risks),
    portfolio: str(n.portfolio),
    sectors: str(n.sectors),
    macro: str(n.macro),
    recommendations: Array.isArray(n.recommendations)
      ? n.recommendations.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 5)
      : [],
  };
}

/**
 * Cache key: the hour, plus the facts that would change what the note *says*.
 * Regenerating the same note because the clock ticked is a wasted model call;
 * regenerating it because the portfolio's health grade moved is the point.
 */
function cacheKey(ctx: MissionControlContext, portfolio: BriefPortfolio | null): string {
  return [
    "home-brief",
    new Date().toISOString().slice(0, 13),
    portfolio ? `${portfolio.healthGrade}-${portfolio.healthTotal}-${portfolio.alertCount}` : "no-portfolio",
    ctx.rotation?.asOf ?? "no-rotation",
    ctx.regime?.trend ?? "no-regime",
  ].join(":");
}

/**
 * Generates the brief. Returns the deterministic fallback (with
 * `aiGenerated: false`) on every failure path rather than throwing — the
 * homepage always has a brief.
 */
export async function generateHomeBrief(
  ctx: MissionControlContext,
  portfolio: BriefPortfolio | null,
  unreadCount: number,
): Promise<HomeBrief> {
  const fallbackText = deterministicBriefing(ctx, portfolio, unreadCount);
  const fallback: HomeBrief = {
    headline: fallbackText,
    note: null,
    portfolioSummary: portfolio
      ? `Health grade ${portfolio.healthGrade} (${portfolio.healthTotal}/100) with ${portfolio.alertCount} concentration finding(s).`
      : "No portfolio tracked yet.",
    aiGenerated: false,
    generatedAt: new Date().toISOString(),
  };

  // Nothing to narrate.
  if (!ctx.regime && !portfolio) return fallback;

  const key = cacheKey(ctx, portfolio);
  const prompt = buildPrompt(ctx, portfolio, unreadCount);
  const cached = getScannerCache(key);
  if (cached) {
    try {
      const parsedCache = JSON.parse(cached) as HomeBrief;
      // Serve-time re-verification (audit F-22 amendment 1): the cached prose
      // must still ground against the CURRENT facts, not the facts it was
      // written from. A figure that has drifted since generation (the
      // "up 0.77%" vs live 0.79% case) fails here and forces a regeneration.
      // The stamp stays the ORIGINAL generation time — re-stamping a cached
      // brief as fresh was its own small lie.
      const stillGrounded =
        verifyGroundingWithFacts(parsedCache.headline, buildBriefFacts(ctx, portfolio), { extraEvidence: prompt }).level !== "low";
      if (stillGrounded) return parsedCache;
    } catch {
      // Corrupt cache entry — fall through and regenerate.
    }
  }

  let raw: string;
  try {
    raw = await runPrompt("daily-briefing", prompt, { maxTokens: 1600 });
  } catch {
    return fallback;
  }

  const parsed = extractJsonObject<RawBrief>(raw, RAW_DEFAULTS);

  const headline = str(parsed.headline);
  if (!headline) return fallback;

  // The grounding verifier checks the model's claims against the TAGGED facts
  // we gave it — transcription plus entity/direction/metric/period context
  // (audit F-22f). A low score means it invented or misused something — in
  // which case we throw the whole generation away rather than show a
  // plausible-sounding fabrication.
  const grounding = verifyGroundingWithFacts(headline, buildBriefFacts(ctx, portfolio), { extraEvidence: prompt });
  if (grounding.level === "low") return fallback;

  const brief: HomeBrief = {
    headline,
    note: readNote(parsed.note),
    portfolioSummary: str(parsed.portfolioSummary) || fallback.portfolioSummary,
    aiGenerated: true,
    generatedAt: new Date().toISOString(),
  };

  putScannerCache(key, JSON.stringify(brief));
  return brief;
}
