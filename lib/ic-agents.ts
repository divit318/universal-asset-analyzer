/**
 * IC Pipeline — Stage 3: Investigation Agent Network.
 *
 * 9 specialised agents (AGENT_DOMAINS is the single source of the count).
 * Each agent receives a DISTINCT evidence slice and a DISTINCT analytical
 * mandate — including an explicit "not yours" list — so the network produces
 * differentiated findings instead of nine restatements of the same three
 * facts (Phase 3.3).
 *
 * Citation enforcement (Phase 3.6): every finding is verified against the
 * exact data slice its agent was handed; findings whose figures cannot be
 * traced are confidence-downgraded and flagged, never rendered as clean fact.
 *
 * Person-level gating (Phase 3.7): agents may reference named individuals
 * only as they appear in the provided transaction records, and are instructed
 * to make no claims about individuals beyond those records.
 */

import { runPrompt } from "./ai";
import { taskForAgentDomain } from "./ai/task-registry";
import { extractJsonObject } from "./json-extract";
import { verifyGrounding, collectClaimText, type GroundingReport } from "./ai/grounding";
import { MAX_QUESTIONS_PER_AGENT, AGENT_LABELS, type InvestigativeQuestion, type AgentDomain } from "./ic-questions";
import type { ScreenerInCompany } from "./screener-in";
import type { DetectedSignal } from "./ic-signals";
import type { CanonicalFacts } from "./ic/canonical";
import { fmtPercent, fmtMultiple, fmtMoney, fmtMoneyCompact, fmtFiscalPeriod } from "./ic/format";

export const AGENT_PROMPT_VERSION = "agents-2";

export interface AgentFinding {
  agent: AgentDomain;
  agentLabel: string;
  /** Number of questions actually included in the prompt (capped). */
  questionsAnswered: number;
  /** Questions assigned to this agent before the cap. */
  questionsAssigned: number;
  findings: string;
  keyInsights: string[];
  confidence: "high" | "medium" | "low";
  /** Set when grounding forced a downgrade — the reason is user-facing. */
  confidenceDowngraded: string | null;
  dataLimitations: string | null;
  /** Verification that the agent's figures trace back to its data slice. */
  grounding?: GroundingReport;
  promptVersion: string;
}

/* -------------------------------------------------------------------------- */
/* Evidence slices — each domain sees different data (Phase 3.3)              */
/* -------------------------------------------------------------------------- */

export interface AgentContext {
  facts: CanonicalFacts;
  signals: DetectedSignal[];
  /** The current ValuationCase, rendered by lib/valuation/case.ts:summarizeCase. */
  valuationCaseSummary?: string | null;
  /** Established engine conclusions (reverse DCF, headline) for the valuation critic. */
  engineConclusions?: string | null;
}

function statementLines(facts: CanonicalFacts): string[] {
  const st = facts.statements;
  if (!st) return ["Annual statements: not available (see data gaps)."];
  const cur = st.currency;
  const fmtSeries = (label: string, s: { fy: number; end?: string | null; value: number }[], money = true) =>
    `${label}: ${s.map((p) => `${fmtFiscalPeriod(p)}: ${money ? fmtMoneyCompact(p.value, cur) : fmtPercent(p.value)}`).join(", ")}`;
  return [
    fmtSeries("Revenue", st.revenue),
    fmtSeries("Net income", st.netIncome),
    fmtSeries("Free cash flow", st.freeCashFlow),
    fmtSeries("Operating margin", st.operatingMargin, false),
    `Revenue CAGR (${st.revenueCagrYears ?? "?"}y): ${st.revenueCagr != null ? fmtPercent(st.revenueCagr) : "not available"}`,
  ];
}

function profitabilityLines(f: CanonicalFacts): string[] {
  return [
    `Gross margin: ${f.grossMargin ? fmtPercent(f.grossMargin.value) : "n/a"} | Operating margin: ${f.operatingMargin ? fmtPercent(f.operatingMargin.value) : "n/a"} | Net margin: ${f.netMargin ? fmtPercent(f.netMargin.value) : "n/a"}`,
    `ROE: ${f.returnOnEquity ? fmtPercent(f.returnOnEquity.value) : "n/a"} | ROA: ${f.returnOnAssets ? fmtPercent(f.returnOnAssets.value) : "n/a"}`,
    `Revenue growth YoY: ${f.revenueGrowthYoY ? fmtPercent(f.revenueGrowthYoY.value) : "n/a"} | Earnings growth YoY: ${f.earningsGrowthYoY ? fmtPercent(f.earningsGrowthYoY.value) : "n/a"}`,
  ];
}

