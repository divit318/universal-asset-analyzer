/**
 * Contextual intelligence engine — the server-side orchestrator behind
 * /api/intel.
 *
 * Speed contract: the deterministic pass runs entirely over platform-cached
 * data (quote, news, calendar, peers, portfolio report — each with its own
 * registry policy), every sub-fetch is soft-deadlined so one slow provider
 * can't hold the set hostage, and the whole card set is itself a dataset
 * (`intelCards`, 90s) so the rail's polls and quick tab-hops are cache hits.
 *
 * The AI pass is strictly additive and never awaited by a request: it is
 * kicked off in the background after the deterministic set exists, cached for
 * 30 minutes (`intelAi`), and merged into whichever poll arrives after it
 * lands. AI down ⇒ the deterministic cards are the feature; nothing waits.
 *
 * Directional conclusions are computed in candidates.ts; the model is handed
 * settled facts and may only notice a combination worth one extra question
 * (see AGENTS.md "Never let the model derive a directional verdict").
 */

import { getDataset, peekDataset } from "../platform/data-layer";
import { runPrompt } from "../ai";
import { extractJsonArray } from "../json-extract";
import { getQuote, getQuotes } from "../yahoo";
import { getCompanyNews } from "../news";
import { getCalendarEvents } from "../calendar";
import { getPeerComparison } from "../peers";
import { getPortfolioForIOS } from "../ios/server";
import { buildThreats } from "../home/threats";
import { canonicalizeSector } from "../gics-sectors";
import { constituentsForSector } from "../sp500";
import { listWatchlist, listSuppressedIntelIds, recordIntelEvent } from "../db";
import type { NewsItem, Quote, PeerComparison } from "../types";
import { selectCards } from "./score";
import {
  compareAsymmetryCandidates,
  concentrationSuggestion,
  earningsCandidates,
  listMoverCandidates,
  newsEventCandidates,
  portfolioContextCandidates,
  portfolioThreatCandidates,
  quoteAnomalyCandidates,
  upcomingEarningsClusterCandidate,
  type IntelPortfolioFacts,
} from "./candidates";
import type { IntelCandidate, IntelContext, IntelResponse, IntelSurface } from "./types";

export type { IntelContext, IntelResponse } from "./types";

/** What the intelCards dataset stores: candidates plus the settled facts the AI pass reasons over. */
interface IntelSnapshot {
  candidates: IntelCandidate[];
  facts: string[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Soft deadline: resolve null instead of hanging or throwing. Every input to
 * the deterministic pass is optional — a missing peer comparison must cost a
 * candidate, never the card set.
 */
function soft<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.()),
  ]);
}

const SOFT_MS = 8_000;

function contextParams(ctx: IntelContext): Record<string, string> {
  return { surface: ctx.surface, symbols: ctx.symbols.join(",") };
}

/** Reduce the universal report to the plain facts the pure builders take. */
async function loadPortfolioFacts(): Promise<IntelPortfolioFacts | null> {
  const { report } = await getPortfolioForIOS();
  if (!report) return null;
  const holdings = report.holdings
    .filter((h) => h.symbol)
    .map((h) => ({
      symbol: h.symbol as string,
      name: h.name,
      weight: h.weight,
      sector: h.attributes.sector ? (canonicalizeSector(h.attributes.sector) ?? h.attributes.sector) : null,
    }))
    .sort((a, b) => b.weight - a.weight);
  const sectorWeights = report.allocation.bySector.slices
    .filter((s) => s.key !== "unclassified")
    .map((s) => ({ sector: canonicalizeSector(s.label) ?? s.label, weight: s.weight }));
  const threats = buildThreats(report).threats.map((t) => ({
    id: t.id,
    title: t.title,
    severity: t.severity,
    detail: t.detail,
    href: t.href,
  }));
  return { totalValue: report.totalValue, holdings, sectorWeights, threats };
}

const fmtPct = (x: number): string => `${Math.round(x * 10) / 10}%`;

/* -------------------------------------------------------------------------- */
/* Deterministic pass                                                          */
/* -------------------------------------------------------------------------- */

