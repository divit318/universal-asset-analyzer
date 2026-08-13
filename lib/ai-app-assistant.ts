/**
 * App Assistant — the global "how do I…" / navigation helper reachable from
 * every page. Deliberately NOT a research surface: it knows only the current
 * page (plus whatever's loaded on it — see AppAssistantPageContext) and a
 * short static description of what UAA can do. For anything about a specific
 * stock's fundamentals/valuation, it should point the user at the Research
 * Copilot rather than attempt an answer itself.
 *
 * It can also DO things — navigate the user somewhere, optionally with
 * symbols or parsed screener filters preloaded, add symbols to the
 * watchlist, or kick off an IC report — rather than only explain where to
 * go. The model never outputs a resolved ticker itself (models guess wrong
 * tickers confidently); it names the COMPANY (expanding brand names like
 * "Google" to the official "Alphabet", which is world knowledge, not ticker
 * invention), and resolveAction() below verifies each mention through
 * lib/asset-resolution.ts, so a hallucinated or ambiguous company name is
 * surfaced honestly instead of producing a wrong instrument. Screener filter
 * descriptions go through the same schema-validated parseNlFilters() the
 * Screener NL search uses — nothing here invents a second filter parser.
 *
 * ## Intent confidence vs. resolution confidence vs. eligibility
 *
 * Two INDEPENDENT signals decide what an action is allowed to do, and they
 * must never be recombined into one field (conflating them is how "Reliance"
 * once became Reliance Steel with a high-confidence auto-fire):
 *
 *   - **Intent confidence** (model-owned, `action.confidence` in the raw
 *     JSON): how clearly the user asked for this action. Says NOTHING about
 *     which instrument they mean.
 *   - **Resolution confidence** (server-owned, lib/asset-resolution.ts): how
 *     certain we are the resolved instrument is the one the user named.
 *
 * Eligibility = combine(intent, resolution), computed in resolveAction():
 *
 *   | resolution           | resulting action                                  |
 *   |----------------------|---------------------------------------------------|
 *   | none (nothing valid) | no action at all; the answer says so honestly     |
 *   | ambiguous (any item) | confidence capped at "medium" → confirm chip that |
 *   |                      | names the instrument; NEVER auto-fires            |
 *   | strong / exact (all) | model's intent confidence stands; "high" may      |
 *   |                      | auto-fire                                         |
 *
 * A `mutation` (adding to the watchlist) is resolved here — real
 * symbol/name verified — but never *executed* here. The actual write
 * happens client-side (ai-assistant.tsx), which awaits the API response per
 * item and reports the VERIFIED result; success copy is never emitted on
 * intent alone.
 *
 * One-shot per turn, like lib/ai-chart-qa.ts — no server-side session, the
 * client resends recent turns as light history for continuity.
 */

import { runPromptWithMeta } from "./ai";
import { extractJson } from "./json-extract";
import { getQuote } from "./yahoo";
import { resolveAssetMention, type ResolvedAsset } from "./asset-resolution";
import { matchFastPath } from "./assistant-fastpath";
import {
  getPortfolioSnapshot,
  heldSymbols,
  renderPortfolioBlock,
  watchedSymbols,
  type AssistantPortfolioSnapshot,
} from "./assistant-portfolio";
import { assetClassesWith, isAssetClassId, universeLabel } from "./assets/registry";
import type { AssetClassId } from "./assets/types";
import { AI_RECOVERY_HINT } from "./ai/availability";
import { classifyAiError } from "./ai/errors";

export interface AppAssistantTurn {
  question: string;
  answer: string;
}

/** What's loaded on the current page, beyond just its route — lets "run a DCF
 * on this" or "add TSLA to this comparison" work without re-stating symbols
 * already in view. Built client-side from the URL (see ai-assistant.tsx). */
export interface AppAssistantPageContext {
  symbol?: string;
  symbols?: string[];
  tab?: string;
}

export type AppAssistantConfidence = "high" | "medium" | "low";

