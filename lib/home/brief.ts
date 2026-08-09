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

/* Merge resolution (origin/main → f22/day-change, 2026-08-06): the function
   body below was already resolved to main's analysis-seam version
   (runAnalysis + wire schema), so the imports follow it — plus this branch's
   fact-aware grounding (verifyGroundingWithFacts), which the body also uses.
   runPrompt/extractJsonObject (ours) and the plain verifyGrounding (theirs)
   had no remaining call sites. */
import { runAnalysis } from "../ai/analysis";
import { LooseObjectSchema } from "../ai/schemas/loose";
import { HomeBriefWireSchema, HOME_BRIEF_SCHEMA_VERSION } from "../ai/schemas/home-brief";
import { verifyGroundingWithFacts, type GroundedFact } from "../ai/grounding";
import { getScannerCache, putScannerCache } from "../db";
import { marketToday } from "./clock";
import { buildPortfolioPulse } from "./pulse";
import { buildThreats } from "./threats";
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
  /** Cash weight of the book, percent. Same engine slice the Book strip renders. */
  cashPct: number | null;
  /** Share of value the day move could price, percent (audit NI-06 context). */
  dayCoveragePct: number | null;
  /** Today's largest contributions, in bps, plus the reconciling residual. */
  contributors: { symbol: string; bps: number }[];
  residualBps: number | null;
  /** The threat engine's top measured vulnerability. */
  topThreat: { title: string; detail: string } | null;
}

/**
 * Projects the universal report onto the facts the brief may cite. This is
 * the model's ENTIRE knowledge of the book (audit LQ-03: the old five-number
 * pack forced the note's sections to pad, hedge, and restate); everything here
 * is read from the same pure builders the visible page renders, so the prose
 * can only ever cite what the user can verify on screen.
 */