async function buildSnapshot(ctx: IntelContext): Promise<IntelSnapshot> {
  const now = Date.now();
  const { surface, symbols } = ctx;
  const candidates: IntelCandidate[] = [];
  const facts: string[] = [];

  const watchlistItems = (() => {
    try {
      return listWatchlist();
    } catch {
      return [];
    }
  })();
  const watched = new Set(watchlistItems.map((w) => w.symbol.toUpperCase()));

  const portfolioFacts = await soft(loadPortfolioFacts(), SOFT_MS);
  const heldSet = new Set(portfolioFacts?.holdings.map((h) => h.symbol.toUpperCase()) ?? []);

  if ((surface === "research" || surface === "compare") && symbols.length > 0) {
    const primary = symbols[0].toUpperCase();
    const held = heldSet.has(primary);

    const [quote, news, calendar, peers] = await Promise.all([
      soft(getQuote(primary), SOFT_MS),
      soft(getCompanyNews(primary, 10), SOFT_MS),
      soft(getCalendarEvents(), SOFT_MS),
      surface === "research" ? soft(getPeerComparison(primary), SOFT_MS) : Promise.resolve<PeerComparison | null>(null),
    ]);

    const name = quote?.name ?? primary;
    const sector = peers?.sector ? (canonicalizeSector(peers.sector) ?? peers.sector) : null;

    if (news) candidates.push(...newsEventCandidates({ symbol: primary, news, now, surface, held }));
    if (calendar) candidates.push(...earningsCandidates({ symbol: primary, name, events: calendar.events, now, held }));
    if (quote) candidates.push(...quoteAnomalyCandidates({ quote, peers, surface, held }));
    candidates.push(...portfolioContextCandidates({ symbol: primary, name, sector, facts: portfolioFacts, surface }));
    if (peers?.sector) {
      candidates.push(
        ...concentrationSuggestion({
          symbol: primary,
          name,
          sector,
          facts: portfolioFacts,
          sectorPeers: constituentsForSector(peers.sector),
        }),
      );
    }

    // Settled facts for the AI pass — computed conclusions, never model guesses.
    if (quote) {
      facts.push(`${name} (${primary}) last ${quote.price} ${quote.currency}, ${fmtPct(quote.changePercent)} today.`);
      if (quote.peRatio != null) facts.push(`${primary} trailing P/E: ${Math.round(quote.peRatio * 10) / 10}.`);
    }
    if (peers?.median.pe != null) facts.push(`${peers.sector} sector median trailing P/E: ${Math.round(peers.median.pe * 10) / 10} (${peers.peerCount} peers).`);
    const holding = portfolioFacts?.holdings.find((h) => h.symbol.toUpperCase() === primary);
    facts.push(
      holding
        ? `User holds ${primary} at ${fmtPct(holding.weight)} of portfolio value.`
        : `User does not hold ${primary}.${watched.has(primary) ? " It is on their watchlist." : ""}`,
    );
    if (sector && portfolioFacts) {
      const sw = portfolioFacts.sectorWeights.find((s) => s.sector === sector);
      if (sw) facts.push(`User's ${sector} exposure: ${fmtPct(sw.weight)} of portfolio.`);
    }
    for (const n of (news ?? []).slice(0, 3)) facts.push(`Headline (${n.source}): ${n.headline}`);

    if (surface === "compare") {
      candidates.push(...compareAsymmetryCandidates({ symbols, facts: portfolioFacts }));
      const rest = symbols.slice(1, 3).map((s) => s.toUpperCase());
      const restNews = await Promise.all(rest.map((s) => soft(getCompanyNews(s, 8), SOFT_MS)));
      rest.forEach((s, i) => {
        const items = restNews[i];
        if (items) candidates.push(...newsEventCandidates({ symbol: s, news: items, now, surface, held: heldSet.has(s) }));
      });
      facts.push(`User is comparing: ${symbols.join(" vs ")}.`);
    }
  }

  if (surface === "portfolio") {
    candidates.push(...portfolioThreatCandidates(portfolioFacts));
    const calendar = await soft(getCalendarEvents(), SOFT_MS);
    if (calendar) candidates.push(...upcomingEarningsClusterCandidate({ events: calendar.events, now, surface }));
    const top = portfolioFacts?.holdings.slice(0, 8).map((h) => h.symbol) ?? [];
    if (top.length > 0) {
      const quotes = await soft(getQuotes(top), SOFT_MS);
      if (quotes) candidates.push(...listMoverCandidates({ quotes, facts: portfolioFacts, surface, membership: "holding" }));
    }
  }

  if (surface === "watchlist") {
    const symbolsToCheck = watchlistItems.slice(0, 12).map((w) => w.symbol);
    const [quotes, calendar] = await Promise.all([
      symbolsToCheck.length > 0 ? soft(getQuotes(symbolsToCheck), SOFT_MS) : Promise.resolve<Quote[] | null>(null),
      soft(getCalendarEvents(), SOFT_MS),
    ]);
    if (quotes) candidates.push(...listMoverCandidates({ quotes, facts: portfolioFacts, surface, membership: "watchlist" }));
    if (calendar) candidates.push(...upcomingEarningsClusterCandidate({ events: calendar.events, now, surface }));
  }

  if (surface === "wire") {
    // The Wire is market-wide; what's contextual is the user's own book.
    const top = portfolioFacts?.holdings.slice(0, 6).map((h) => h.symbol) ?? [];
    if (top.length > 0) {
      const [quotes, ...news] = await Promise.all([
        soft(getQuotes(top), SOFT_MS),
        ...top.slice(0, 2).map((s) => soft(getCompanyNews(s, 8), SOFT_MS)),
      ]);
      if (quotes) candidates.push(...listMoverCandidates({ quotes, facts: portfolioFacts, surface, membership: "holding" }));
      top.slice(0, 2).forEach((s, i) => {
        const items = news[i] as NewsItem[] | null;
        if (items) candidates.push(...newsEventCandidates({ symbol: s, news: items, now, surface, held: true }));
      });
    }
  }

  return { candidates, facts };
}

/* -------------------------------------------------------------------------- */
/* AI pass — additive, background, bounded                                     */
/* -------------------------------------------------------------------------- */