export interface AppAssistantAction {
  type: "navigate";
  /** The destination id (e.g. "compare") — lets the client pick a matching icon. */
  destination: string;
  href: string;
  /** e.g. "Opening Asset Comparison…" — shown while the transition plays.
   * For mutations this ALWAYS names the verified instrument(s), e.g.
   * "Add Tesla, Inc. (TSLA) to Watchlist" — the user must never click
   * something that looks like plain navigation and trigger a write. */
  label: string;
  destinationLabel: string;
  /** Action eligibility — intent confidence already combined with resolution
   * confidence (see the file header). "high" auto-navigates; "medium"/"low"
   * render as a confirm chip instead. */
  confidence: AppAssistantConfidence;
  /** Screener only: the user's natural-language filter description, handed to
   * the Screener page via sessionStorage (see app/_components/screener-handoff.ts).
   * Deliberately NOT parsed here: filter parsing is its own model call, and
   * running it inside this turn made every screener request two SEQUENTIAL
   * LLM calls (~16.6s measured). The Screener parses it on arrival, in
   * parallel with its own initial data load. */
  screenerHandoff?: { assetClass: AssetClassId; nlQuery: string };
  /** A side effect the client performs instead of just navigating — every
   * item resolved (real symbol/name, verified against what the user said)
   * but not yet executed. The client awaits each write and reports the
   * verified per-item outcome. See the file header. */
  mutation?: { kind: "watchlist_add"; items: { symbol: string; name: string }[] };
}

export interface AppAssistantResult {
  answer: string;
  suggestions?: string[];
  action?: AppAssistantAction;
  model: string;
}

/**
 * The screenable universes offered as "assetClassHint", derived from the Asset
 * Registry rather than hand-written. The previous hardcoded list here was a
 * second, independently-drifting taxonomy — it omitted indiaEquity, so
 * "screen Indian stocks" silently landed on the US equity universe.
 */
const SCREENER_UNIVERSES = assetClassesWith("screen");
const SCREENER_HINT_LIST = SCREENER_UNIVERSES.map((d) => `${d.id} (${universeLabel(d.id)})`).join(", ");
const SCREENER_HINT_SCHEMA = SCREENER_UNIVERSES.map((d) => `"${d.id}"`).join(" | ");

const APP_SUMMARY = `Universal Asset Analyzer (UAA) is a local, institutional-grade equity research platform. Modules: Home (daily brief), Research (deep single-stock research + AI copilot + charting), Screener (fundamental screening/ranking across equities, ETFs, REITs, crypto, commodities, bonds, forex), Wire (event-driven signals/scanning, news, portfolio headlines), Compare (multi-asset comparison), Portfolio (holdings, P&L, risk), Watchlist, DCF (intrinsic value), Calendar (earnings dates), IC Report (multi-agent institutional research), Engine (quant scorecard), Thematic (theme/supply-chain analysis), Decision Journal. AI narration runs on Claude via the Anthropic API, using the user's own key (Settings); every number is computed locally by deterministic engines.`;

// Kept intentionally separate from app/_components/nav-config.ts (the header
// nav + ⌘K palette's source of truth): lib/ is domain logic consumed by
// app/, and no other lib/ file reaches back into app/ the other way. This is
// just enough detail for the prompt to name the current page correctly.
const PAGE_DESCRIPTIONS: [prefix: string, description: string][] = [
  ["/research", "Research — deep single-stock research: quote, filings, news, AI copilot, charting."],
  ["/screener", "Screener — fundamental screening and ranking (value/quality/momentum)."],
  ["/wire", "Wire — live news, event-driven signals (earnings surprises, insider activity, technical breaks), and your portfolio's headlines."],
  ["/compare", "Compare — multi-asset comparison across equities, ETFs, crypto, and other asset classes."],
  ["/portfolio", "Portfolio — holdings, P&L, risk metrics, position fit."],
  ["/watchlist", "Watchlist — tracked tickers with alerts and notes."],
  ["/valuation", "Valuation — your living valuation case per company: priced-in growth, editable assumptions, versioned history."],
  ["/calendar", "Calendar — earnings and ex-dividend dates."],
  ["/ic-report", "IC Report — institutional research via a multi-agent pipeline."],
  ["/engine", "Engine — the Python quant scorecard."],
  ["/thematic", "Thematic — theme, supply-chain, and geopolitical opportunity analysis."],
  ["/journal", "Decision Journal — logged calls and track record."],
];

function describeCurrentPage(pathname: string): string {
  if (pathname === "/") return "Home — the personalized daily dashboard.";
  const match = PAGE_DESCRIPTIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"));
  return match ? match[1] : `an unrecognized page (${pathname}).`;
}

