/**
 * Movement Explainer — "Explain Every Movement".
 *
 * General-purpose, on-demand engine that explains why a symbol, sector, or
 * portfolio moved: primary drivers, supporting evidence, confidence, and
 * expected persistence. Callable from Research, Portfolio, Watchlist, and
 * the Market Dashboard — unlike lib/scanner/causal-engine.ts and
 * thesis-builder.ts, which elaborate causal chains for a *batch* of
 * already-detected news events inside the Scanner pipeline, this module
 * answers a different question ("why did THIS specific thing move, right
 * now") for a single caller-supplied subject with no news event required.
 *
 * Deterministic evidence gathering (price/volume delta, sector momentum)
 * happens first and is never invented by the model; only the narrative
 * synthesis touches Ollama, matching the "AI explains, engines decide"
 * split used throughout lib/scanner/*.
 */

import { getQuote, getHistory } from "./yahoo";
import { getCompanyNews } from "./news";
import { runPrompt } from "./ai";
import { extractJson } from "./json-extract";
import { getLatestSectorRotation, findSectorRotationEntry } from "./sector-rotation";
import { getScannerCache, putScannerCache } from "./db";
import type {
  MovementExplanation,
  MovementDriver,
  MovementSubjectKind,
  HistoryPoint,
} from "./types";

export interface ExplainMovementInput {
  subjectKind: MovementSubjectKind;
  /** Symbol (subjectKind "symbol"), sector name (subjectKind "sector"), or "portfolio". */
  subject: string;
  /** Lookback window for the observed move. Defaults to 5 trading days. */
  windowDays?: number;
  /** For subjectKind "sector", the caller's sector name if it differs from `subject`. */
  sector?: string | null;
}

interface RawMovementResponse {
  summary: string;
  drivers: {
    category: MovementDriver["category"];
    description: string;
    evidence: string;
    direction: "bullish" | "bearish" | "neutral";
  }[];
  confidence: number;
  persistence: "transient" | "short-term" | "durable";
}

/** Exported for unit testing — pure, no I/O. */
export function windowReturn(history: HistoryPoint[], days: number): number | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const cutoff = new Date(last.date);
  cutoff.setDate(cutoff.getDate() - days);
  const start = history.find((p) => new Date(p.date) >= cutoff) ?? history[0];
  if (!start || start.close === 0) return null;
  return ((last.close - start.close) / start.close) * 100;
}

/** Exported for unit testing — pure, no I/O. */
export function volumeAnomaly(history: HistoryPoint[]): number | null {
  const withVolume = history.filter((p) => p.volume != null);
  if (withVolume.length < 10) return null;
  const recent = withVolume.slice(-3);
  const baseline = withVolume.slice(-23, -3);
  if (baseline.length === 0) return null;
  const recentAvg = recent.reduce((a, p) => a + (p.volume ?? 0), 0) / recent.length;
  const baselineAvg = baseline.reduce((a, p) => a + (p.volume ?? 0), 0) / baseline.length;
  if (baselineAvg === 0) return null;
  return ((recentAvg - baselineAvg) / baselineAvg) * 100;
}

function buildMovementPrompt(
  input: ExplainMovementInput,
  evidence: {
    changePercent: number | null;
    volumeAnomalyPct: number | null;
    news: { headline: string; publishedAt: string; summary: string | null }[];
    sectorContext: string | null;
  },
): string {
  const { subjectKind, subject, windowDays } = input;
  const subjectLabel =
    subjectKind === "symbol" ? `stock ${subject}` : subjectKind === "sector" ? `the ${subject} sector` : "this portfolio";

  const moveDesc =
    evidence.changePercent != null
      ? `${evidence.changePercent >= 0 ? "+" : ""}${evidence.changePercent.toFixed(2)}% over the last ${windowDays ?? 5} trading days`
      : "no reliable price history available";

  const volumeDesc =
    evidence.volumeAnomalyPct != null
      ? `Volume is ${evidence.volumeAnomalyPct >= 0 ? "up" : "down"} ${Math.abs(evidence.volumeAnomalyPct).toFixed(0)}% vs. the prior 3-week average.`
      : "";

  const newsDesc = evidence.news.length
    ? evidence.news.map((n) => `• [${n.publishedAt.slice(0, 10)}] ${n.headline}${n.summary ? ` — ${n.summary}` : ""}`).join("\n")
    : "No recent company-specific news found.";

  return `You are an institutional equity analyst explaining a price movement to a client.

SUBJECT: ${subjectLabel}
OBSERVED MOVE: ${moveDesc}
${volumeDesc}
${evidence.sectorContext ?? ""}

RECENT NEWS:
${newsDesc}

Identify the most likely drivers of this movement. For each driver, cite the specific evidence above that supports it — do not invent facts not present in the evidence. If the evidence is too thin to explain the move confidently, say so and lower your confidence score accordingly.

Return ONLY valid JSON:
{
  "summary": "<2-3 sentence plain-English explanation of the movement>",
  "drivers": [
    {
      "category": "earnings" | "analyst" | "macro" | "sector" | "valuation" | "news" | "technical" | "volume" | "sentiment" | "other",
      "description": "<what happened>",
      "evidence": "<the specific fact above that supports this>",
      "direction": "bullish" | "bearish" | "neutral"
    }
  ],
  "confidence": <0-100 integer — how well the evidence explains the move>,
  "persistence": "transient" | "short-term" | "durable"
}

Include 1-4 drivers, ranked most important first.`;
}

