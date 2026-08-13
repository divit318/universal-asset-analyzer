/**
 * Contextual intelligence candidate builders — pure functions from
 * already-fetched data to scored candidates.
 *
 * Every builder here is deliberately I/O-free (same input → same output) so
 * the relevance logic is unit-testable without mocking providers; the engine
 * (lib/intel/engine.ts) owns fetching and hands in plain data. Directional
 * conclusions are computed here in code — the optional AI pass may only
 * combine settled facts, never derive its own verdicts (see AGENTS.md).
 */

import type { NewsItem, Quote, PeerComparison } from "../types";
import type { CalendarEvent } from "../calendar";
import { classifyNoise, sourceTier } from "../wire/tape";
import { storyIdFor } from "../story-id";
import { timelinessFromAge } from "./score";
import type { IntelCandidate, IntelSurface } from "./types";

/* -------------------------------------------------------------------------- */
/* Shared portfolio facts — a reduced projection of the universal report       */
/* -------------------------------------------------------------------------- */

export interface IntelHoldingFact {
  symbol: string;
  name: string;
  /** % of total portfolio value. */
  weight: number;
  sector: string | null;
}

export interface IntelThreatFact {
  id: string;
  title: string;
  severity: "high" | "medium" | "low";
  detail: string;
  href: string;
}