function describePageContext(ctx?: AppAssistantPageContext): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.symbol) parts.push(`Currently viewing ${ctx.symbol}.`);
  if (ctx.symbols && ctx.symbols.length > 0) parts.push(`Currently comparing ${ctx.symbols.join(", ")}.`);
  if (ctx.tab) parts.push(`Currently on the "${ctx.tab}" tab.`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

type DestinationId =
  | "research"
  | "compare"
  | "valuation"
  | "ic-report"
  | "portfolio"
  | "watchlist"
  | "screener"
  | "calendar"
  | "engine"
  | "thematic"
  | "journal"
  | "wire";

interface DestinationDef {
  label: string;
  minSymbols: number;
  maxSymbols: number;
  href: (symbols: string[]) => string;
}

/** Navigable destinations the assistant can act on. Distinct from
 * PAGE_DESCRIPTIONS above (keyed by URL prefix for "where am I") — this is
 * keyed by the semantic id the model outputs, and knows how to build a URL. */
const DESTINATIONS: Record<DestinationId, DestinationDef> = {
  research: { label: "Research", minSymbols: 1, maxSymbols: 1, href: ([s]) => `/research?symbol=${encodeURIComponent(s)}` },
  compare: { label: "Asset Comparison", minSymbols: 2, maxSymbols: 5, href: (s) => `/compare?symbols=${s.map(encodeURIComponent).join(",")}` },
  valuation: { label: "Valuation", minSymbols: 1, maxSymbols: 1, href: ([s]) => `/valuation?symbol=${encodeURIComponent(s)}` },
  // Always appended with autorun=1: unlike the other symbol-scoped
  // destinations, there's no scenario where "open the IC report for X"
  // *doesn't* mean "generate it" — the page has nothing else to show for a
  // symbol until generation runs. ic-report/page.tsx auto-triggers on this.
  "ic-report": { label: "IC Report", minSymbols: 1, maxSymbols: 1, href: ([s]) => `/ic-report?symbol=${encodeURIComponent(s)}&autorun=1` },
  portfolio: { label: "Portfolio", minSymbols: 0, maxSymbols: 0, href: () => "/portfolio" },
  watchlist: { label: "Watchlist", minSymbols: 0, maxSymbols: 0, href: () => "/watchlist" },
  screener: { label: "Screener", minSymbols: 0, maxSymbols: 0, href: () => "/screener" },
  calendar: { label: "Calendar", minSymbols: 0, maxSymbols: 0, href: () => "/calendar" },
  engine: { label: "Engine", minSymbols: 0, maxSymbols: 0, href: () => "/engine" },
  thematic: { label: "Thematic", minSymbols: 0, maxSymbols: 0, href: () => "/thematic" },
  journal: { label: "Decision Journal", minSymbols: 0, maxSymbols: 0, href: () => "/journal" },
  // Absorbed the old "Scanner" destination — /scanner was renamed to /wire
  // and there's no separate scanner route anymore. Wire auto-runs a fresh
  // scan on arrival, so "start a scan" / "take me to the scanner" both just
  // land here.
  wire: { label: "Wire", minSymbols: 0, maxSymbols: 0, href: () => "/wire" },
};

function isDestinationId(value: unknown): value is DestinationId {
  return typeof value === "string" && value in DESTINATIONS;
}

function destinationsBlock(): string {
  return Object.entries(DESTINATIONS)
    .map(([id, d]) => {
      const need = d.minSymbols === 0 ? "" : ` (needs ${d.minSymbols === d.maxSymbols ? d.minSymbols : `${d.minSymbols}-${d.maxSymbols}`} company name${d.maxSymbols > 1 ? "s" : ""}/ticker${d.maxSymbols > 1 ? "s" : ""})`;
      return `- "${id}": ${d.label}${need}`;
    })
    .join("\n");
}

function buildPrompt(
  pathname: string,
  question: string,
  history: AppAssistantTurn[],
  pageContext: AppAssistantPageContext | undefined,
  portfolioBlock: string,
): string {
  const recent = history
    .slice(-3)
    .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
    .join("\n\n");

  return `You are the in-app assistant for UAA, a local equity research platform. You help users understand what the app can do, navigate to the right tool, and can perform navigation for them instead of just describing it. You do NOT have live market data or a specific stock's financials — if the question needs those (fundamentals, valuation, news, "should I buy X"), say so plainly and point to the Research Copilot instead of guessing.

You DO have the user's portfolio and watchlist (below, read-only). Answer questions about what they own or track, position sizes, exposures, performance, diversification, and portfolio/watchlist overlap DIRECTLY from those sections — these are the app's own computed figures, so state them plainly. If a figure isn't in the section, say the Portfolio page has it; never estimate one. You cannot change the portfolio (no buying, selling, editing quantities or cost basis) — those edits happen on the Portfolio page itself.

${APP_SUMMARY}

CURRENT PAGE: ${describeCurrentPage(pathname)}${describePageContext(pageContext)}
${pageContext?.symbol || pageContext?.symbols?.length ? `If the user refers to "this stock", "these companies", or "this comparison", use the symbol(s) already stated above — don't ask them to repeat it.` : ""}

${portfolioBlock}

${recent ? `RECENT CONVERSATION:\n${recent}\n` : ""}
USER QUESTION: "${question}"

You can perform an "action" — navigating the user somewhere — instead of only explaining. Available destinations:
${destinationsBlock()}

Rules for "action":
- Include it ONLY when the user is clearly asking to go somewhere, see something, research/compare specific companies, check their portfolio/watchlist, describe what they want to screen for, add something to their watchlist, or generate a report — not for open-ended or conceptual questions.
- Naming companies (in "symbols" and "watchlistAdd"): give the OFFICIAL company name, including its corporate suffix as listed ("Apple Inc.", "Tesla, Inc.", "Microsoft Corporation"). Expand brand names and nicknames to the company they belong to ("Google" → "Alphabet Inc.", "Facebook" → "Meta Platforms, Inc."). If a name could mean several different companies (e.g. "Reliance"), keep it exactly as the user said it — the server will ask them to confirm. For currency pairs, write the pair like "USD/INR". For a market index, name the index with the word index ("S&P 500 index", "Nifty 50 index"). NEVER invent or guess a ticker — only use one the user typed themselves. Reuse a symbol from CURRENT PAGE above if the user is clearly referring to it.
- For "screener": if the user is describing what they want to find (e.g. "dividend stocks under 20 P/E", "large-cap AI companies", "something safer than NVIDIA"), include "screenerQuery" — their request rephrased as a clean filter description — and "assetClassHint", the screening universe it belongs to (one of: ${SCREENER_HINT_LIST}; default equity if unstated). Omit both if they just want the Screener opened with no specific criteria.
- For "watchlist": if the user wants to ADD one or more specific companies (e.g. "add Tesla to my watchlist", "watch NVDA", "add Apple, Microsoft and Google"), include "watchlistAdd" listing EVERY company they asked for. Omit it if they just want to open the Watchlist with no add-intent.
- For "research": when the user asked a QUESTION about the company (fundamentals, valuation, news, "is it overvalued", "should I buy") rather than just asking to open its research, also include "handoffQuestion" — their question rewritten to stand alone (e.g. "Is the current valuation justified?"). The Research Copilot there will answer it automatically on arrival, so phrase your "answer" as handing them over (e.g. "Opening Research for Apple — the copilot will pick up your valuation question there."). Omit it for plain "open/show me research" requests.
- "wire" covers both "start a scan" and news/signal requests — there's no separate scanner destination.
- "confidence": "high" only for an unambiguous request ("compare NVIDIA and AMD", "show me Tesla research", "where's my portfolio", "add Tesla to my watchlist"). Use "medium" or "low" when you're inferring the destination or the request is loosely worded. This rates how clear the user's INTENT is — the server separately verifies which instrument each name refers to.
- Omit "action" entirely for general/conceptual questions ("what does P/E mean", "how do I use this app", "explain this metric").

Instructions for "answer":
- Answer in 1-4 sentences. Be direct and concrete — name the actual page/feature (e.g. "the Screener" not "the screening tool").
- If including an action, phrase the answer as what you're ABOUT to do (e.g. "Opening Asset Comparison for NVIDIA and AMD.", "I'll add Tesla to your watchlist."). Never state that something has already been added or changed — the app confirms completed changes separately, after they actually succeed.
- Speak only in terms of what the user sees in the app. Never mention JSON fields, schemas, response formats, or any internal mechanics (e.g. never say things like "the watchlistAdd field takes one name").
- "suggestions" (optional, 0-3 items): short follow-up questions or next actions, only if genuinely useful.

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "answer": "<1-4 sentences>",
  "suggestions": ["...", "..."] (optional),
  "action": {
    "destination": "research" | "compare" | "valuation" | "ic-report" | "portfolio" | "watchlist" | "screener" | "calendar" | "engine" | "thematic" | "journal" | "wire",
    "symbols": ["..."] (only if the destination needs them),
    "screenerQuery": "..." (screener only, omit if no specific criteria),
    "assetClassHint": ${SCREENER_HINT_SCHEMA} (screener only),
    "watchlistAdd": ["..."] (watchlist only — every company to add; omit if no add-intent),
    "handoffQuestion": "..." (research only — the user's question about the company, standalone; omit for plain navigation),
    "confidence": "high" | "medium" | "low"
  } (omit entirely for a plain question)
}`;
}

function sanitizeSuggestions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out.slice(0, 3) : undefined;
}

function sanitizeConfidence(value: unknown): AppAssistantConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

/** What resolveAction() learned while verifying the model's guess — the
 * caller uses it to rewrite the answer so the text never claims more than
 * the action will actually do. */
export interface ResolvedActionOutcome {
  action?: AppAssistantAction;
  /** Add-intent mentions that resolved to no instrument at all. */
  unresolved: string[];
  /** Add-intent mentions that resolved but ambiguously — needs confirmation. */
  ambiguous: { mention: string; pick: ResolvedAsset }[];
  /** True when the user asked to add something to the watchlist. */
  wantedAdd: boolean;
}

const CONFIDENCE_ORDER: Record<AppAssistantConfidence, number> = { low: 0, medium: 1, high: 2 };

/** Eligibility: intent confidence capped by resolution confidence — an
 * ambiguous instrument must never auto-fire no matter how clear the intent.
 * See the file header before changing this. */
function combineConfidence(intent: AppAssistantConfidence, anyAmbiguous: boolean): AppAssistantConfidence {
  if (!anyAmbiguous) return intent;
  return CONFIDENCE_ORDER[intent] > CONFIDENCE_ORDER.medium ? "medium" : intent;
}

const asset = (r: { name: string; symbol: string }) => `${r.name} (${r.symbol})`;

/** Ticker-shaped, as typed: all-caps alphanumerics with . - = ^ separators. */
const TICKER_SHAPE = /^[A-Z0-9][A-Z0-9.\-=^]{0,11}$/;

/**
 * Resolve one mention, cheapest authoritative source first:
 *
 *   1. The symbol(s) already loaded on the current page — "add this stock"
 *      names an instrument the app has already verified; re-running a fuzzy
 *      search on it costs latency and (worse) can resolve somewhere else.
 *   2. A ticker typed as a ticker ("TSLA") — one platform-cached quote lookup
 *      confirms it and carries the display name, instead of a Yahoo search.
 *   3. The full scored search (lib/asset-resolution.ts) for everything else.
 *
 * Steps 1–2 fall through to 3 on any miss, so nothing gets weaker — only
 * faster when the answer is already known.
 */
async function resolveMention(mention: string, ctx?: AppAssistantPageContext): Promise<ResolvedAsset | null> {
  const m = mention.trim();
  const upper = m.toUpperCase();

  const known = [ctx?.symbol, ...(ctx?.symbols ?? [])].filter((s): s is string => Boolean(s));
  const fromPage = known.find((s) => s.toUpperCase() === upper);
  const tickerShaped = TICKER_SHAPE.test(m);
  if (fromPage || tickerShaped) {
    try {
      const q = await getQuote(fromPage ?? upper);
      if (q?.symbol && q.name) {
        return { symbol: q.symbol, name: q.name, type: q.assetType ?? null, exchange: q.exchange ?? null, resolution: "exact" };
      }
    } catch {
      /* not a live instrument under that exact symbol — use the full search */
    }
  }
  return resolveAssetMention(m);
}

/**
 * Resolves the model's raw action guess into a real, verified action.
 * Returns no action when the destination is unrecognized or the named
 * companies don't resolve trustworthily — a failed resolution falls back to
 * an honest chat answer rather than linking somewhere broken or mutating the
 * wrong instrument. Exported for tests.
 */
export async function resolveAction(raw: unknown, pageContext?: AppAssistantPageContext): Promise<ResolvedActionOutcome> {
  const none: ResolvedActionOutcome = { unresolved: [], ambiguous: [], wantedAdd: false };
  if (raw == null || typeof raw !== "object") return none;
  const { destination, symbols, confidence, screenerQuery, assetClassHint, watchlistAdd, handoffQuestion } =
    raw as Record<string, unknown>;
  if (!isDestinationId(destination)) return none;
  const def = DESTINATIONS[destination];
  const intent = sanitizeConfidence(confidence);

  let resolved: ResolvedAsset[] = [];
  if (def.minSymbols > 0) {
    const mentions = Array.isArray(symbols)
      ? symbols.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
    if (mentions.length < def.minSymbols) return none;

    const matches = await Promise.all(mentions.slice(0, def.maxSymbols).map((m) => resolveMention(m, pageContext)));
    resolved = matches.filter((m): m is ResolvedAsset => m != null);
    if (resolved.length < def.minSymbols) return none;
  }

  let screenerHandoff: AppAssistantAction["screenerHandoff"];
  if (destination === "screener" && typeof screenerQuery === "string" && screenerQuery.trim()) {
    const assetClass: AssetClassId = isAssetClassId(assetClassHint) ? assetClassHint : "equity";
    screenerHandoff = { assetClass, nlQuery: screenerQuery.trim() };
  }

  // Watchlist adds: verify every requested company independently. Accepts a
  // bare string too — smaller models sometimes flatten the array.
  const addMentions =
    destination === "watchlist"
      ? (Array.isArray(watchlistAdd) ? watchlistAdd : [watchlistAdd])
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
          .map((m) => m.trim())
          .slice(0, 10)
      : [];
  const unresolved: string[] = [];
  const ambiguous: { mention: string; pick: ResolvedAsset }[] = [];
  const items: { symbol: string; name: string }[] = [];
  if (addMentions.length > 0) {
    const picks = await Promise.all(addMentions.map((m) => resolveMention(m, pageContext)));
    picks.forEach((pick, i) => {
      if (!pick) unresolved.push(addMentions[i]);
      else {
        items.push({ symbol: pick.symbol, name: pick.name });
        if (pick.resolution === "ambiguous") ambiguous.push({ mention: addMentions[i], pick });
      }
    });
    // The user asked to ADD and nothing resolved: offering a bare "open the
    // Watchlist" action would dress the failure up as success — no action.
    if (items.length === 0) return { unresolved, ambiguous, wantedAdd: true };
  }

  const mutation: AppAssistantAction["mutation"] =
    items.length > 0 ? { kind: "watchlist_add", items } : undefined;
  const anyAmbiguous =
    ambiguous.length > 0 || resolved.some((r) => r.resolution === "ambiguous");

  // Reuses the notification system's arrival-highlight convention
  // (data-arrival-target={symbol} on each watchlist row) so a newly added
  // ticker scrolls into view and pulses; the client re-points it at the
  // first VERIFIED write before navigating.
  let href = mutation
    ? `/watchlist?highlight=${encodeURIComponent(items[0].symbol)}`
    : def.href(resolved.map((r) => r.symbol));

  // The user asked research a QUESTION, not just for the page: ride it along
  // as the ?ask= handoff the research page already consumes (see
  // app/_components/ask-ai.ts), so the copilot answers it on arrival instead
  // of the user retyping what they just asked one surface ago.
  if (destination === "research" && typeof handoffQuestion === "string" && handoffQuestion.trim()) {
    href += `&ask=${encodeURIComponent(handoffQuestion.trim().slice(0, 300))}`;
  }

  // The label is the chip the user clicks (or watches auto-fire): for
  // anything that writes, it must name the exact instrument(s) — never a
  // generic "Open Watchlist" with a hidden side effect.
  const label = mutation
    ? items.length === 1
      ? `Add ${asset(items[0])} to Watchlist${anyAmbiguous ? "?" : ""}`
      : `Add ${items.length} to Watchlist: ${items.map((i) => i.symbol).join(", ")}`
    : screenerHandoff
      ? "Opening Screener with your filters…"
      : resolved.length > 0
        ? `Opening ${def.label}: ${resolved.map((r) => r.symbol).join(", ")}`
        : `Opening ${def.label}…`;

  return {
    action: {
      type: "navigate",
      destination,
      href,
      label,
      destinationLabel: def.label,
      confidence: combineConfidence(intent, anyAmbiguous),
      screenerHandoff,
      mutation,
    },
    unresolved,
    ambiguous,
    wantedAdd: addMentions.length > 0,
  };
}

const quoteList = (mentions: string[]) => mentions.map((m) => `"${m}"`).join(", ");

/**
 * The answer the user reads must describe what the action will ACTUALLY do
 * after server-side verification — the model wrote its text assuming every
 * name it emitted would resolve to the intended instrument. Whenever
 * verification changed the picture (nothing resolved, some names dropped,
 * or a match is ambiguous), the model's text would now over- or mis-claim,
 * so it is replaced with a factual account. Pure / testable.
 */
export function reconcileAnswer(
  modelAnswer: string,
  outcome: { action?: AppAssistantAction; unresolved: string[]; ambiguous: { mention: string; pick: ResolvedAsset }[]; wantedAdd: boolean },
  actionRequested: boolean,
): string {
  const { action, unresolved, ambiguous, wantedAdd } = outcome;

  // The model wanted an action but nothing survived verification.
  if (actionRequested && !action) {
    return wantedAdd && unresolved.length > 0
      ? `I couldn't confidently identify ${quoteList(unresolved)} — nothing was added. Try the exact company name or ticker.`
      : "I couldn't confidently match that to a specific company — try naming it more precisely, or use ⌘K to search directly.";
  }

  // An ambiguous match must be presented as a question naming both readings,
  // never as something about to happen.
  if (action?.mutation && ambiguous.length > 0) {
    const a = ambiguous[0];
    const alt = a.pick.alternative;
    const others = unresolved.length > 0 ? ` I couldn't identify ${quoteList(unresolved)}.` : "";
    return `"${a.mention}" could mean more than one listing — the closest match is ${asset(a.pick)}${alt ? `, but it could also be ${asset(alt)}` : ""}. Confirm below if ${a.pick.symbol} is the one you meant.${others}`;
  }

  // Some requested adds dropped out: say exactly what will and won't happen.
  if (action?.mutation && unresolved.length > 0) {
    const adding = action.mutation.items.map(asset).join(", ");
    return `I'll add ${adding}. I couldn't identify ${quoteList(unresolved)} — try the exact company name or ticker for ${unresolved.length === 1 ? "that one" : "those"}.`;
  }

  return modelAnswer;
}

