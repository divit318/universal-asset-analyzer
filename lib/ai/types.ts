/**
 * Domain types for the AI Equity Research Copilot.
 *
 * The copilot is built from eight cooperating layers (model registry, Ollama
 * service, context, retrieval, prompt, memory, actions, chat API). These types
 * are the contracts shared between them and the UI. Everything here is plain
 * data so the pure layers stay trivially unit-testable.
 */

import type {
  AnalystConsensus,
  FinancialStatements,
  FundamentalsSnapshot,
  InsiderActivity,
  MomentumSignal,
  NewsItem,
  PeerComparison,
  Quote,
  RiskItem,
  ScoreResult,
} from "../types";

export type { NewsItem };

/* -------------------------------------------------------------------------- */
/* Company intelligence (Context Layer output)                                */
/* -------------------------------------------------------------------------- */

/** Long-form company profile (business description, ownership, people). */
export interface CompanyProfile {
  symbol: string;
  description: string | null; // long business summary
  sector: string | null;
  industry: string | null;
  country: string | null;
  website: string | null;
  employees: number | null;
  enterpriseValue: number | null;
  institutionalOwnership: number | null; // % held by institutions
  insiderOwnership: number | null; // % held by insiders
  officers: { name: string; title: string }[];
}

/**
 * The complete, structured intelligence bundle for one company — the single
 * source of truth the copilot reasons over. Assembled once per symbol and
 * cached; every chat turn is grounded in this object. Any field may be null
 * when a source is unavailable, which the copilot must surface honestly rather
 * than invent.
 */
export interface CompanyContext {
  symbol: string;
  name: string;
  builtAt: string; // ISO — when this bundle was assembled
  quote: Quote;
  profile: CompanyProfile | null;
  snapshot: FundamentalsSnapshot | null;
  statements: FinancialStatements | null;
  analyst: AnalystConsensus | null;
  insider: InsiderActivity | null;
  score: ScoreResult | null;
  risks: RiskItem[];
  momentum: MomentumSignal | null;
  peers: PeerComparison | null;
  filings: { form: string; filedAt: string; description: string; documentUrl: string }[];
  news: NewsItem[];
  onWatchlist: boolean;
  /** Analyst notes saved from prior research sessions — cross-stock memory. */
  savedNotes?: { symbol: string; content: string; createdAt: string }[];
  /** Non-fatal problems gathering data, surfaced so the copilot can be candid. */
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Retrieval Layer                                                            */
/* -------------------------------------------------------------------------- */

/** Coarse topics a question maps to; drives which context sections we inject. */
export type ResearchIntent =
  | "valuation"
  | "growth"
  | "profitability"
  | "financialHealth"
  | "competitive"
  | "management"
  | "capitalAllocation"
  | "risks"
  | "catalysts"
  | "thesis"
  | "earnings"
  | "filings"
  | "news"
  | "ownership"
  | "technical"
  | "comparison"
  | "general";

/** A labeled, source-tagged block of evidence handed to the prompt builder. */
export interface ContextBlock {
  /** Stable section id, e.g. "valuation", "filings". */
  id: string;
  /** Citation tag the model is told to cite, e.g. "yahoo:valuation". */
  source: string;
  /** Human-facing heading. */
  heading: string;
  /** Pre-formatted, compact body (key: value lines). */
  body: string;
  /** Selection priority (higher = kept first under a token budget). */
  priority: number;
}

/** A citation the model referenced, resolved back to a source + optional URL. */
export interface Citation {
  tag: string; // e.g. "edgar:10-K 2024-11-01"
  label: string;
  url: string | null;
}

/* -------------------------------------------------------------------------- */
/* Chat / conversation (Memory Layer + Chat API)                              */
/* -------------------------------------------------------------------------- */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant turns once streaming completes. */
  citations?: Citation[];
  /** Reasoning trace from thinking models, kept separate from the answer. */
  reasoning?: string;
  createdAt?: string;
}

/** Request body for POST /api/research/chat. */
export interface ChatRequest {
  symbol: string;
  messages: ChatMessage[];
  /** Optional predefined research action id (overrides free-text intent). */
  action?: string;
  /** Optional model override; falls back to the default registry model. */
  model?: string;
  /** Stable session id so multi-turn history persists across reloads. */
  sessionId?: string;
}

/**
 * Wire protocol: the chat route streams newline-delimited JSON, one event per
 * line. `delta` events carry answer tokens; a single terminal `meta` event
 * carries citations + suggested follow-ups; `error` signals failure.
 */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "meta"; citations: Citation[]; suggestions: string[]; model: string }
  | { type: "error"; message: string; code: "ollama_unavailable" | "model_missing" | "internal" };