export interface IntelPortfolioFacts {
  totalValue: number;
  holdings: IntelHoldingFact[];
  /** GICS sector → % weight, descending. */
  sectorWeights: { sector: string; weight: number }[];
  threats: IntelThreatFact[];
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

function holdingFor(facts: IntelPortfolioFacts | null, symbol: string): IntelHoldingFact | null {
  return facts?.holdings.find((h) => h.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}

/** "Health Care", "Healthcare" and "health-care" are one sector. */
const sectorKey = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

function sectorWeightOf(facts: IntelPortfolioFacts | null, sector: string | null): number {
  if (!facts || !sector) return 0;
  return facts.sectorWeights.find((s) => sectorKey(s.sector) === sectorKey(sector))?.weight ?? 0;
}

/* -------------------------------------------------------------------------- */
/* News events                                                                 */
/* -------------------------------------------------------------------------- */

/** Headline patterns that can plausibly move a research conclusion. */
const MATERIAL_PATTERNS: { re: RegExp; materiality: number }[] = [
  { re: /\b(acquir\w+|merger|takeover|buyout|to buy|to acquire)\b/i, materiality: 0.9 },
  // Deliberately requires a reporting/estimate/guidance verb next to the noun:
  // a bare "earnings" matched valuation think-pieces ("earnings sit above fair
  // value") and turned commentary into a "Just In" card.
  { re: /\b(earnings (beat|miss|report|call|results)|(beats|misses|tops|trails) (earnings |analyst )?(estimates|expectations|forecasts)|reports (q[1-4]|quarterly|fiscal)|quarterly (results|earnings)|(raises|cuts|lowers|slashes) (guidance|outlook|forecast)|guidance (cut|raise)[ds]?|outlook (cut|raised))\b/i, materiality: 0.85 },
  { re: /\b(sec (probe|investigation)|doj|antitrust|lawsuit|fraud|subpoena|recall)\b/i, materiality: 0.85 },
  { re: /\b(ceo|cfo|chief executive)\b.*\b(resign\w*|steps? down|depart\w*|fired|appointed|named)\b/i, materiality: 0.8 },
  { re: /\b(fda (approval|rejects?|clearance)|phase (2|3|ii|iii) (data|results|trial))\b/i, materiality: 0.85 },
  { re: /\b(downgrade[ds]?|upgrade[ds]?|price target (cut|raised))\b/i, materiality: 0.6 },
  { re: /\b(dividend (cut|raised|suspended)|buyback|share repurchase|stock split)\b/i, materiality: 0.7 },
  { re: /\b(bankruptcy|default|restructur\w+|layoffs?|plant closure)\b/i, materiality: 0.85 },
  { re: /\b(contract|deal|order)\b.*\b(billion|\$\d)/i, materiality: 0.65 },
];

function headlineMateriality(headline: string): number {
  let best = 0.35; // an ordinary company story: real, but rarely thesis-moving
  for (const { re, materiality } of MATERIAL_PATTERNS) {
    if (re.test(headline) && materiality > best) best = materiality;
  }
  return best;
}

export function newsEventCandidates(opts: {
  symbol: string;
  news: NewsItem[];
  now: number;
  surface: IntelSurface;
  held: boolean;
}): IntelCandidate[] {
  const { symbol, news, now, surface, held } = opts;

  const scored = news
    // Content mills (tier 3) never break material events — anything real gets
    // wire or mainstream coverage in the same feed; commentary-only sources
    // produce exactly the "AI-generated spam" feel this rail must never have.
    .filter((n) => !classifyNoise(n).filtered && sourceTier(n.source) <= 2)
    .map((n) => {
      const ageMs = now - Date.parse(n.publishedAt);
      return { item: n, ageMs, timeliness: timelinessFromAge(ageMs, 36), materiality: headlineMateriality(n.headline) };
    })
    // Hard materiality gate, not just a scoring input: routine coverage must
    // never become a card no matter how fresh — "do not surface trivial news"
    // is a product requirement, and freshness cannot buy it back.
    .filter((s) => s.materiality >= 0.5 && Number.isFinite(s.ageMs) && s.ageMs >= 0 && s.timeliness > 0)
    .sort((a, b) => b.materiality * b.timeliness - a.materiality * a.timeliness);

  const top = scored[0];
  if (!top) return [];

  const tier = sourceTier(top.item.source);
  const fresh = top.ageMs < 6 * 3_600_000;
  return [
    {
      id: `event:${symbol}:${top.item.storyId ?? storyIdFor(top.item)}`,
      category: "event",
      eyebrow: fresh ? "Just In" : "Development",
      title: top.item.headline,
      detail: `${top.item.source} · ${symbol}`,
      symbol,
      action: { label: "Read coverage", kind: "navigate", href: top.item.url },
      signals: {
        relevance: 1,
        materiality: top.materiality,
        timeliness: top.timeliness,
        // The research page's own news panel shows recent headlines, so on
        // that surface only the genuinely material ones add anything.
        novelty: surface === "research" ? 0.45 : 0.75,
        actionability: 0.6,
        confidence: tier <= 1 ? 0.9 : tier === 2 ? 0.7 : 0.5,
        portfolioRelevance: held ? 1 : 0,
      },
      source: "computed",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Earnings proximity                                                          */
/* -------------------------------------------------------------------------- */

function daysBetween(now: number, dateStr: string): number {
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function earningsCandidates(opts: {
  symbol: string;
  name?: string | null;
  events: CalendarEvent[];
  now: number;
  held: boolean;
}): IntelCandidate[] {
  const { symbol, name, events, now, held } = opts;
  const sym = symbol.toUpperCase();

  const relevant = events
    .filter((e) => e.type === "earnings" && e.symbol?.toUpperCase() === sym)
    .map((e) => ({ event: e, days: daysBetween(now, e.date) }))
    .filter(({ days }) => days >= -2 && days <= 7)
    .sort((a, b) => Math.abs(a.days) - Math.abs(b.days));

  const top = relevant[0];
  if (!top) return [];

  const label = name ?? sym;
  const { event, days } = top;
  const reported = days <= 0;
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 0 ? `${-days}d ago` : `in ${days} days`;

  return [
    {
      id: `event:${sym}:earnings-${event.date}`,
      category: "event",
      eyebrow: reported ? "Just In" : "Coming Up",
      title: reported
        ? `${label} ${days === 0 ? "reports earnings today" : "just reported earnings"}${event.quarter ? ` (${event.quarter})` : ""}.`
        : `${label} reports earnings ${when}${event.isEstimate ? " (estimated)" : ""}.`,
      detail: event.epsEstimate != null ? `Consensus EPS ${event.epsEstimate}` : undefined,
      symbol: sym,
      action: reported
        ? { label: "Review results", kind: "assistant", prompt: `${label} (${sym}) ${days === 0 ? "reports" : "reported"} earnings ${when}. Summarize what was reported and whether it changes the research picture.` }
        : { label: "Open calendar", kind: "navigate", href: "/calendar" },
      signals: {
        relevance: 1,
        materiality: reported ? 0.85 : 0.6,
        timeliness: reported ? 1 : timelinessFromAge(0, 24) * (1 - (days - 1) / 10),
        novelty: 0.6,
        actionability: 0.7,
        confidence: event.isEstimate ? 0.6 : 0.9,
        portfolioRelevance: held ? 1 : 0,
      },
      source: "computed",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Quote / valuation anomalies                                                 */
/* -------------------------------------------------------------------------- */

export function quoteAnomalyCandidates(opts: {
  quote: Quote;
  peers: PeerComparison | null;
  surface: IntelSurface;
  held: boolean;
}): IntelCandidate[] {
  const { quote, peers, surface, held } = opts;
  const out: IntelCandidate[] = [];
  const sym = quote.symbol.toUpperCase();
  const onResearch = surface === "research";

  // Big single-day move — worth a "why" whatever the direction.
  const move = quote.changePercent;
  if (Number.isFinite(move) && Math.abs(move) >= 3.5) {
    out.push({
      id: `lead:${sym}:day-move-${new Date().toISOString().slice(0, 10)}`,
      category: "lead",
      eyebrow: "Research Lead",
      title: `${sym} is ${move > 0 ? "up" : "down"} ${round1(Math.abs(move))}% today — an outsized move worth explaining before it hardens into a thesis.`,
      symbol: sym,
      action: { label: "Ask why", kind: "assistant", prompt: `${quote.name} (${sym}) moved ${round1(move)}% today. What is known about why, and does it change anything material?` },
      signals: {
        relevance: 1,
        materiality: Math.min(1, Math.abs(move) / 8),
        timeliness: 1,
        // The quote header already shows the day change on Research.
        novelty: onResearch ? 0.4 : 0.7,
        actionability: 0.8,
        confidence: 0.95,
        portfolioRelevance: held ? 1 : 0,
      },
      source: "computed",
    });
  }

  // Valuation dislocation vs. sector peers — invisible on the page itself.
  const pe = quote.peRatio;
  const medianPe = peers?.median.pe ?? null;
  if (pe != null && pe > 0 && medianPe != null && medianPe > 0 && (peers?.peerCount ?? 0) >= 5) {
    const ratio = pe / medianPe;
    if (ratio >= 1.5 || ratio <= 0.55) {
      const rich = ratio >= 1.5;
      out.push({
        id: `lead:${sym}:pe-vs-peers-${rich ? "rich" : "cheap"}`,
        category: "lead",
        eyebrow: "Research Lead",
        title: `${sym} trades at ${round1(pe)}× trailing earnings against a ${round1(medianPe)}× ${peers!.sector} median — ${rich ? "a premium that needs justifying" : "a discount that needs explaining"}.`,
        symbol: sym,
        action: { label: "Run valuation", kind: "navigate", href: `/valuation?symbol=${encodeURIComponent(sym)}` },
        signals: {
          relevance: 1,
          materiality: Math.min(1, Math.abs(Math.log2(ratio)) * 0.9),
          timeliness: 0.5,
          novelty: 0.8,
          actionability: 0.9,
          confidence: 0.8,
          portfolioRelevance: held ? 0.8 : 0,
        },
        source: "computed",
      });
    }
  }

  // Sitting on a 52-week boundary.
  const { price, fiftyTwoWeekHigh: high, fiftyTwoWeekLow: low } = quote;
  if (high != null && price >= high * 0.99 && Math.abs(move) < 3.5) {
    out.push({
      id: `lead:${sym}:52w-high`,
      category: "lead",
      eyebrow: "Research Lead",
      title: `${sym} is trading within 1% of its 52-week high — the entry price now assumes the last year's re-rating holds.`,
      symbol: sym,
      action: { label: "Investigate", kind: "navigate", href: `/research?symbol=${encodeURIComponent(sym)}` },
      signals: {
        relevance: 1,
        materiality: 0.5,
        timeliness: 0.7,
        novelty: onResearch ? 0.3 : 0.65,
        actionability: 0.6,
        confidence: 0.95,
        portfolioRelevance: held ? 0.8 : 0,
      },
      source: "computed",
    });
  } else if (low != null && price <= low * 1.01 && Math.abs(move) < 3.5) {
    out.push({
      id: `lead:${sym}:52w-low`,
      category: "lead",
      eyebrow: "Research Lead",
      title: `${sym} is trading within 1% of its 52-week low — worth separating a broken price from a broken business.`,
      symbol: sym,
      action: { label: "Investigate", kind: "navigate", href: `/research?symbol=${encodeURIComponent(sym)}` },
      signals: {
        relevance: 1,
        materiality: 0.55,
        timeliness: 0.7,
        novelty: onResearch ? 0.3 : 0.65,
        actionability: 0.6,
        confidence: 0.95,
        portfolioRelevance: held ? 0.9 : 0,
      },
      source: "computed",
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Portfolio context                                                           */
/* -------------------------------------------------------------------------- */

export function portfolioContextCandidates(opts: {
  symbol: string;
  name?: string | null;
  sector: string | null;
  facts: IntelPortfolioFacts | null;
  surface: IntelSurface;
}): IntelCandidate[] {
  const { symbol, name, sector, facts, surface } = opts;
  if (!facts || facts.holdings.length === 0) return [];

  const sym = symbol.toUpperCase();
  const label = name ?? sym;
  const held = holdingFor(facts, sym);
  const out: IntelCandidate[] = [];

  if (held && held.weight >= 8) {
    const rank = facts.holdings.filter((h) => h.weight > held.weight).length + 1;
    out.push({
      id: `portfolio:${sym}:weight`,
      category: "portfolio",
      eyebrow: "Portfolio Insight",
      title: `${sym} is already ${round1(held.weight)}% of your portfolio${rank === 1 ? " — your largest position" : ` — your #${rank} position`}. New conclusions here move your whole book.`,
      symbol: sym,
      action: { label: "See position", kind: "navigate", href: `/portfolio?tab=holdings&highlight=${encodeURIComponent(sym)}` },
      signals: {
        relevance: 1,
        materiality: Math.min(1, held.weight / 25),
        timeliness: 0.5,
        novelty: surface === "portfolio" ? 0.2 : 0.7,
        actionability: 0.7,
        confidence: 1,
        portfolioRelevance: 1,
      },
      source: "computed",
    });
  }

  if (!held && sector) {
    const current = sectorWeightOf(facts, sector);
    if (current >= 15) {
      // A hypothetical 5%-of-portfolio starter position, the same arithmetic a
      // desk would do on a napkin: existing weights scale by 0.95, plus 5.
      const after = round1(current * 0.95 + 5);
      out.push({
        id: `portfolio:${sym}:sector-${sector.toLowerCase().replace(/\s+/g, "-")}`,
        category: "portfolio",
        eyebrow: "Portfolio Insight",
        title: `Adding ${label} would lift your ${sector} exposure from ${round1(current)}% to roughly ${after}% (at a 5% starter position).`,
        symbol: sym,
        action: {
          label: "See impact",
          kind: "assistant",
          prompt: `I'm researching ${label} (${sym}). Settled facts: I do not hold it; my ${sector} exposure is ${round1(current)}% of portfolio value; a 5% starter position would take that to about ${after}%. Given those numbers, what should I weigh before adding it?`,
        },
        signals: {
          relevance: 1,
          materiality: Math.min(1, current / 30),
          timeliness: 0.5,
          novelty: 0.85,
          actionability: 0.8,
          confidence: 0.9,
          portfolioRelevance: 1,
        },
        source: "computed",
      });
    }
  }

  return out;
}

/** Portfolio-surface card: the single worst measured threat, nothing else. */
export function portfolioThreatCandidates(facts: IntelPortfolioFacts | null): IntelCandidate[] {
  const top = facts?.threats[0];
  if (!top || top.severity === "low") return [];
  return [
    {
      id: `portfolio:threat:${top.id}`,
      category: "portfolio",
      eyebrow: "Portfolio Insight",
      title: top.detail,
      action: { label: "Review risk", kind: "navigate", href: top.href },
      signals: {
        relevance: 1,
        materiality: top.severity === "high" ? 0.9 : 0.6,
        timeliness: 0.5,
        novelty: 0.5,
        actionability: 0.8,
        confidence: 1,
        portfolioRelevance: 1,
      },
      source: "computed",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Concentration-driven suggestion — deliberately the rarest card              */
/* -------------------------------------------------------------------------- */

export function concentrationSuggestion(opts: {
  symbol: string;
  name?: string | null;
  sector: string | null;
  facts: IntelPortfolioFacts | null;
  /** Same-sector peer universe (symbol/name), pre-fetched by the engine. */
  sectorPeers: { symbol: string; name: string }[];
}): IntelCandidate[] {
  const { symbol, sector, facts, sectorPeers } = opts;
  if (!facts || !sector) return [];

  const sym = symbol.toUpperCase();
  const held = holdingFor(facts, sym);
  if (!held || held.weight < 15) return [];

  const alternative = sectorPeers.find(
    (p) => p.symbol.toUpperCase() !== sym && !holdingFor(facts, p.symbol),
  );
  if (!alternative) return [];

  return [
    {
      id: `suggestion:${sym}:diversify-${alternative.symbol}`,
      category: "suggestion",
      eyebrow: "Suggestion",
      title: `You already hold ${round1(held.weight)}% in ${sym}. ${alternative.name} (${alternative.symbol}) offers ${sector} exposure without adding to that single-name concentration.`,
      symbol: alternative.symbol,
      action: { label: `Compare ${sym} vs ${alternative.symbol}`, kind: "navigate", href: `/compare?symbols=${encodeURIComponent(`${sym},${alternative.symbol}`)}` },
      signals: {
        relevance: 1,
        materiality: Math.min(1, held.weight / 30),
        timeliness: 0.5,
        novelty: 0.8,
        actionability: 1,
        confidence: 0.8,
        portfolioRelevance: 1,
      },
      source: "computed",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Compare-surface asymmetry                                                   */
/* -------------------------------------------------------------------------- */

export function compareAsymmetryCandidates(opts: {
  symbols: string[];
  facts: IntelPortfolioFacts | null;
}): IntelCandidate[] {
  const { symbols, facts } = opts;
  if (!facts || symbols.length < 2) return [];

  const held = symbols.map((s) => ({ symbol: s.toUpperCase(), holding: holdingFor(facts, s) }));
  const owned = held.filter((h) => h.holding);
  const notOwned = held.filter((h) => !h.holding);
  if (owned.length === 0 || notOwned.length === 0) return [];

  const anchor = owned.sort((a, b) => (b.holding?.weight ?? 0) - (a.holding?.weight ?? 0))[0];
  const weight = anchor.holding!.weight;
  if (weight < 3) return [];

  const others = notOwned.map((h) => h.symbol).join(", ");
  return [
    {
      id: `portfolio:compare:${[...symbols].sort().join("-")}`,
      category: "portfolio",
      eyebrow: "Portfolio Insight",
      title: `This comparison isn't symmetric for you: you hold ${anchor.symbol} (${round1(weight)}% of portfolio) but not ${others}. Switching adds turnover; adding changes concentration.`,
      action: {
        label: "Weigh the trade-off",
        kind: "assistant",
        prompt: `I'm comparing ${symbols.join(" vs ")}. Settled facts: I hold ${anchor.symbol} at ${round1(weight)}% of my portfolio and none of the others. Frame how holding one side should change how I read this comparison.`,
      },
      signals: {
        relevance: 1,
        materiality: Math.min(1, weight / 20),
        timeliness: 0.5,
        novelty: 0.85,
        actionability: 0.7,
        confidence: 1,
        portfolioRelevance: 1,
      },
      source: "computed",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* List-surface movers (watchlist / wire)                                      */
/* -------------------------------------------------------------------------- */

export function listMoverCandidates(opts: {
  quotes: Quote[];
  facts: IntelPortfolioFacts | null;
  surface: IntelSurface;
  /** "watchlist" | "holding" — used in the card copy. */
  membership: "watchlist" | "holding";
}): IntelCandidate[] {
  const { quotes, facts, membership } = opts;

  const movers = quotes
    .filter((q) => Number.isFinite(q.changePercent) && Math.abs(q.changePercent) >= 5)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  const top = movers[0];
  if (!top) return [];

  const sym = top.symbol.toUpperCase();
  const held = holdingFor(facts, sym);
  const move = round1(top.changePercent);
  return [
    {
      id: `event:${sym}:list-move-${new Date().toISOString().slice(0, 10)}`,
      category: "event",
      eyebrow: "Just In",
      title: `${top.name} (${sym}) is ${move > 0 ? "up" : "down"} ${Math.abs(move)}% today${held ? ` — a ${round1(held.weight)}% position for you` : membership === "watchlist" ? " — a name you track" : ""}.`,
      symbol: sym,
      action: { label: "Investigate", kind: "navigate", href: `/research?symbol=${encodeURIComponent(sym)}` },
      signals: {
        relevance: 0.9,
        materiality: Math.min(1, Math.abs(move) / 10),
        timeliness: 1,
        novelty: 0.6,
        actionability: 0.8,
        confidence: 0.95,
        portfolioRelevance: held ? 1 : membership === "watchlist" ? 0.6 : 0,
      },
      source: "computed",
    },
  ];
}

/** Watchlist/portfolio names reporting earnings within the next 5 days. */
export function upcomingEarningsClusterCandidate(opts: {
  events: CalendarEvent[];
  now: number;
  surface: IntelSurface;
}): IntelCandidate[] {
  const { events, now } = opts;

  const soon = events.filter((e) => {
    if (e.type !== "earnings" || (e.source !== "watchlist" && e.source !== "portfolio")) return false;
    const d = daysBetween(now, e.date);
    return d >= 0 && d <= 5;
  });
  const symbols = [...new Set(soon.map((e) => e.symbol).filter((s): s is string => Boolean(s)))];
  if (symbols.length === 0) return [];

  const week = new Date(now).toISOString().slice(0, 10);
  return [
    {
      id: `event:earnings-cluster:${week}`,
      category: "event",
      eyebrow: "Coming Up",
      title:
        symbols.length === 1
          ? `${symbols[0]} reports earnings within the next few days.`
          : `${symbols.length} names you track report earnings soon: ${symbols.slice(0, 4).join(", ")}${symbols.length > 4 ? "…" : ""}.`,
      action: { label: "Open calendar", kind: "navigate", href: "/calendar" },
      signals: {
        relevance: 0.9,
        materiality: Math.min(1, 0.5 + symbols.length * 0.1),
        timeliness: 0.8,
        novelty: 0.6,
        actionability: 0.7,
        confidence: 0.9,
        portfolioRelevance: 1,
      },
      source: "computed",
    },
  ];
}