const PORTFOLIO_ACTION: AppAssistantAction = {
  type: "navigate",
  destination: "portfolio",
  href: "/portfolio",
  label: "Opening Portfolio…",
  destinationLabel: "Portfolio",
  confidence: "high",
};

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** Deterministic answers for portfolio-metric questions, straight from the
 * report snapshot — same figures as the Portfolio page, zero model calls. */
function answerPortfolioMetric(
  metric: "top-positions" | "performance" | "sector-exposure",
  snap: AssistantPortfolioSnapshot,
): string {
  switch (metric) {
    case "top-positions": {
      const top = snap.topPositions.slice(0, 5);
      return `Your largest positions: ${top.map((p) => `${p.symbol} (${p.weightPct.toFixed(1)}%)`).join(", ")}.`;
    }
    case "performance": {
      const sign = snap.totalReturnDollar >= 0 ? "+" : "-";
      return `Your portfolio is worth ${snap.baseCurrency === "USD" ? "$" : `${snap.baseCurrency} `}${Math.round(snap.totalValue).toLocaleString()} — ${pct(snap.totalReturnPct)} since inception (${sign}$${Math.abs(Math.round(snap.totalReturnDollar)).toLocaleString()}), ${pct(snap.todayChangePct)} today.`;
    }
    case "sector-exposure": {
      const top = snap.sectors[0];
      const rest = snap.sectors.slice(1, 4);
      const flags = snap.concentration.length > 0 ? ` Concentration flags: ${snap.concentration.join("; ")}.` : "";
      return `${top ? `Your largest sector exposure is ${top.label} at ${top.weightPct.toFixed(1)}%` : "No sector data available"}${rest.length ? `, then ${rest.map((s) => `${s.label} ${s.weightPct.toFixed(1)}%`).join(", ")}` : ""}.${flags}`;
    }
  }
}

