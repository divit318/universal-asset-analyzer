/**
 * Domain types for the AI Equity Research Copilot.
 *
 * The copilot is built from eight cooperating layers (model registry, provider
 * service, context, retrieval, prompt, memory, actions, chat API). These types
 * are the contracts shared between them and the UI. Everything here is plain
 * data so the pure layers stay trivially unit-testable.
 */

import type {
  AnalystConsensus,
  FinancialStatements,
  FundamentalsSnapshot,
  InsiderActivity,
  InvestmentPersonality,
  MomentumSignal,
  NewsItem,
  OwnershipData,
  PeerComparison,
  Quote,
  RiskItem,
  ScoreResult,
  SectorRotationEntry,
  TimelineEvent,
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
  personality: InvestmentPersonality | null;
  peers: PeerComparison | null;
  filings: { form: string; filedAt: string; description: string; documentUrl: string }[];
  news: NewsItem[];
  onWatchlist: boolean;
  ownership: OwnershipData | null;
  /** This company's sector's Sector Rotation Engine entry, if the sector maps to a GICS ETF. */
  sectorRotation: SectorRotationEntry | null;
  /** Most recent Investment Timeline milestones (persisted feed, no live sync — see buildCompanyContext). */
  recentTimelineEvents: TimelineEvent[];
  /** Theme + sibling symbols from the Opportunity Map, when this symbol was in the last Scanner run. */
  relatedOpportunities: { theme: string; siblings: string[] } | null;
  /** Top Knowledge Graph neighbors (label + relationship), when available. */
  graphNeighbors: { label: string; relationship: string; type: string }[];
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

export type { GroundingReport } from "./grounding";
import type { GroundingReport } from "./grounding";

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
  /** Post-hoc verification of how well this answer traces to the dossier. */
  grounding?: GroundingReport;
  createdAt?: string;
}

/**
 * The user's portfolio context serialized for AI consumption.
 * Sent client → server on every chat turn so the copilot can give
 * portfolio-personalized advice without accessing localStorage server-side.
 */
export interface PortfolioContextForAI {
  hasPortfolio: boolean;
  objective: string;
  holdingSymbols: string[];
  sectorWeights: Array<{ sector: string; weight: number }>;
  missingSectors: string[];
  overweightSectors: string[];
  /** IOS-computed fit score for the stock currently being researched. */
  fitScore?: number;
  fitTier?: string;
  fitReasons?: string[];
  isInPortfolio?: boolean;
  suggestedAllocationPct?: number;
  suggestedAmount?: number;
  concentrationWarning?: boolean;
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
  /** User's portfolio context — makes every copilot response portfolio-aware. */
  portfolioContext?: PortfolioContextForAI;
}

/**
 * Wire protocol: the chat route streams newline-delimited JSON, one event per
 * line. `delta` events carry answer tokens; a single terminal `meta` event
 * carries citations + suggested follow-ups; `error` signals failure.
 */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "meta"; citations: Citation[]; suggestions: string[]; model: string; grounding: GroundingReport }
  // `ai_unavailable` is provider-agnostic on purpose: it means "no backend
  // could answer" — today, that the Anthropic key is missing or the API is
  // unreachable.
  | { type: "error"; message: string; code: "ai_unavailable" | "model_missing" | "internal" };