function balanceSheetLines(f: CanonicalFacts): string[] {
  const c = f.currency;
  return [
    `Total debt: ${f.totalDebt ? fmtMoneyCompact(f.totalDebt.value, c) : "n/a"} | Total cash: ${f.totalCash ? fmtMoneyCompact(f.totalCash.value, c) : "n/a"} | Net debt: ${f.netDebt ? fmtMoneyCompact(f.netDebt.value, c) : "n/a"}`,
    `D/E: ${f.debtToEquity ? fmtMultiple(f.debtToEquity.value, 2) : "n/a"} | Current ratio: ${f.currentRatio ? fmtMultiple(f.currentRatio.value, 2) : "n/a"}`,
    `FCF (TTM): ${f.freeCashFlowTtm ? fmtMoneyCompact(f.freeCashFlowTtm.value, c) : "n/a"} | EBITDA (TTM): ${f.ebitdaTtm ? fmtMoneyCompact(f.ebitdaTtm.value, c) : "n/a"}`,
  ];
}

function multipleLines(f: CanonicalFacts): string[] {
  return [
    `Trailing P/E: ${f.trailingPE ? fmtMultiple(f.trailingPE.value) : "n/a"} | Forward P/E: ${f.forwardPE ? fmtMultiple(f.forwardPE.value) : "n/a"} | PEG: ${f.pegRatio ? f.pegRatio.value.toFixed(2) : "n/a"}`,
    `P/B: ${f.priceToBook ? fmtMultiple(f.priceToBook.value) : "n/a"} | EV/EBITDA: ${f.evToEbitda ? fmtMultiple(f.evToEbitda.value) : "n/a"} | P/S: ${f.priceToSales ? fmtMultiple(f.priceToSales.value) : "n/a"}`,
    `Dividend yield: ${f.dividendYield ? fmtPercent(f.dividendYield.value, { digits: 2 }) : "n/a"}`,
  ];
}

function analystLines(f: CanonicalFacts): string[] {
  const a = f.analyst;
  if (!a || (a.numberOfOpinions ?? 0) === 0) return ["Analyst coverage: none reported for this name."];
  const c = f.currency;
  const total = a.strongBuy + a.buy + a.hold + a.sell + a.strongSell;
  return [
    `Analyst consensus (${a.numberOfOpinions ?? 0} analysts): mean target ${a.targetMean != null ? fmtMoney(a.targetMean, c) : "n/a"} (low ${a.targetLow != null ? fmtMoney(a.targetLow, c) : "n/a"}, high ${a.targetHigh != null ? fmtMoney(a.targetHigh, c) : "n/a"})`,
    `Distribution: ${total > 0 ? `SB:${a.strongBuy} B:${a.buy} H:${a.hold} S:${a.sell} SS:${a.strongSell}` : a.recommendationKey ?? "n/a"}`,
    `EPS revisions (30d): up ${a.epsRevisionsUp30d ?? 0}, down ${a.epsRevisionsDown30d ?? 0}`,
    `EPS surprises (recent, most recent first): ${a.epsSurprises.slice(0, 4).map((v) => fmtPercent(v, { signed: true })).join(", ") || "none"}`,
  ];
}

function insiderLines(f: CanonicalFacts): string[] {
  const ins = f.insider;
  if (!ins || ins.transactions.length === 0) return ["Insider transactions: none reported for this name."];
  return [
    `Insider activity: ${ins.buyCount} buys, ${ins.sellCount} sells, net ${fmtMoneyCompact(ins.netValue, f.currency)}`,
    `Recent transactions (as filed): ${ins.transactions.slice(0, 3).map((t) => `${t.name}: ${t.type}${t.shares ? `, ${Math.round(t.shares / 1000)}K shares` : ""}`).join("; ")}`,
  ];
}

