/**
 * Scanner v2 — investment thesis generation.
 *
 * For each high-conviction opportunity (composite >= 70), generates a
 * structured InvestmentThesis using the full context: events, causal chains,
 * sector analysis, and company fundamentals.
 *
 * Runs 4 parallel Ollama calls at most to keep latency reasonable.
 */

import { runPrompt } from "../ai";
import { extractJson } from "../json-extract";
import type {
  ScannerOpportunity,
  MarketEvent,
  SectorImpact,
  InvestmentThesis,
} from "../types";

interface ThesisResponse {
  headline: string;
  summary: string;
  bullCase: string[];
  bearCase: string[];
  keyCatalysts: string[];
  keyRisks: string[];
  timeHorizon: "days" | "weeks" | "months" | "quarters" | "years";
  confidence: number;
  potentialWinners: string[];
  potentialLosers: string[];
}

function buildThesisPrompt(
  opp: ScannerOpportunity,
  drivingEvents: MarketEvent[],
  sectorImpact: SectorImpact | undefined,
): string {
  const eventContext = drivingEvents
    .slice(0, 3)
    .map(
      (e) =>
        `• ${e.headline}\n  ${e.summary}\n  Effects: ${e.causalChain
          .slice(0, 3)
          .map((c) => `(${c.order}) ${c.description}`)
          .join("; ")}`,
    )
    .join("\n\n");

  const fundamentals = opp.compositeScores
    ? `Quality: ${opp.compositeScores.quality ?? "n/a"}/100 | Value: ${opp.compositeScores.value ?? "n/a"}/100 | Growth: ${opp.compositeScores.growth ?? "n/a"}/100 | Health: ${opp.compositeScores.financialHealth ?? "n/a"}/100 | Momentum: ${opp.compositeScores.momentum ?? "n/a"}/100`
    : "Fundamentals: not available";

  const quoteContext = opp.quote
    ? `Price: ${opp.quote.price?.toFixed(2)} ${opp.quote.currency} (${opp.quote.changePercent?.toFixed(2)}% today) | P/E: ${opp.quote.peRatio ?? "n/a"} | Mkt Cap: ${opp.quote.marketCap ? (opp.quote.marketCap / 1e9).toFixed(1) + "B" : "n/a"}`
    : "Quote: not available";

  const sectorContext = sectorImpact
    ? `Sector "${sectorImpact.sector}" signal: ${sectorImpact.direction} (${sectorImpact.strength}/100). ${sectorImpact.rationale}`
    : "";

  return `You are a senior equity analyst writing a structured investment thesis for an institutional audience.

COMPANY: ${opp.name} (${opp.ticker})
SIGNAL: ${opp.direction.toUpperCase()} — ${opp.theme}
CATALYST RATIONALE: ${opp.rationale}
${quoteContext}
${fundamentals}
${sectorContext}

DRIVING MARKET EVENTS:
${eventContext}

Write a complete investment thesis. Be specific, analytical, and honest about risks.
Avoid generic statements. Reference the specific events and mechanisms.

Return ONLY valid JSON:
{
  "headline": "<10 words max — the core investment case>",
  "summary": "<2-3 sentences: what is the opportunity, why does it exist now, why this company>",
  "bullCase": ["<specific bull case point 1>", "<point 2>", "<point 3>"],
  "bearCase": ["<specific bear case point 1>", "<point 2>", "<point 3>"],
  "keyCatalysts": ["<upcoming catalyst 1>", "<catalyst 2>", "<catalyst 3>"],
  "keyRisks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "timeHorizon": "weeks" | "months" | "quarters" | "years",
  "confidence": <0-100 integer>,
  "potentialWinners": ["<generic archetype that benefits — not specific tickers>", "..."],
  "potentialLosers": ["<generic archetype that loses>", "..."]
}`;
}

const MAX_CONCURRENT = 4;

/** Generate InvestmentThesis for each high-conviction opportunity. */
export async function buildTheses(
  opportunities: ScannerOpportunity[],
  events: MarketEvent[],
  sectorImpacts: SectorImpact[],
): Promise<ScannerOpportunity[]> {
  if (opportunities.length === 0) return [];

  const eventMap = new Map(events.map((e) => [e.id, e]));
  const sectorMap = new Map(sectorImpacts.map((s) => [s.sector, s]));

  const withTheses: ScannerOpportunity[] = [];

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < opportunities.length; i += MAX_CONCURRENT) {
    const batch = opportunities.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(async (opp) => {
        const drivingEvents = opp.sourceEventIds
          .map((id) => eventMap.get(id))
          .filter((e): e is MarketEvent => e != null);

        const sectorImpact = sectorMap.get(opp.theme);

        let thesis: InvestmentThesis | null = null;
        try {
          const raw = await runPrompt(
            "investment-thesis",
            buildThesisPrompt(opp, drivingEvents, sectorImpact),
            { maxTokens: 1500, json: true },
          );
          const parsed = extractJson<ThesisResponse>(raw);
          thesis = {
            headline: parsed.headline ?? "",
            summary: parsed.summary ?? "",
            bullCase: parsed.bullCase ?? [],
            bearCase: parsed.bearCase ?? [],
            keyCatalysts: parsed.keyCatalysts ?? [],
            keyRisks: parsed.keyRisks ?? [],
            timeHorizon: parsed.timeHorizon ?? "months",
            confidence: Math.max(0, Math.min(100, parsed.confidence ?? 60)),
            potentialWinners: parsed.potentialWinners ?? [],
            potentialLosers: parsed.potentialLosers ?? [],
          };
        } catch {
          // Thesis is best-effort — opportunity still surfaces without it
        }

        return { ...opp, thesis };
      }),
    );

    for (const r of results) {
      withTheses.push(r.status === "fulfilled" ? r.value : batch[withTheses.length - i]);
    }
  }

  return withTheses;
}
