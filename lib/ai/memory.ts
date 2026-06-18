/**
 * Memory Layer — session persistence + citation resolution.
 *
 * Conversations are persisted per session (keyed to a symbol) so multi-turn
 * context and history survive reloads. This module wraps the SQLite accessors
 * and provides the pure citation extractor that turns the `[source:tag]`
 * markers the model emits into resolved, linkable citations.
 */

import {
  appendMessage,
  ensureSession,
  getSessionMessages,
} from "../db";
import type { Citation, ChatMessage, CompanyContext } from "./types";

/** Load prior conversation for a session as ChatMessages. */
export function loadHistory(sessionId: string): ChatMessage[] {
  return getSessionMessages(sessionId).map((m) => {
    const meta = m.meta ? (JSON.parse(m.meta) as { citations?: Citation[]; reasoning?: string }) : null;
    return {
      role: m.role,
      content: m.content,
      citations: meta?.citations,
      reasoning: meta?.reasoning,
      createdAt: m.createdAt,
    };
  });
}

/** Persist a completed user+assistant exchange. */
export function persistTurn(
  sessionId: string,
  symbol: string,
  userText: string,
  assistant: { content: string; citations: Citation[]; reasoning: string },
): void {
  ensureSession(sessionId, symbol);
  appendMessage(sessionId, "user", userText);
  appendMessage(
    sessionId,
    "assistant",
    assistant.content,
    JSON.stringify({ citations: assistant.citations, reasoning: assistant.reasoning }),
  );
}

const CITATION_RE = /\[([a-z]+:[^\]]+|news)\]/gi;

/**
 * Extract and resolve the citation tags an answer references, in first-seen
 * order. Filing tags resolve to the filing's SEC URL and news tags to the
 * article link where determinable; others resolve to a label only. Pure.
 */
export function extractCitations(answer: string, ctx: CompanyContext): Citation[] {
  const found = new Map<string, Citation>();
  for (const match of answer.matchAll(CITATION_RE)) {
    const tag = match[1].toLowerCase();
    if (found.has(tag)) continue;
    found.set(tag, resolveCitation(tag, ctx));
  }
  return [...found.values()];
}

function resolveCitation(tag: string, ctx: CompanyContext): Citation {
  // News: "[news]" or "[news:2]" → link the referenced (or first) article.
  if (tag === "news" || tag.startsWith("news")) {
    const idx = Number(tag.split(":")[1]) - 1;
    const item = Number.isInteger(idx) && idx >= 0 ? ctx.news[idx] : ctx.news[0];
    return { tag, label: item ? `News: ${item.title.slice(0, 60)}` : "Recent news", url: item?.link ?? null };
  }
  // EDGAR filings: try to match a referenced form to a filing URL.
  if (tag.startsWith("edgar")) {
    const filing =
      ctx.filings.find((f) => tag.includes(f.form.toLowerCase())) ?? ctx.filings[0];
    return {
      tag,
      label: tag.startsWith("edgar:statements") ? "SEC financial statements" : `SEC filing${filing ? ` — ${filing.form}` : ""}`,
      url: filing?.documentUrl ?? null,
    };
  }
  // Everything else (yahoo:*, platform:*) is a data source label, no URL.
  const label = SOURCE_LABELS[tag] ?? tag.replace(/[:_]/g, " ");
  return { tag, label, url: null };
}

const SOURCE_LABELS: Record<string, string> = {
  "yahoo:profile": "Company profile",
  "yahoo:price": "Price & market data",
  "yahoo:valuation": "Valuation metrics",
  "yahoo:growth": "Growth metrics",
  "yahoo:profitability": "Profitability metrics",
  "yahoo:health": "Financial health",
  "yahoo:analyst": "Analyst consensus",
  "yahoo:insider": "Insider activity",
  "yahoo:ownership": "Ownership data",
  "yahoo:peers": "Peer comparison",
  "platform:score": "Platform score",
  "platform:risk": "Risk assessment",
  "platform:momentum": "Technical / momentum",
};