function screenerInLines(f: CanonicalFacts): string[] {
  const si = f.screenerIn;
  if (!si) return [];
  const out = [
    `screener.in: market cap ₹${si.marketCap ?? "n/a"} Cr | price ₹${si.currentPrice ?? "n/a"} | P/E ${si.pe ?? "n/a"} | ROCE ${si.roce ?? "n/a"}% | ROE ${si.roe ?? "n/a"}%`,
    `Promoter holding: ${si.promoterHolding ?? "n/a"}% | Shareholding: ${si.shareholding.map((s) => `${s.name}: ${s.values.at(-1)}%`).join(", ")}`,
  ];
  if (si.peers.length > 0) {
    out.push(`Peers: ${si.peers.slice(0, 5).map((p) => `${p.name} (P/E ${p.pe ?? "n/a"}, ROCE ${p.roce ?? "n/a"}%)`).join("; ")}`);
  }
  return out;
}

function signalLines(signals: DetectedSignal[], categories?: string[]): string[] {
  const filtered = categories ? signals.filter((s) => categories.includes(s.category)) : signals;
  if (filtered.length === 0) return [];
  return [
    "Detected signals:",
    ...filtered.map((s) => `  [${s.severity.toUpperCase()}] ${s.category}: ${s.description}`),
  ];
}

function spotLines(f: CanonicalFacts): string[] {
  return [
    `Spot: ${f.spot ? fmtMoney(f.spot.value, f.currency) : "n/a"} | Market cap: ${f.marketCap ? fmtMoneyCompact(f.marketCap.value, f.currency) : "n/a"} | Data as of ${f.asOf.slice(0, 10)}`,
  ];
}

/** Build the DISTINCT evidence slice for one domain. Exported for tests. */
export function buildDataContext(ctx: AgentContext, domain: AgentDomain): string {
  const f = ctx.facts;
  const sections: string[][] = [spotLines(f)];

  switch (domain) {
    case "business":
      sections.push(profitabilityLines(f), statementLines(f), signalLines(ctx.signals, ["MARGIN_COMPRESSION", "REVENUE_DECELERATION"]));
      break;
    case "industry":
      sections.push(
        [`Sector: ${f.sector ?? "n/a"} | Industry: ${f.industry ?? "n/a"}`],
        [`Revenue growth YoY: ${f.revenueGrowthYoY ? fmtPercent(f.revenueGrowthYoY.value) : "n/a"}`],
        statementLines(f).slice(0, 1),
        screenerInLines(f).slice(2, 3),
        signalLines(ctx.signals, ["REVENUE_DECELERATION", "INVENTORY_SPIKE", "FII_SELLING"]),
      );
      break;
    case "competition":
      sections.push(profitabilityLines(f).slice(0, 1), multipleLines(f).slice(0, 1), screenerInLines(f).slice(2, 3), signalLines(ctx.signals, ["MARGIN_COMPRESSION", "WORKING_CAPITAL_DETERIORATION"]));
      break;
    case "management":
      sections.push(analystLines(f), insiderLines(f), signalLines(ctx.signals, ["EARNINGS_MISS_STREAK", "INSIDER_SELLING"]));
      break;
    case "capitalAllocation":
      sections.push(balanceSheetLines(f), statementLines(f), signalLines(ctx.signals, ["DEBT_INCREASE", "FCF_DETERIORATION", "ROCE_DROP"]));
      break;
    case "accounting":
      sections.push(statementLines(f), balanceSheetLines(f), signalLines(ctx.signals, ["FCF_DETERIORATION", "MARGIN_COMPRESSION", "INVENTORY_SPIKE", "WORKING_CAPITAL_DETERIORATION"]));
      break;
    case "valuation":
      if (ctx.valuationCaseSummary) {
        sections.push([ctx.valuationCaseSummary, "", "This case is the app's user-owned estimate. Critique it; do not replace it."]);
      }
      if (ctx.engineConclusions) sections.push([ctx.engineConclusions]);
      sections.push(multipleLines(f), signalLines(ctx.signals, ["VALUATION_STRETCH"]));
      break;
    case "governance":
      sections.push(insiderLines(f), screenerInLines(f), signalLines(ctx.signals, ["INSIDER_SELLING", "FII_SELLING", "DII_BUYING"]));
      break;
    case "risk":
      sections.push(balanceSheetLines(f).slice(0, 2), multipleLines(f).slice(0, 1), signalLines(ctx.signals));
      break;
  }

  if (f.gaps.length > 0) {
    sections.push(["Known data gaps for this name:", ...f.gaps.map((g) => `  - ${g.concept}: ${g.reason}`)]);
  }

  return sections.filter((s) => s.length > 0).map((s) => s.join("\n")).join("\n\n");
}