interface RawAiInsight {
  title?: unknown;
  detail?: unknown;
  kind?: unknown;
  question?: unknown;
}

function sanitizeAiInsight(item: unknown, ctx: IntelContext): IntelCandidate | null {
  if (typeof item !== "object" || item === null) return null;
  const raw = item as RawAiInsight;
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 220) : "";
  if (title.length < 20) return null;
  const detail = typeof raw.detail === "string" ? raw.detail.trim().slice(0, 200) : undefined;
  const kind = raw.kind === "suggestion" ? "suggestion" : "lead";
  const question = typeof raw.question === "string" && raw.question.trim().length > 0 ? raw.question.trim().slice(0, 400) : title;
  const symbol = ctx.symbols[0];
  return {
    id: `ai:${ctx.surface}:${ctx.symbols.join("-")}:${fnv(title)}`,
    category: kind,
    eyebrow: kind === "suggestion" ? "AI Suggestion" : "AI Lead",
    title,
    detail,
    symbol,
    action: { label: "Ask AI", kind: "assistant", prompt: question },
    signals: {
      relevance: 0.9,
      materiality: 0.7,
      timeliness: 0.6,
      novelty: 0.9,
      actionability: 0.8,
      // Interpretation, not measurement — scored below every computed source.
      confidence: 0.55,
      portfolioRelevance: 0.3,
    },
    source: "ai",
  };
}

/** FNV-1a, same algorithm as lib/story-id.ts — stable card ids across runs. */
function fnv(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function buildAiPrompt(snapshot: IntelSnapshot): string {
  const shown = snapshot.candidates.map((c) => `- ${c.title}`).join("\n") || "- (none)";
  const facts = snapshot.facts.map((f) => `- ${f}`).join("\n");
  return `You are the quiet second pair of eyes on an equity research desk. Below are SETTLED FACTS about what the user is researching (all computed — treat them as true), and the observations already surfaced to the user.

SETTLED FACTS:
${facts}

ALREADY SURFACED (do not repeat or rephrase these):
${shown}

Your only job: notice whether COMBINING several settled facts yields ONE non-obvious next question worth the user's attention. Do not derive verdicts, price targets, or directional calls. Do not restate a single fact as an insight. Most of the time the correct answer is that nothing clears the bar.

Respond with a JSON array of AT MOST ONE object:
[{"title": "one-sentence observation grounded in at least two of the facts", "detail": "optional supporting sentence", "kind": "lead", "question": "the question to hand the research assistant if the user clicks"}]

If nothing genuinely combines into something new, respond with exactly: []`;
}

/** Fire-and-forget: compute (or reuse) the AI pass for this context. */
function kickOffAiPass(ctx: IntelContext, snapshot: IntelSnapshot): void {
  void getDataset<IntelCandidate[]>(
    "intelAi",
    contextParams(ctx),
    async () => {
      try {
        const raw = await runPrompt("contextual-intel", buildAiPrompt(snapshot), { json: true });
        const parsed = extractJsonArray<IntelCandidate>(raw, (item) => sanitizeAiInsight(item, ctx));
        return parsed.slice(0, 1);
      } catch {
        // Cache the miss: a provider that is down should not be retried on
        // every poll for the next 30 minutes.
        return [];
      }
    },
    { timeoutMs: 90_000, symbol: ctx.symbols[0] },
  ).catch(() => {
    /* background — never surfaces */
  });
}

/** The AI pass only pays off where there are symbol-grounded facts to combine. */
function aiEligible(ctx: IntelContext, snapshot: IntelSnapshot): boolean {
  return (
    (ctx.surface === "research" || ctx.surface === "compare") &&
    ctx.symbols.length > 0 &&
    snapshot.facts.length >= 3
  );
}

/* -------------------------------------------------------------------------- */
/* Public entry points                                                         */
/* -------------------------------------------------------------------------- */

export async function getIntelResponse(ctx: IntelContext): Promise<IntelResponse> {
  const params = contextParams(ctx);

  const { data: snapshot } = await getDataset<IntelSnapshot>(
    "intelCards",
    params,
    () => buildSnapshot(ctx),
    { timeoutMs: 25_000, symbol: ctx.symbols[0] },
  );

  let aiPending = false;
  let aiCandidates: IntelCandidate[] = [];
  if (aiEligible(ctx, snapshot)) {
    const cached = peekDataset<IntelCandidate[]>("intelAi", params);
    if (cached) {
      aiCandidates = cached.data;
    } else {
      kickOffAiPass(ctx, snapshot);
      aiPending = true;
    }
  }

  const suppressed = listSuppressedIntelIds();
  const cards = selectCards([...snapshot.candidates, ...aiCandidates], { suppressedIds: suppressed });

  return { cards, generatedAt: new Date().toISOString(), aiPending };
}

export function recordIntelFeedback(id: string, status: "shown" | "dismissed" | "opened", symbol?: string | null): void {
  recordIntelEvent(id, status, symbol);
}

export function isIntelSurface(value: string): value is IntelSurface {
  return value === "research" || value === "compare" || value === "portfolio" || value === "watchlist" || value === "wire";
}
