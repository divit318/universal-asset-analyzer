import { NextResponse } from "next/server";
import { listPortfolio } from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { runPrompt } from "@/lib/ai";
import { extractJson } from "@/lib/json-extract";
import { formatCurrency } from "@/lib/format";
import { gatherPortfolioManagerEvidence, buildBriefEvidenceSuffix } from "@/lib/ai-portfolio-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface PortfolioBrief {
  headline: string;
  narrative: string;
  topOpportunity: string;
  biggestRisk: string;
  actionItems: string[];
  model: string;
  generatedAt: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const healthScore = url.searchParams.get("h");
  const healthGrade = url.searchParams.get("g");
  const actionCount = url.searchParams.get("actions");
  const topSymbol   = url.searchParams.get("top");
  const topAction   = url.searchParams.get("act");

  const positions = listPortfolio();
  if (positions.length === 0) {
    return NextResponse.json({ error: "No positions in portfolio" }, { status: 400 });
  }

  const symbols = positions.map((p) => p.symbol);
  let quotes: Awaited<ReturnType<typeof getQuotes>> = [];
  try {
    quotes = await getQuotes(symbols);
  } catch {
    // proceed without live prices
  }

  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

  const totalCost = positions.reduce((s, p) => s + p.shares * p.avgCost, 0);
  let totalValue = 0;

  const enriched = positions.map((p) => {
    const q = quoteMap.get(p.symbol);
    const price = q?.price ?? null;
    const value = price != null ? p.shares * price : p.shares * p.avgCost;
    totalValue += value;
    return { ...p, price, value, changeToday: q?.changePercent ?? null };
  });

  const totalReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;

  const todayPL = enriched.reduce((s, p) => {
    if (p.changeToday == null || !p.price) return s;
    return s + (p.shares * p.price * (p.changeToday / 100));
  }, 0);

  const posLines = enriched
    .sort((a, b) => b.value - a.value)
    .map((p) => {
      const weight = totalValue > 0 ? ((p.value / totalValue) * 100).toFixed(1) : "?";
      const totalRet = p.price ? (((p.price - p.avgCost) / p.avgCost) * 100).toFixed(1) : "?";
      const todayStr =
        p.changeToday != null
          ? ` | today: ${p.changeToday >= 0 ? "+" : ""}${p.changeToday.toFixed(1)}%`
          : "";
      return `${p.symbol} (${p.name}): ${weight}% weight, ${totalRet}% total return${todayStr}`;
    });

  // Build analytics context from query params when available (avoids duplicate heavy fetching)
  const analyticsCtx = healthScore
    ? `\nPORTFOLIO ANALYTICS:\nHealth Score: ${healthScore}/100 (Grade ${healthGrade})\nPending decisions: ${actionCount ?? "unknown"} positions need action${topSymbol ? `\nHighest priority: ${topAction?.replace(/_/g, " ") ?? "review"} ${topSymbol}` : ""}`
    : "";

  // AI Portfolio Manager evidence: Sector Rotation + Watchlist Intelligence,
  // gathered independently so the daily brief reflects the same engines the
  // rest of the app uses — not a parallel analysis. Shared with
  // /api/portfolio/audit via lib/ai-portfolio-manager.ts.
  const evidence = await gatherPortfolioManagerEvidence(1);
  const evidenceSuffix = buildBriefEvidenceSuffix(evidence);

  const prompt = `You are a senior portfolio strategist writing a daily intelligence brief for a self-directed investor. Be specific, cite symbols and numbers, avoid generic advice.

PORTFOLIO:
Total value: ${formatCurrency(totalValue)}
Total return: ${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%
Today's P&L: ${todayPL >= 0 ? "+" : ""}${formatCurrency(Math.abs(todayPL))} ${todayPL >= 0 ? "gain" : "loss"}
Positions: ${positions.length}${analyticsCtx}${evidenceSuffix}

HOLDINGS (by weight):
${posLines.join("\n")}

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "headline": "12-15 word portfolio status for today that references a specific holding or metric",
  "narrative": "3 sentences: (1) overall portfolio state with specific numbers, (2) today's notable mover and its significance, (3) the most important forward-looking consideration for this specific portfolio — always name symbols",
  "topOpportunity": "1 sentence naming a specific symbol and a concrete reason it represents the best opportunity right now",
  "biggestRisk": "1 sentence naming the specific symbol, sector, or concentration issue that represents the most important risk to address",
  "actionItems": ["specific action for the most important position — name the symbol and be concrete", "second actionable item — specific symbol and reasoning"]
}`;

  let parsed: Omit<PortfolioBrief, "model" | "generatedAt">;
  try {
    const raw = await runPrompt(prompt, { json: true, maxTokens: 600 });
    const extracted = extractJson<Partial<Omit<PortfolioBrief, "model" | "generatedAt">>>(raw);
    // Local models occasionally omit a field despite the prompt — extractJson only
    // guarantees parseable JSON, not schema completeness. Default missing fields
    // rather than letting the client crash on e.g. actionItems.length.
    parsed = {
      headline: extracted.headline ?? "Portfolio summary",
      narrative: extracted.narrative ?? "",
      topOpportunity: extracted.topOpportunity ?? "",
      biggestRisk: extracted.biggestRisk ?? "",
      actionItems: Array.isArray(extracted.actionItems) ? extracted.actionItems : [],
    };
  } catch {
    parsed = {
      headline: "Portfolio summary — start Ollama for AI intelligence",
      narrative:
        "Run `ollama serve` in your terminal to enable AI portfolio analysis. Your holdings and P&L are shown below.",
      topOpportunity: "AI analysis unavailable — Ollama offline",
      biggestRisk: "AI analysis unavailable — Ollama offline",
      actionItems: [],
    };
  }

  return NextResponse.json({
    ...parsed,
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies PortfolioBrief);
}
