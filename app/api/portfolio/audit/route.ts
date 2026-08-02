import { checkPlatformHealth, unavailableMessage } from "@/lib/ai/platform-health";
import { runTaskChat } from "@/lib/ai/orchestrator";
import { gatherPortfolioManagerEvidence, buildAuditEvidenceBlock } from "@/lib/ai-portfolio-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function POST(request: Request) {
  let body: { analytics: Record<string, unknown> };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const a = (body.analytics ?? body) as Record<string, unknown>;

  const { reachable } = await checkPlatformHealth();
  if (!reachable) {
    return Response.json(
      { error: unavailableMessage("the AI audit"), code: "ai_unavailable" },
      { status: 503 },
    );
  }

  // Build analytics context from the compact summary
  const health     = (a.health as { total: number; grade: string; summary: string } | null) ?? null;
  const risk       = (a.risk as { beta?: number; sharpeRatio?: number; maxDrawdown?: number; hhi?: number; concentrationRisk?: string } | null) ?? null;
  const factors    = (a.factors as { topFactor?: string; bottomFactor?: string } | null) ?? null;
  const gaps       = (a.gaps as { missing?: { name: string; priority: string }[]; concentrationScore?: number } | null) ?? null;
  const alerts     = (a.alerts as { title: string; severity: string; description: string }[] | null) ?? [];
  const recs       = (a.topRecommendations as { symbol: string; action: string; composite?: number; reasoning: string }[] | null) ?? [];
  const sectors    = (a.sectorAllocation as { sector: string; weight: number }[] | null) ?? [];
  const bench      = (a.benchmark as { spyReturn1y?: number; portfolioReturn1y?: number } | null) ?? null;
  const worst      = (a.worstScenario as { name: string; portfolioImpact: number } | null) ?? null;
  const totalValue = (a.totalValue as number | null) ?? 0;
  const totalReturn = (a.totalReturn as number | null) ?? 0;
  const posCount   = (a.positionCount as number | null) ?? 0;

  const sectorSummary = sectors.slice(0, 6).map((s) => `${s.sector} ${s.weight.toFixed(1)}%`).join(", ") || "not available";
  const alertLines  = alerts.slice(0, 4).map((al) => `- [${al.severity.toUpperCase()}] ${al.title}: ${al.description}`).join("\n") || "- None";
  const recLines    = recs.slice(0, 6).map((r) => `- ${r.symbol}: ${r.action}${r.composite != null ? ` (score ${r.composite}/100)` : ""} — ${r.reasoning.split(".")[0]}`).join("\n") || "- None";
  const gapList     = (gaps?.missing ?? []).slice(0, 5).map((m) => `${m.name} (${m.priority})`).join(", ") || "none";
  const riskLine    = risk
    ? `Beta ${risk.beta?.toFixed(2) ?? "—"}, Sharpe ${risk.sharpeRatio?.toFixed(2) ?? "—"}, MaxDD ${risk.maxDrawdown?.toFixed(1) ?? "—"}%, HHI ${risk.hhi ?? "—"} (${risk.concentrationRisk ?? "—"} concentration)`
    : "not available";

  const evidence = await gatherPortfolioManagerEvidence(3);
  const evidenceBlock = buildAuditEvidenceBlock(evidence);

  const prompt = `You are a Chief Investment Officer writing a portfolio audit memo. Be specific, cite the data provided, and write like an institutional analyst — not a robo-advisor.

PORTFOLIO SNAPSHOT:
- Portfolio value: $${totalValue.toLocaleString()}
- Total return: ${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%
- Positions: ${posCount}
- Health score: ${health?.total ?? "—"}/100 (Grade ${health?.grade ?? "—"}) — ${health?.summary ?? ""}
- Sector composition: ${sectorSummary}
- Risk profile: ${riskLine}
- Dominant factor: ${factors?.topFactor ?? "—"}, underweight: ${factors?.bottomFactor ?? "—"}
${bench?.spyReturn1y != null ? `- vs SPY 1Y: portfolio ${bench.portfolioReturn1y?.toFixed(1) ?? "—"}% vs SPY ${bench.spyReturn1y.toFixed(1)}%` : ""}
${worst != null ? `- Worst stress scenario: ${worst.name} → ${worst.portfolioImpact.toFixed(1)}% impact` : ""}

KEY ALERTS:
${alertLines}

POSITION RECOMMENDATIONS (from deterministic engine — not invented):
${recLines}

MISSING SECTOR EXPOSURES: ${gapList}
DIVERSIFICATION SCORE: ${gaps?.concentrationScore ?? "—"}/100

${evidenceBlock}

Write a concise institutional memo with these exact sections. Use ONLY the data above — do not invent numbers:

**STRENGTHS**
2-3 specific strengths with data citations.

**WEAKNESSES**
2-3 specific weaknesses. Name symbols and metrics.

**HIDDEN RISKS**
1-2 non-obvious risks the numbers hint at but the investor may not see.

**PORTFOLIO THEMES**
What macro/sector themes dominate this portfolio? Reference the Sector Rotation data — is this portfolio positioned in leading or lagging sectors right now?

**KEY OPPORTUNITIES**
2 highest-conviction next actions. Name symbols. Consider Watchlist Intelligence alerts as candidate opportunities if they strengthen the case.

**ACTION PLAN**
3 specific, concrete actions for this week. Start each with a verb.

Keep it under 400 words. Be direct. Avoid generic advice.`;

  const messages = [
    { role: "system" as const, content: "You are a senior CIO writing an institutional portfolio review. Be analytical, specific, and always cite numbers from the data provided. Never invent figures." },
    { role: "user" as const, content: prompt },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Model choice, generation settings, and fallback are the Router's job —
        // this route names the task and supplies the conversation, nothing more.
        for await (const delta of runTaskChat("portfolio-audit", messages, {
          signal: request.signal,
        })) {
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // client cancelled — close silently
        } else {
          controller.enqueue(encoder.encode("\n\n[AI analysis interrupted]"));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
