/**
 * App Assistant — the global "how do I…" / navigation helper reachable from
 * every page. Deliberately NOT a research surface: it knows only the current
 * page (plus whatever's loaded on it — see AppAssistantPageContext) and a
 * short static description of what UAA can do. For anything about a specific
 * stock's fundamentals/valuation, it should point the user at the Research
 * Copilot rather than attempt an answer itself.
 *
 * It can also DO things — navigate the user somewhere, optionally with
 * symbols or parsed screener filters preloaded, add a symbol to the
 * watchlist, or kick off an IC report — rather than only explain where to
 * go. The model never outputs a resolved ticker itself (small local models
 * guess wrong tickers confidently); it names companies/tickers as the user
 * said them, and resolveAction() below resolves each mention through the
 * same searchSymbols() the ⌘K palette and search box use, so a hallucinated
 * company name simply fails to resolve rather than producing a broken
 * destination. Screener filter descriptions go through the same
 * schema-validated parseNlFilters() the (until now unwired) Screener NL
 * search already used — nothing here invents a second filter parser.
 *
 * A `mutation` (e.g. adding to the watchlist) is resolved here — real
 * symbol/name looked up — but never *executed* here. The actual write
 * happens client-side, at the exact moment the action would otherwise just
 * navigate (the auto-fire beat for "high" confidence, or a confirm-chip
 * click for "medium"/"low") — so a guessed action never touches the
 * database before the user has actually seen and confirmed it.
 *
 * One-shot per turn, like lib/ai-chart-qa.ts — no server-side session, the
 * client resends recent turns as light history for continuity.
 */

import { runPromptWithMeta } from "./ai";
import { extractJson } from "./json-extract";
import { searchSymbols } from "./yahoo";
import { isAssetClassId } from "./assets/registry";
import type { AssetClassId, FilterValues } from "./assets/types";
import { parseNlFilters } from "./screener/nl-filters";

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
  /** e.g. "Opening Asset Comparison…" — shown while the transition plays. */
  label: string;
  destinationLabel: string;
  /** "high" auto-navigates; "medium"/"low" render as a confirm chip instead. */
  confidence: AppAssistantConfidence;
  /** Screener only: filters parsed from a natural-language description, handed
   * to the Screener page via sessionStorage (see app/_components/screener-handoff.ts)
   * rather than the URL — a filter object is richer than a clean query string. */
  screenerHandoff?: { assetClass: AssetClassId; filters: FilterValues; templateId: string | null };
  /** A side effect the client performs at the same moment it navigates —
   * resolved (real symbol/name) but not yet executed. See the file header. */
  mutation?: { kind: "watchlist_add"; symbol: string; name: string };
}

export interface AppAssistantResult {
  answer: string;
  suggestions?: string[];
  action?: AppAssistantAction;
  model: string;
}