export function toBriefPortfolio(report: UniversalPortfolioReport | null): BriefPortfolio | null {
  if (!report || report.holdingCount === 0) return null;

  const top = report.recommendations[0];
  const pulse = buildPortfolioPulse(report);
  const threats = buildThreats(report);
  return {
    healthGrade: report.health.grade,
    healthTotal: report.health.total,
    // Concentration findings are what the universal engine raises in place of
    // the legacy report's `alerts`.
    alertCount: report.concentration.length,
    todayChangePct: report.todayChangePct,
    topRecommendation: top ? `${top.action} ${top.symbol ?? top.subject} — ${top.rationale}` : null,
    cashPct: pulse.cashPct,
    dayCoveragePct: pulse.dayCoveragePct,
    contributors: pulse.topContributors.map((c) => ({ symbol: c.symbol, bps: Math.round(c.bps * 10) / 10 })),
    residualBps: pulse.topContributorsResidualBps != null ? Math.round(pulse.topContributorsResidualBps * 10) / 10 : null,
    topThreat: threats.threats[0] ? { title: threats.threats[0].title, detail: threats.threats[0].detail } : null,
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
    // The richer fact pack (Wave 4) makes the deterministic floor genuinely
    // informative: the day's driver and the top measured risk, engine-sourced.
    if (portfolio.contributors.length > 0) {
      const top = portfolio.contributors[0];
      parts.push(`Today's largest driver: ${top.symbol} (${top.bps >= 0 ? "+" : ""}${top.bps.toFixed(1)} bps).`);
    }
    if (portfolio.topThreat) {
      parts.push(`Top measured risk: ${portfolio.topThreat.title}.`);
    }
  }
  if (unreadCount > 0) {
    parts.push(`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`);
  }
  return parts.join(" ") || "No market or portfolio data available yet.";
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

/** Exported so the parity harness runs the exact production prompt. */
export function buildHomeBriefPrompt(ctx: MissionControlContext, portfolio: BriefPortfolio | null, unreadCount: number): string {
  const regime = ctx.regime
    ? `${ctx.regime.trend}${ctx.regime.breadthPct != null ? ` — ${ctx.regime.breadthPct}% of sectors advancing` : ""}. ${ctx.regime.summary} Dominant sectors: ${ctx.regime.dominantSectors.join(", ") || "none identified"}.`
    : "Market regime unavailable.";

  // Explicitly timeframed. The regime line above names today's dominant sectors;
  // these are multi-week relative-strength leaders. They routinely disagree, and
  // an unlabelled model will "reconcile" that by inventing a narrative.
  const rotation = ctx.rotation
    ? `Over the last several weeks — leaders: ${ctx.rotation.leaders.join(", ") || "none"}. Laggards: ${ctx.rotation.laggards.join(", ") || "none"}. (These are multi-week trends and may differ from today's movers above; that difference is normal and is not itself a signal.)`
    : "No sector rotation snapshot.";

  // Honest data-age line (audit LQ-04: a three-day-old snapshot produced a
  // prompt byte-identical to a live one, so the prose could never admit it).
  const freshness = ctx.scannerFreshness
    ? `Scanner snapshot: ${ctx.scannerFreshness.level} (${ctx.scannerFreshness.label}). If stale, say the market read may be out of date.`
    : "No scanner snapshot available.";

  const portfolioDesc = portfolio
    ? [
        `Health grade ${portfolio.healthGrade} (${portfolio.healthTotal}/100).`,
        // One decimal, same as every chip and stat on the page — the brief once
        // said "+0.81%" beside a chip reading "+0.8%" (audit F-22 formatting).
        `Today ${portfolio.todayChangePct >= 0 ? "+" : ""}${portfolio.todayChangePct.toFixed(1)}%${portfolio.dayCoveragePct != null && portfolio.dayCoveragePct < 95 ? ` (prices ${Math.round(portfolio.dayCoveragePct)}% of the book; the rest is cash or manually valued)` : ""}.`,
        portfolio.cashPct != null ? `Cash ${portfolio.cashPct.toFixed(1)}% of the book.` : "",
        portfolio.contributors.length > 0
          ? `Today's largest contributions: ${portfolio.contributors.map((c) => `${c.symbol} ${c.bps >= 0 ? "+" : ""}${c.bps.toFixed(1)} bps`).join(", ")}${portfolio.residualBps != null ? `, everything else ${portfolio.residualBps >= 0 ? "+" : ""}${portfolio.residualBps.toFixed(1)} bps` : ""}.`
          : "No live day moves to attribute.",
        `${portfolio.alertCount} concentration finding(s).`,
        portfolio.topThreat ? `Top measured risk: ${portfolio.topThreat.title}. ${portfolio.topThreat.detail}` : "No measured portfolio vulnerability stands out.",
        portfolio.topRecommendation
          ? `Top engine recommendation (simulated, not forecast): ${portfolio.topRecommendation}`
          : "The decision engine found no trade worth making.",
      ]
        .filter(Boolean)
        .join(" ")
    : "No portfolio is tracked.";

  return `You are a portfolio manager writing the 30-second morning read for one client. The client can already see every number below on their dashboard; your job is interpretation, not recitation.

Rules:
- Use ONLY the facts below. Never invent tickers, prices, percentages, or events. If a fact is not given, do not assert it.
- Do not restate a fact without connecting it to at least one other fact or to a consequence for this portfolio.
- If the facts describe a quiet day, say it is a quiet day in one sentence. Do not perform urgency.
- If the portfolio is mostly cash or a single asset, deployment is the only portfolio observation worth making. Do not manufacture diversification commentary.
- Sentence one of the headline is the single most decision-relevant read for THIS book today.

MARKET REGIME: ${regime}
SECTOR ROTATION: ${rotation}
DATA AGE: ${freshness}
PORTFOLIO: ${portfolioDesc}
UNREAD NOTIFICATIONS (inbox items, not alerts): ${unreadCount}

Return ONLY valid JSON in exactly this shape:
{
  "headline": "1-3 sentences. Sentence one: the most decision-relevant read of the day for this book. Then, only if the facts support it: what it means and what to watch.",
  "note": {
    "regime": "1-2 sentences: what kind of market this is and what that implies for this book.",
    "opportunities": "1-2 sentences, grounded in the rotation leaders, the engine recommendation, or the cash position. If none of those support an opportunity, say so.",
    "risks": "1-2 sentences on the top measured risk above and what would make it bite.",
    "portfolio": "1-3 sentences interpreting the day attribution and health facts. No restating without interpreting.",
    "sectors": "1-2 sentences on the sector picture, distinguishing today's breadth from the multi-week rotation.",
    "recommendations": ["3 to 5 short, specific actions, each traceable to a fact above"]
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
  // The dashboard's one clock (lib/home/clock.ts): the US market-session day,
  // not the server's local date — the two disagree every evening and the
  // grounding facts must describe the same "today" as the digest (audit NI-10).
  const today = marketToday(new Date(now));

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
    // The Wave-4 fact-pack additions (audit LQ-07): every number the richer
    // prompt now carries must also be checkable evidence, or the verifier
    // would flag the model for citing what we gave it.
    if (portfolio.cashPct != null) {
      facts.push({ value: portfolio.cashPct, kind: "percent", metric: "cash weight" });
    }
    if (portfolio.dayCoveragePct != null) {
      facts.push({ value: portfolio.dayCoveragePct, kind: "percent", metric: "day price coverage" });
    }
    for (const c of portfolio.contributors) {
      facts.push({ value: c.bps, kind: "plain", entity: c.symbol, metric: "day contribution bps", period: "day", sessionDate: today });
    }
    if (portfolio.residualBps != null) {
      facts.push({ value: portfolio.residualBps, kind: "plain", metric: "residual day contribution bps", period: "day", sessionDate: today });
    }
  }
  return facts;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * The loose bag the seam's passthrough parse view delivers, spread over these
 * defaults so a field the model dropped reads as absent rather than becoming
 * an `undefined` that TypeScript swears is a string (that exact pattern has
 * already crashed the portfolio brief once). On Devin the wire schema makes
 * omission impossible; on the local path the defaults are the contract.
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
    // No longer requested (audit LQ-03: zero macro facts exist to ground it,
    // so the section was structurally forced to invent). Kept in the contract
    // for old cache entries; new generations leave it empty.
    macro: str(n.macro),
    recommendations: Array.isArray(n.recommendations)
      ? n.recommendations.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 5)
      : [],
  };
}

/** Every sentence the note carries, for whole-output grounding (audit LQ-02). */
function noteText(note: HomeBrief["note"]): string {
  if (!note) return "";
  return [note.regime, note.opportunities, note.risks, note.portfolio, note.sectors, note.macro, ...note.recommendations]
    .filter(Boolean)
    .join(" ");
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
    // Audit LQ-05: the old key missed real state changes the note narrates.
    // The day P&L's SIGN flipping, the cash weight moving a band, or the top
    // threat changing all make the cached prose wrong even inside one hour.
    portfolio ? `day${portfolio.todayChangePct >= 0 ? "+" : "-"}` : "",
    portfolio?.cashPct != null ? `cash${Math.round(portfolio.cashPct / 5) * 5}` : "",
    portfolio?.topThreat?.title ?? "no-threat",
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
  const prompt = buildHomeBriefPrompt(ctx, portfolio, unreadCount);
  const cached = getScannerCache(key);
  if (cached) {
    try {
      const parsedCache = JSON.parse(cached) as HomeBrief;
      // Serve-time re-verification (audit F-22 amendment 1): the cached prose
      // must still ground against the CURRENT facts, not the facts it was
      // written from. A figure that has drifted since generation (the
      // "up 0.77%" vs live 0.79% case) fails here and forces a regeneration.
      // The WHOLE cached output is checked, not just the headline (audit
      // LQ-02: the note used to ship unverified). The stamp stays the
      // ORIGINAL generation time — re-stamping a cached brief as fresh was
      // its own small lie.
      const stillGrounded =
        verifyGroundingWithFacts(`${parsedCache.headline} ${noteText(parsedCache.note)}`, buildBriefFacts(ctx, portfolio), { extraEvidence: prompt }).level !== "low";
      if (stillGrounded) return parsedCache;
    } catch {
      // Corrupt cache entry — fall through and regenerate.
    }
  }

  /* Merge resolution: `prompt` is already built above (and used by the cache
     re-verification); only the parse target from main's version survives. */
  let parsed: RawBrief;
  try {
    // Through the analysis seam. The parse view stays the loose passthrough
    // and coercion happens below (str()/readNote/grounding gate); providers
    // that support structured output get the wire schema enforced
    // server-side. An unparseable response used to yield RAW_DEFAULTS ->
    // empty headline -> fallback; it now throws -> the same fallback.
    // (Merge resolution: main's `ollamaJsonMode: false` flag no longer exists
    // on AnalysisRequest after this branch's provider-agnostic seam; the
    // default JSON output mode is the closest surviving behaviour.)
    const analysis = await runAnalysis({
      taskType: "daily-briefing",
      subjectKey: "home:brief",
      prompt,
      schema: LooseObjectSchema,
      wireSchema: HomeBriefWireSchema,
      schemaVersion: HOME_BRIEF_SCHEMA_VERSION,
    });
    parsed = { ...RAW_DEFAULTS, ...(analysis.data as Record<string, unknown>) };
  } catch {
    return fallback;
  }

  const headline = str(parsed.headline);
  if (!headline) return fallback;

  // The grounding verifier checks the model's claims against the TAGGED facts
  // we gave it — transcription plus entity/direction/metric/period context
  // (audit F-22f). A low score means it invented or misused something — in
  // which case we throw the whole generation away rather than show a
  // plausible-sounding fabrication.
  const facts = buildBriefFacts(ctx, portfolio);
  const grounding = verifyGroundingWithFacts(headline, facts, { extraEvidence: prompt });
  if (grounding.level === "low") return fallback;

  // The note is verified SEPARATELY (audit LQ-02: it used to ship with no
  // check at all). A weak note costs only the note; the verified headline
  // survives, which is the graceful half of "never show a fabrication".
  let note = readNote(parsed.note);
  if (note) {
    const noteGrounding = verifyGroundingWithFacts(noteText(note), facts, { extraEvidence: prompt });
    if (noteGrounding.level === "low") note = null;
  }

  const brief: HomeBrief = {
    headline,
    note,
    // No longer model-generated (audit LQ-06: it was generated, streamed, and
    // rendered by no module — a pure token spend). The deterministic line is
    // the contract's floor and its ceiling until a surface actually needs it.
    portfolioSummary: fallback.portfolioSummary,
    aiGenerated: true,
    generatedAt: new Date().toISOString(),
  };

  putScannerCache(key, JSON.stringify(brief));
  return brief;
}