/* -------------------------------------------------------------------------- */
/* Agent mandates — each answers something no other agent answers             */
/* -------------------------------------------------------------------------- */

export const AGENT_CONFIG: Record<AgentDomain, { label: string; persona: string; notYours: string }> = {
  business: {
    label: AGENT_LABELS.business,
    persona: "You analyse how this company makes money: unit economics, revenue drivers, pricing power, and what the margin structure says about the business model's durability.",
    notYours: "Do not discuss valuation multiples, industry lifecycle, or management quality: other agents own those.",
  },
  industry: {
    label: AGENT_LABELS.industry,
    persona: "You analyse the industry, not the company: sector growth rate, lifecycle stage, regulatory environment, technology disruption, and whether industry tailwinds or headwinds dominate the next 3-5 years.",
    notYours: "Do not restate company-level margins or valuation: assess only the environment the company operates in.",
  },
  competition: {
    label: AGENT_LABELS.competition,
    persona: "You benchmark this company against its competitors: relative margin position, share trends visible in the data, moat type and durability, and threat from entrants and substitutes.",
    notYours: "Do not evaluate industry attractiveness in the abstract or the company's own business model: compare, always against named or implied peers.",
  },
  management: {
    label: AGENT_LABELS.management,
    persona: "You assess the delivery record: EPS surprises vs consensus as evidence of guidance credibility, estimate revision direction, and what insider transactions say about conviction. Use role-level language for individuals; make no claims about a named person beyond the transactions listed in your data.",
    notYours: "Do not analyse capital allocation returns or governance structure: separate agents own those.",
  },
  capitalAllocation: {
    label: AGENT_LABELS.capitalAllocation,
    persona: "You judge where the cash went: FCF generation vs debt change, evidence of reinvestment intensity, and whether the balance-sheet trajectory shows discipline or drift.",
    notYours: "Do not evaluate management's guidance record or the business model: judge only the capital decisions visible in the numbers.",
  },
  accounting: {
    label: AGENT_LABELS.accounting,
    persona: "You test earnings quality: does profit convert to cash (net income vs FCF, year by year), are margins and working-capital trends internally consistent, and where could the reported numbers flatter reality?",
    notYours: "Do not opine on valuation or strategy: confine yourself to the integrity of the reported numbers.",
  },
  valuation: {
    // Deliberately a critic, not a producer: the deterministic engine owns all
    // computed values; the user's ValuationCase owns the persisted estimate.
    label: AGENT_LABELS.valuation,
    persona: "You review the valuation evidence handed to you. Do NOT produce your own fair value, price target or upside. State where the case's or engine's assumptions are supported by the data and where they are not, name the single weakest assumption and what evidence would change it, and flag any internal inconsistency (growth without reinvestment, terminal value dominance, discount rate ignoring leverage).",
    notYours: "Do not emit any price target, fair value, or upside percentage: the deterministic engine computes every number.",
  },
  governance: {
    label: AGENT_LABELS.governance,
    persona: "You analyse who owns and controls the company: ownership concentration and its quarterly direction, promoter/insider behaviour as filed, and minority shareholder protection. Use role-level language; no claims about named individuals beyond the filed records provided.",
    notYours: "Do not assess management skill or capital allocation: only structure, ownership and conduct.",
  },
  risk: {
    label: AGENT_LABELS.risk,
    persona: "You identify and SIZE the risks that could cause permanent capital loss: leverage, valuation air pockets, concentration, macro and regulatory exposure. Rank them; a risk list without ranking is noise.",
    notYours: "Do not re-litigate the bull case or business quality: assume the other agents' work and stress it.",
  },
};

/* -------------------------------------------------------------------------- */
/* Single agent runner                                                        */
/* -------------------------------------------------------------------------- */

