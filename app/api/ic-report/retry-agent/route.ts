/**
 * POST /api/ic-report/retry-agent — re-run a single failed agent (Phase 7.6).
 *
 * Rebuilds the agent's context from the persisted report (canonical facts,
 * questions and signals are all on the report object), runs just that agent,
 * patches the stored report and returns the new finding. A single agent
 * failing never costs the whole report.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { retryAgent } from "@/lib/ic-agents";
import { groupByAgent, AGENT_DOMAINS, type AgentDomain } from "@/lib/ic-questions";
import { buildEstablishedConclusions } from "@/lib/ic-thesis";
import { getReport, saveReport } from "@/lib/ic/store";

const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/;

export async function POST(req: Request): Promise<Response> {
  let body: { symbol?: string; agent?: string };
  try {
    body = (await req.json()) as { symbol?: string; agent?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase() ?? "";
  const agent = body.agent as AgentDomain | undefined;
  if (!SYMBOL_RE.test(symbol)) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }
  if (!agent || !AGENT_DOMAINS.includes(agent)) {
    return Response.json({ error: "Unknown agent domain" }, { status: 400 });
  }

  const report = getReport(symbol);
  if (!report) {
    return Response.json({ error: "No saved report for this symbol; run the report first" }, { status: 404 });
  }

  try {
    const finding = await retryAgent(agent, {
      facts: report.facts,
      questionsByAgent: groupByAgent(report.questions),
      signals: report.signals,
      engineConclusions: buildEstablishedConclusions(report.valuation),
    });

    const patched = {
      ...report,
      agentFindings: [...report.agentFindings.filter((f) => f.agent !== agent), finding],
      agentFailures: report.agentFailures.filter((f) => f.agent !== agent),
    };
    saveReport(patched);

    return Response.json({ finding });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Agent retry failed" },
      { status: 502 },
    );
  }
}