const CACHE_TTL_PREFIX = "movement";

/**
 * Explain why a symbol, sector, or portfolio moved. Results are cached
 * (reuses scanner_cache's 15-minute TTL keyed store) since re-explaining
 * the same subject within minutes wastes an Ollama call for no new evidence.
 */
export async function explainMovement(
  input: ExplainMovementInput,
): Promise<MovementExplanation> {
  const { subjectKind, subject, windowDays = 5, sector } = input;
  const cacheKey = `${CACHE_TTL_PREFIX}:${subjectKind}:${subject}:${windowDays}`;

  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as MovementExplanation;
    } catch {
      // fall through and recompute
    }
  }

  let changePercent: number | null = null;
  let volumeAnomalyPct: number | null = null;
  let news: { headline: string; publishedAt: string; summary: string | null }[] = [];
  let sectorContext: string | null = null;

  if (subjectKind === "symbol") {
    const [quote, history, companyNews] = await Promise.all([
      getQuote(subject).catch(() => null),
      getHistory(subject, Math.max(windowDays + 5, 30)),
      getCompanyNews(subject, 6).catch(() => []),
    ]);
    changePercent = windowReturn(history, windowDays) ?? quote?.changePercent ?? null;
    volumeAnomalyPct = volumeAnomaly(history);
    news = companyNews.map((n) => ({ headline: n.headline, publishedAt: n.publishedAt, summary: n.summary }));

    const effectiveSector = sector ?? null;
    const rotation = getLatestSectorRotation();
    const rotationEntry = findSectorRotationEntry(rotation, effectiveSector);
    if (rotationEntry) {
      sectorContext = `SECTOR CONTEXT: ${effectiveSector} is currently rank ${rotationEntry.rank}/11 by relative strength (${rotationEntry.classification}), 1-month return ${rotationEntry.returns["1m"]?.toFixed(1) ?? "n/a"}%.`;
    }
  } else if (subjectKind === "sector") {
    const rotation = getLatestSectorRotation();
    const entry = findSectorRotationEntry(rotation, subject);
    if (entry) {
      changePercent = entry.returns["1m"];
      sectorContext = `ROTATION DATA: rank ${entry.rank}/11, classification "${entry.classification}", momentum ${entry.momentum >= 0 ? "+" : ""}${entry.momentum.toFixed(1)}, rank change ${entry.rankChange ?? "n/a"} since prior snapshot.`;
    }
  }
  // subjectKind === "portfolio": caller is expected to pass aggregate context
  // via `sector` param misuse-free path is out of scope for v1 — portfolio-level
  // explanations compose per-holding symbol explanations instead (see callers).

  const evidence = { changePercent, volumeAnomalyPct, news, sectorContext };

  let parsed: RawMovementResponse | null = null;
  try {
    const raw = await runPrompt(buildMovementPrompt(input, evidence), {
      maxTokens: 1200,
      json: true,
    });
    parsed = extractJson<RawMovementResponse>(raw);
  } catch {
    parsed = null;
  }

  const explanation: MovementExplanation = {
    subject,
    subjectKind,
    asOf: new Date().toISOString(),
    observedMove: { changePercent, windowDays },
    summary: parsed?.summary ?? "Unable to generate an explanation — insufficient evidence or AI unavailable.",
    drivers: (parsed?.drivers ?? []).map((d) => ({
      category: d.category ?? "other",
      description: d.description ?? "",
      // Model occasionally returns an array of evidence snippets instead of
      // one string despite the schema — coerce defensively rather than
      // trusting the declared RawMovementResponse type.
      evidence: Array.isArray(d.evidence) ? (d.evidence as string[]).join("; ") : (d.evidence ?? ""),
      direction: d.direction ?? "neutral",
    })),
    confidence: Math.max(0, Math.min(100, parsed?.confidence ?? 0)),
    persistence: parsed?.persistence ?? "transient",
  };

  putScannerCache(cacheKey, JSON.stringify(explanation));
  return explanation;
}