const AGENT_TIMEOUT_MS = 180_000;
const AGENT_RETRIES = 1;

async function runAgent(
  domain: AgentDomain,
  questions: InvestigativeQuestion[],
  ctx: AgentContext,
  model?: string,
): Promise<AgentFinding> {
  const config = AGENT_CONFIG[domain];
  const dataContext = buildDataContext(ctx, domain);

  const included = questions.slice(0, MAX_QUESTIONS_PER_AGENT);
  const questionList = included.map((q, i) => `Q${i + 1}: ${q.question}`).join("\n");

  const prompt = `${config.persona}

${config.notYours}

You are analysing ${ctx.facts.companyName} (${ctx.facts.symbol}). Use ONLY the structured data provided below. Do not make up facts or figures. Every number you cite must appear in the data below. If the data is insufficient to answer a question, say so explicitly — a stated gap is more useful than a guess.

DATA:
${dataContext}

QUESTIONS TO INVESTIGATE:
${questionList}

IMPORTANT: Reply with ONLY a raw JSON object. No markdown, no code fences, no explanation before or after. Start your reply with { and end with }.

{
  "findings": "2-4 paragraphs of integrated findings. Be specific: cite the numbers from DATA. Write for a senior investment committee.",
  "keyInsights": ["3-5 bullet points: the most important actionable insights, each grounded in a figure from DATA"],
  "confidence": "high|medium|low",
  "dataLimitations": "null or a sentence describing missing data"
}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= AGENT_RETRIES; attempt++) {
    try {
      const raw = await runPrompt(taskForAgentDomain(domain), prompt, {
        maxTokens: 1200,
        json: true,
        model,
        timeoutMs: AGENT_TIMEOUT_MS,
      });
      const parsed = extractAgentJson(raw);

      // Verify the agent's prose against the exact data slice it was handed.
      const grounding = verifyGrounding(
        collectClaimText([parsed.findings, parsed.keyInsights]),
        dataContext,
      );

      // Citation enforcement (Phase 3.6): findings with untraceable figures
      // cannot present as clean fact — downgrade and say why.
      let confidence = parsed.confidence;
      let confidenceDowngraded: string | null = null;
      if (grounding.unsupportedNumbers.length > 0 && confidence !== "low") {
        confidence = confidence === "high" ? "medium" : "low";
        confidenceDowngraded = `${grounding.unsupportedNumbers.length} figure(s) in this finding could not be traced to the agent's data slice`;
      }

      return {
        agent: domain,
        agentLabel: config.label,
        questionsAnswered: included.length,
        questionsAssigned: questions.length,
        findings: parsed.findings,
        keyInsights: parsed.keyInsights,
        confidence,
        confidenceDowngraded,
        dataLimitations: parsed.dataLimitations,
        grounding,
        promptVersion: AGENT_PROMPT_VERSION,
      };
    } catch (err) {
      lastError = err;
      if (attempt < AGENT_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Extract agent JSON from a raw LLM response, with multiple fallback strategies. */
export function extractAgentJson(raw: string): {
  findings: string;
  keyInsights: string[];
  confidence: "high" | "medium" | "low";
  dataLimitations: string | null;
} {
  // Strategy 1: shared brace/fence extraction (lib/json-extract.ts)
  const parsed = extractJsonObject(raw, {
    findings: "",
    keyInsights: [] as string[],
    confidence: "",
    dataLimitations: null as string | null,
  });
  if (parsed.findings) {
    return {
      findings: parsed.findings,
      keyInsights: parsed.keyInsights.filter((s): s is string => typeof s === "string"),
      confidence: normaliseConfidence(parsed.confidence),
      dataLimitations: typeof parsed.dataLimitations === "string" ? parsed.dataLimitations : null,
    };
  }

  // Strategy 2: extract prose text by aggressively stripping all JSON scaffolding
  const cleanText = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    // Remove trailing JSON fragments: anything from ", "keyInsights": [ onwards
    .replace(/",?\s*"keyInsights"\s*:\s*\[[\s\S]*$/m, "")
    .replace(/",?\s*"confidence"\s*:\s*"[^"]*"[\s\S]*$/m, "")
    .replace(/",?\s*"dataLimitations"\s*:[\s\S]*$/m, "")
    // Remove leading JSON open and "findings": "
    .replace(/^\s*\{[\s\S]*?"findings"\s*:\s*"/m, "")
    // Strip surrounding quotes left after removal
    .replace(/^"|"$/g, "")
    // Unescape JSON string escapes
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();

  return {
    findings: cleanText || "Insufficient data for analysis.",
    keyInsights: [],
    confidence: "low",
    dataLimitations: "AI response format could not be fully parsed.",
  };
}

function normaliseConfidence(v?: string): "high" | "medium" | "low" {
  if (!v) return "low";
  const s = v.toLowerCase();
  if (s.includes("high")) return "high";
  if (s.includes("med")) return "medium";
  return "low";
}

/* -------------------------------------------------------------------------- */
/* Public: run the agent network                                              */
/* -------------------------------------------------------------------------- */

export interface AgentNetworkInput {
  facts: CanonicalFacts;
  questionsByAgent: Map<AgentDomain, InvestigativeQuestion[]>;
  screenerIn?: ScreenerInCompany | null;
  signals: DetectedSignal[];
  /** The current ValuationCase, rendered by lib/valuation/case.ts:summarizeCase. */
  valuationCaseSummary?: string | null;
  /** Established deterministic-engine conclusions handed to the valuation critic. */
  engineConclusions?: string | null;
}

export interface AgentFailure {
  agent: AgentDomain;
  agentLabel: string;
  error: string;
  /** Failures are per-agent and retryable; the report renders them as such. */
  retryable: boolean;
}

export interface AgentNetworkResult {
  findings: AgentFinding[];
  failures: AgentFailure[];
}

/**
 * Run every investigation agent, one at a time by default. Ollama's default
 * local setup serves one request at a time regardless of how many we fire
 * (n_slots = 1) — dispatching all of them concurrently doesn't parallelise
 * anything, it just queues them, and a fixed per-request timeout then races
 * against the whole queue instead of its own generation. Sequential dispatch
 * keeps each agent's timeout budget meaningful and gives steady progress.
 * `concurrency` > 1 is supported for setups with OLLAMA_NUM_PARALLEL configured.
 */
export async function runAgentNetwork(
  input: AgentNetworkInput,
  onAgentComplete?: (finding: AgentFinding) => void,
  model?: string,
  concurrency = 1,
): Promise<AgentNetworkResult> {
  const ctx: AgentContext = {
    facts: input.facts,
    signals: input.signals,
    valuationCaseSummary: input.valuationCaseSummary,
    engineConclusions: input.engineConclusions,
  };

  const entries = [...input.questionsByAgent.entries()].filter(([, qs]) => qs.length > 0);
  const findings: AgentFinding[] = [];
  const failures: AgentFailure[] = [];

  const runOne = async ([domain, questions]: [AgentDomain, InvestigativeQuestion[]]) => {
    try {
      const finding = await runAgent(domain, questions, ctx, model);
      findings.push(finding);
      onAgentComplete?.(finding);
    } catch (err) {
      failures.push({
        agent: domain,
        agentLabel: AGENT_CONFIG[domain].label,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
      });
    }
  };

  if (concurrency <= 1) {
    for (const entry of entries) await runOne(entry);
  } else {
    const queue = [...entries];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let e = queue.shift(); e; e = queue.shift()) await runOne(e);
    });
    await Promise.all(workers);
  }

  // Stable order regardless of completion order.
  const order = new Map(entries.map(([d], i) => [d, i]));
  findings.sort((a, b) => (order.get(a.agent) ?? 0) - (order.get(b.agent) ?? 0));

  return { findings, failures };
}

/**
 * Re-run a single failed agent (per-agent retry affordance, Phase 7.6).
 */
export async function retryAgent(
  domain: AgentDomain,
  input: AgentNetworkInput,
  model?: string,
): Promise<AgentFinding> {
  const ctx: AgentContext = {
    facts: input.facts,
    signals: input.signals,
    valuationCaseSummary: input.valuationCaseSummary,
    engineConclusions: input.engineConclusions,
  };
  const questions = input.questionsByAgent.get(domain) ?? [];
  return runAgent(domain, questions, ctx, model);
}