/**
 * Deterministic fast path — see lib/assistant-fastpath.ts. Answers unambiguous
 * navigation, "what do I own", and warm portfolio-metric questions locally
 * (10–600ms, no model call); returns null for anything the model should
 * judge. `model: "instant"` marks the turn as non-AI in the response.
 */
async function tryFastPath(question: string): Promise<AppAssistantResult | null> {
  const match = matchFastPath(question);
  if (!match) return null;

  if (match.kind === "holdings") {
    const symbols = heldSymbols();
    const answer =
      symbols.length === 0
        ? "Your portfolio is empty — add your first position on the Portfolio page."
        : `You hold ${symbols.length} position${symbols.length === 1 ? "" : "s"}: ${symbols.slice(0, 25).join(", ")}${symbols.length > 25 ? "…" : ""}. Opening Portfolio for values and P&L.`;
    return { answer, action: PORTFOLIO_ACTION, model: "instant" };
  }

  if (match.kind === "portfolio-metric") {
    // Only answerable with live figures; a cold snapshot falls through to the
    // model, whose prompt carries the same block (or its honest absence).
    const snap = await getPortfolioSnapshot();
    if (!snap || snap.holdingCount === 0) return null;
    const followUps: Record<typeof match.metric, string[]> = {
      "top-positions": ["How diversified am I?", "How is my portfolio doing?"],
      performance: ["What are my biggest positions?", "How diversified am I?"],
      "sector-exposure": ["What are my biggest positions?", "How is my portfolio doing?"],
    };
    return {
      answer: answerPortfolioMetric(match.metric, snap),
      action: PORTFOLIO_ACTION,
      suggestions: followUps[match.metric],
      model: "instant",
    };
  }

  const def = DESTINATIONS[match.destination];
  return {
    answer: `Opening ${def.label}.`,
    action: {
      type: "navigate",
      destination: match.destination,
      href: def.href([]),
      label: `Opening ${def.label}…`,
      destinationLabel: def.label,
      confidence: "high",
    },
    model: "instant",
  };
}