const APP_SUMMARY = `Universal Asset Analyzer (UAA) is a local, institutional-grade equity research platform. Modules: Home (daily brief), Research (deep single-stock research + AI copilot + charting), Screener (fundamental screening/ranking across equities, ETFs, REITs, crypto, commodities, bonds, forex), Wire (event-driven signals/scanning, news, portfolio headlines), Compare (multi-asset comparison), Portfolio (holdings, P&L, risk), Watchlist, DCF (intrinsic value), Calendar (earnings dates), IC Report (multi-agent institutional research), Engine (quant scorecard), Thematic (theme/supply-chain analysis), Decision Journal. All AI runs on a local Ollama model — no cloud, no accounts, no subscriptions.`;

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
  ["/dcf", "DCF — intrinsic value calculator with sensitivity analysis."],
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
  | "dcf"
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
  dcf: { label: "DCF Valuation", minSymbols: 1, maxSymbols: 1, href: ([s]) => `/dcf?symbol=${encodeURIComponent(s)}` },
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
  pageContext?: AppAssistantPageContext,
): string {
  const recent = history
    .slice(-3)
    .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
    .join("\n\n");

  return `You are the in-app assistant for UAA, a local equity research platform. You help users understand what the app can do, navigate to the right tool, and can perform navigation for them instead of just describing it. You do NOT have live market data, a specific stock's financials, or portfolio holdings — if the question needs that (fundamentals, valuation, news, "should I buy X"), say so plainly and point to the Research Copilot instead of guessing.

${APP_SUMMARY}

CURRENT PAGE: ${describeCurrentPage(pathname)}${describePageContext(pageContext)}
${pageContext?.symbol || pageContext?.symbols?.length ? `If the user refers to "this stock", "these companies", or "this comparison", use the symbol(s) already stated above — don't ask them to repeat it.` : ""}

${recent ? `RECENT CONVERSATION:\n${recent}\n` : ""}
USER QUESTION: "${question}"

You can perform an "action" — navigating the user somewhere — instead of only explaining. Available destinations:
${destinationsBlock()}

Rules for "action":
- Include it ONLY when the user is clearly asking to go somewhere, see something, research/compare specific companies, check their portfolio/watchlist, describe what they want to screen for, add something to their watchlist, or generate a report — not for open-ended or conceptual questions.
- "symbols": company names or tickers EXACTLY as the user said them (e.g. "NVIDIA", not "NVDA") — never resolve, guess, or invent a ticker yourself; the server resolves the real symbol. Reuse a symbol from CURRENT PAGE above if the user is clearly referring to it.
- For "screener": if the user is describing what they want to find (e.g. "dividend stocks under 20 P/E", "large-cap AI companies", "something safer than NVIDIA"), include "screenerQuery" — their request rephrased as a clean filter description — and "assetClassHint" (one of: equity, etf, reit, crypto, commodity, bond, forex; default equity if unstated). Omit both if they just want the Screener opened with no specific criteria.
- For "watchlist": if the user wants to ADD a specific company (e.g. "add Tesla to my watchlist", "watch NVDA"), include "watchlistAdd" with that company name/ticker exactly as said. Omit it if they just want to open the Watchlist with no add-intent.
- "wire" covers both "start a scan" and news/signal requests — there's no separate scanner destination.
- "confidence": "high" only for an unambiguous request ("compare NVIDIA and AMD", "show me Tesla research", "where's my portfolio", "add Tesla to my watchlist"). Use "medium" or "low" when you're inferring the destination, unsure a name is real, or the request is loosely worded.
- Omit "action" entirely for general/conceptual questions ("what does P/E mean", "how do I use this app", "explain this metric").

Instructions for "answer":
- Answer in 1-4 sentences. Be direct and concrete — name the actual page/feature (e.g. "the Screener" not "the screening tool").
- If including an action, phrase the answer as what you're doing (e.g. "Opening Asset Comparison for NVIDIA and AMD.").
- "suggestions" (optional, 0-3 items): short follow-up questions or next actions, only if genuinely useful.

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "answer": "<1-4 sentences>",
  "suggestions": ["...", "..."] (optional),
  "action": {
    "destination": "research" | "compare" | "dcf" | "ic-report" | "portfolio" | "watchlist" | "screener" | "calendar" | "engine" | "thematic" | "journal" | "wire",
    "symbols": ["..."] (only if the destination needs them),
    "screenerQuery": "..." (screener only, omit if no specific criteria),
    "assetClassHint": "equity" | "etf" | "reit" | "crypto" | "commodity" | "bond" | "forex" (screener only),
    "watchlistAdd": "..." (watchlist only, omit if no add-intent),
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

/**
 * Resolves the model's raw action guess into a real, navigable action.
 * Returns undefined if the destination is unrecognized or not enough of the
 * named companies/tickers resolve to a real symbol — a failed resolution
 * falls back to the plain chat answer rather than linking somewhere broken.
 */
async function resolveAction(raw: unknown): Promise<AppAssistantAction | undefined> {
  if (raw == null || typeof raw !== "object") return undefined;
  const { destination, symbols, confidence, screenerQuery, assetClassHint, watchlistAdd } = raw as Record<string, unknown>;
  if (!isDestinationId(destination)) return undefined;
  const def = DESTINATIONS[destination];

  let resolved: string[] = [];
  if (def.minSymbols > 0) {
    const mentions = Array.isArray(symbols)
      ? symbols.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
    if (mentions.length < def.minSymbols) return undefined;

    const matches = await Promise.all(mentions.slice(0, def.maxSymbols).map((m) => searchSymbols(m.trim(), 1)));
    resolved = matches.map((m) => m[0]?.symbol).filter((s): s is string => Boolean(s));
    if (resolved.length < def.minSymbols) return undefined;
  }

  let screenerHandoff: AppAssistantAction["screenerHandoff"];
  if (destination === "screener" && typeof screenerQuery === "string" && screenerQuery.trim()) {
    const assetClass: AssetClassId = isAssetClassId(assetClassHint) ? assetClassHint : "equity";
    try {
      const { filters, templateId } = await parseNlFilters(screenerQuery.trim(), assetClass);
      screenerHandoff = { assetClass, filters, templateId };
    } catch {
      // Filter parsing failed (model/JSON error) — still navigate to a plain
      // Screener rather than dropping the whole action over it.
    }
  }

  let mutation: AppAssistantAction["mutation"];
  let href = def.href(resolved);
  if (destination === "watchlist" && typeof watchlistAdd === "string" && watchlistAdd.trim()) {
    const [match] = await searchSymbols(watchlistAdd.trim(), 1);
    if (match) {
      mutation = { kind: "watchlist_add", symbol: match.symbol, name: match.name };
      // Reuses the notification system's arrival-highlight convention
      // (data-arrival-target={symbol} on each watchlist row) so the newly
      // added ticker scrolls into view and pulses, not just "opens the page".
      href = `/watchlist?highlight=${encodeURIComponent(match.symbol)}`;
    }
    // No match — fall through to a plain /watchlist navigation rather than
    // dropping the whole action; the add just silently doesn't happen.
  }

  return {
    type: "navigate",
    destination,
    href,
    label: mutation
      ? `Adding ${mutation.symbol} to your watchlist…`
      : screenerHandoff
        ? "Opening Screener with your filters…"
        : `Opening ${def.label}…`,
    destinationLabel: def.label,
    confidence: sanitizeConfidence(confidence),
    screenerHandoff,
    mutation,
  };
}

export async function runAppAssistant(
  pathname: string,
  question: string,
  history: AppAssistantTurn[] = [],
  pageContext?: AppAssistantPageContext,
): Promise<AppAssistantResult> {
  try {
    const { text: raw, model } = await runPromptWithMeta("app-assistant", buildPrompt(pathname, question, history, pageContext));
    const parsed = extractJson<Partial<AppAssistantResult> & { action?: unknown }>(raw);

    const action = await resolveAction(parsed.action);
    // The model wrote its answer assuming the action would happen — if
    // resolution failed (e.g. it named a company that isn't real), that text
    // ("Opening Asset Comparison for...") would now be a lie, so replace it.
    const actionRequestedButUnresolved = parsed.action != null && typeof parsed.action === "object" && !action;

    const answer = actionRequestedButUnresolved
      ? "I couldn't confidently match that to a specific company — try naming it more precisely, or use ⌘K to search directly."
      : typeof parsed.answer === "string"
        ? parsed.answer.trim()
        : "";
    if (!answer) throw new Error("empty answer");

    return { answer, suggestions: sanitizeSuggestions(parsed.suggestions), action, model };
  } catch (err) {
    return { answer: failureAnswer(err), model: "unavailable" };
  }
}

/**
 * Say what actually went wrong.
 *
 * Every failure here used to report "I couldn't reach the local model — start
 * Ollama with `ollama serve`". That is only one of the things that can go
 * wrong, and on a memory-tight host it is the *least* likely: the observed case
 * was Ollama up and answering, just slower than the task's deadline, so the
 * panel told the user to start a daemon that was already running while the real
 * cause — the machine paging — went unmentioned. Advice you can't act on is
 * worse than no advice, because the user "fixes" the wrong thing.
 */
export function failureAnswer(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "OllamaUnavailableError") {
    return "I couldn't reach the local model. Start Ollama with `ollama serve` and try again, or use ⌘K to jump straight to a tool.";
  }
  if (name === "ModelMissingError") {
    return `${err instanceof Error ? err.message : "A required model isn't installed."} Then try again, or use ⌘K to jump straight to a tool.`;
  }
  if (name === "TimeoutError" || name === "AbortError" || name === "AllModelsFailedError") {
    return "Ollama is running but took too long to answer — usually the machine is low on free memory, so the model is paging. Close some apps or set `AI_MAX_MODEL_GB` lower in `.env.local` to route to a smaller model. ⌘K still works.";
  }
  return "I hit an error generating that answer. Try rephrasing, or use ⌘K to jump straight to a tool.";
}