export async function runAppAssistant(
  pathname: string,
  question: string,
  history: AppAssistantTurn[] = [],
  pageContext?: AppAssistantPageContext,
): Promise<AppAssistantResult> {
  const fast = await tryFastPath(question);
  if (fast) return fast;
  try {
    // Portfolio context for the model: the holdings line is ~ms (SQLite);
    // live figures ride along only when the report cache is warm (see
    // lib/assistant-portfolio.ts) — the budget keeps this from ever adding
    // meaningful latency to a turn.
    const portfolioBlock = renderPortfolioBlock(heldSymbols(), await getPortfolioSnapshot(400), watchedSymbols());
    const { text: raw, model } = await runPromptWithMeta(
      "app-assistant",
      buildPrompt(pathname, question, history, pageContext, portfolioBlock),
    );
    const parsed = extractJson<Partial<AppAssistantResult> & { action?: unknown }>(raw);

    const outcome = await resolveAction(parsed.action, pageContext);
    const actionRequested = parsed.action != null && typeof parsed.action === "object";
    const modelAnswer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const answer = reconcileAnswer(modelAnswer, outcome, actionRequested);
    if (!answer) throw new Error("empty answer");

    return { answer, suggestions: sanitizeSuggestions(parsed.suggestions), action: outcome.action, model };
  } catch (err) {
    return { answer: failureAnswer(err), model: "unavailable" };
  }
}

/**
 * Say what actually went wrong.
 *
 * Every failure here used to report one hardcoded fix regardless of the real
 * cause. Advice you can't act on is worse than no advice, because the user
 * "fixes" the wrong thing — so this names the actual failure class.
 */
export function failureAnswer(err: unknown): string {
  // classifyAiError sees through the Router's exhausted-candidates wrapper
  // (a bad key exhausting the fallback chain used to land in the generic
  // "took too long" branch here — advice you can't act on).
  const classified = classifyAiError(err);
  switch (classified.category) {
    case "no_api_key":
      return `I can't answer without an API key. ${AI_RECOVERY_HINT} Or use ⌘K to jump straight to a tool.`;
    case "bad_api_key":
      return `${classified.message} ⌘K still works for jumping straight to a tool.`;
    case "cancelled":
    case "timeout":
    case "rate_limited":
    case "network":
    case "all_models_failed":
      return "The AI took too long to answer or is unreachable — try again in a moment. ⌘K still works.";
    default: {
      // Some transports throw plain Errors merely NAMED like abort/timeout
      // (not DOMExceptions, so the classifier files them under "unknown").
      // For user-facing copy the name is signal enough.
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return "The AI took too long to answer or is unreachable — try again in a moment. ⌘K still works.";
      }
      return "I hit an error generating that answer. Try rephrasing, or use ⌘K to jump straight to a tool.";
    }
  }
}
