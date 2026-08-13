/**
 * landing-panel-data.ts: regenerate the real data behind the landing page's
 * Capabilities panels.
 *
 * Policy (feature-showcase rebuild, 2026-08): every number the Capabilities
 * strip displays must be real product output. This script runs the SHIPPED
 * engines (lib/valuation, lib/screener, lib/fundamentals, the demo portfolio
 * snapshots) and bakes their output into
 * app/landing/_components/mockups/panel-data.ts with full provenance:
 * ticker, as-of timestamp, engine version (git SHA). The panels render that
 * asset and nothing else. Rerun this script to refresh the strip.
 *
 * Run: npx tsx scripts/landing-panel-data.ts
 */
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getQuote, getQuoteSummary } from "../lib/yahoo";
import { getFinancialStatementsYahoo } from "../lib/statements";
import { getCompanyNews } from "../lib/news";
import { runScreen } from "../lib/screener/pipeline";
import { runPromptWithMeta } from "../lib/ai";
import { fetchValuationFacts, canValue } from "../lib/valuation/prefill";
import {
  seedAssumptions,
  assumptionsToDcf,
  ASSUMPTION_KEYS,
  ASSUMPTION_LABEL,
  RATE_ASSUMPTIONS,
  VALUATION_METHOD_LABEL,
  IMPLIED_GROWTH_LABEL,
  type AssumptionKey,
} from "../lib/valuation/case";
import { buildScenarios, describeScenario, impliedUpside, type DcfResult } from "../lib/valuation/dcf";
import { solveImpliedGrowth } from "../lib/valuation/reverse";

const VALUATION_SYMBOL = "V";
const OUT = path.join(process.cwd(), "app", "landing", "_components", "mockups", "panel-data.ts");

/* ── Formatting (display strings are baked so panels stay dumb) ─────────── */

const fmtBillions = (v: number): string => `$${(v / 1e9).toFixed(1)}B`;
const fmtShares = (v: number): string => `${(v / 1e9).toFixed(2)}B`;
const fmtRate = (v: number): string => `${v.toFixed(1)}%`;
const fmtMoney = (v: number): string =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtSigned = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** Short provenance badge per assumption source, for the panel's rail. */
const SOURCE_BADGE: Record<string, string> = {
  yahoo: "Yahoo",
  history: "History",
  reverse_dcf: "Reverse DCF",
  platform: "CAPM",
  default: "Default",
};

interface AssumptionRow {
  key: AssumptionKey;
  label: string;
  display: string;
  source: string;
  rationale: string;
}

interface Bar {
  year: string;
  /** Free cash flow in currency units. */
  value: number;
  kind: "actual" | "forecast";
}

interface ScenarioData {
  id: "bear" | "base" | "bull";
  label: string;
  /** Delta vs the base case, from describeScenario. Null for base. */
  delta: string | null;
  fairValue: string;
  upside: string;
  upsidePositive: boolean;
  forecast: Bar[];
  bridge: {
    pvExplicit: string;
    pvTerminal: string;
    netDebt: string;
    equityValue: string;
    shares: string;
    perShare: string;
  };
}

async function buildValuation() {
  const facts = await fetchValuationFacts(VALUATION_SYMBOL);
  if (!canValue(facts) || facts.price == null) {
    throw new Error(`${VALUATION_SYMBOL} cannot be valued from current facts`);
  }
  const now = new Date().toISOString();
  const set = seedAssumptions({
    baseFcf: facts.baseFcf!,
    sharesOutstanding: facts.sharesOutstanding!,
    netDebt: facts.netDebt ?? 0,
    price: facts.price,
    discountRate: facts.wacc.waccPercent,
    terminalGrowth: facts.terminalGrowth,
    deliveredGrowth: facts.deliveredGrowth.value,
    deliveredGrowthLabel: facts.deliveredGrowth.label,
    now,
  });
  const dcf = assumptionsToDcf(set);
  const scenarios = buildScenarios(dcf);
  if (scenarios.base.invalidReason) {
    throw new Error(`base case invalid: ${scenarios.base.invalidReason}`);
  }

  const implied = solveImpliedGrowth({
    baseFcf: dcf.baseFcf,
    terminalGrowth: dcf.terminalGrowth,
    discountRate: dcf.discountRate,
    sharesOutstanding: dcf.sharesOutstanding,
    netDebt: dcf.netDebt,
    price: facts.price,
  }).impliedGrowth;

  const assumptions: AssumptionRow[] = ASSUMPTION_KEYS.map((key) => {
    const a = set[key];
    const display = RATE_ASSUMPTIONS.has(key)
      ? fmtRate(a.value)
      : key === "sharesOutstanding"
        ? fmtShares(a.value)
        : fmtBillions(a.value);
    return {
      key,
      label: ASSUMPTION_LABEL[key],
      display,
      source: SOURCE_BADGE[a.source] ?? a.source,
      rationale: a.rationale ?? "",
    };
  });

  const actuals: Bar[] = facts.fcfHistory.map((h) => ({
    year: `FY${String(h.fy).slice(2)}`,
    value: h.value,
    kind: "actual" as const,
  }));
  const lastFy = facts.fcfHistory.length > 0 ? facts.fcfHistory[facts.fcfHistory.length - 1].fy : new Date().getFullYear();

  const scenario = (
    id: ScenarioData["id"],
    label: string,
    result: DcfResult,
    assumptionsUsed: typeof dcf,
  ): ScenarioData => {
    const fv = result.fairValuePerShare!;
    const up = impliedUpside(fv, facts.price)!;
    return {
      id,
      label,
      delta: id === "base" ? null : describeScenario(dcf, assumptionsUsed),
      fairValue: fmtMoney(fv),
      upside: fmtSigned(up),
      upsidePositive: up >= 0,
      forecast: result.projection.map((row) => ({
        year: `FY${String(lastFy + row.year).slice(2)}E`,
        value: row.fcf,
        kind: "forecast" as const,
      })),
      bridge: {
        pvExplicit: fmtBillions(result.pvExplicit),
        pvTerminal: fmtBillions(result.pvTerminalValue),
        netDebt: fmtBillions(dcf.netDebt),
        equityValue: fmtBillions(result.equityValue),
        shares: fmtShares(dcf.sharesOutstanding),
        perShare: fmtMoney(fv),
      },
    };
  };

  return {
    symbol: facts.symbol,
    name: facts.name,
    currency: facts.currency,
    spot: facts.price,
    spotDisplay: fmtMoney(facts.price),
    asOf: now.slice(0, 10),
    method: VALUATION_METHOD_LABEL.dcf_fcf,
    unit: "US$B",
    assumptions,
    actuals,
    scenarios: [
      scenario("bear", "Bear", scenarios.bear, scenarios.bearAssumptions),
      scenario("base", "Base", scenarios.base, dcf),
      scenario("bull", "Bull", scenarios.bull, scenarios.bullAssumptions),
    ],
    terminalValueShare: `${(scenarios.base.terminalValueShare * 100).toFixed(0)}%`,
    pricedInGrowth: implied != null ? { label: IMPLIED_GROWTH_LABEL, display: fmtRate(implied) } : null,
    deliveredGrowth:
      facts.deliveredGrowth.value != null
        ? { label: facts.deliveredGrowth.label, display: fmtRate(facts.deliveredGrowth.value) }
        : null,
  };
}

/* ── Research Hub: real AAPL profile ────────────────────────────────────── */

const RESEARCH_SYMBOL = "AAPL";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v != null && typeof v === "object" && "raw" in (v as object)) {
    const raw = (v as { raw?: number }).raw;
    return raw != null && Number.isFinite(raw) ? raw : null;
  }
  return null;
};

const fmtCompact = (v: number | null): string => {
  if (v == null) return "n/a";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
};

async function buildResearch() {
  const [quote, summaryRaw, statements, news] = await Promise.all([
    getQuote(RESEARCH_SYMBOL),
    getQuoteSummary(RESEARCH_SYMBOL, ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"]),
    getFinancialStatementsYahoo(RESEARCH_SYMBOL),
    getCompanyNews(RESEARCH_SYMBOL, 3),
  ]);
  const raw = summaryRaw as Record<string, Record<string, unknown>>;
  const sd = raw.summaryDetail ?? {};
  const ks = raw.defaultKeyStatistics ?? {};
  const fd = raw.financialData ?? {};
  const ap = raw.assetProfile ?? {};

  const revenueTtm = num(fd.totalRevenue);
  if (statements == null) throw new Error(`no financial statements for ${RESEARCH_SYMBOL}`);
  const revenue = statements.revenue.slice(-4).map((p) => ({ year: `FY${String(p.fy).slice(2)}`, value: p.value }));
  if (revenueTtm != null) revenue.push({ year: "TTM", value: revenueTtm });
  const revenueGrowth = num(fd.revenueGrowth);

  return {
    symbol: quote.symbol,
    name: quote.name,
    exchange: "NASDAQ",
    industry: (ap.industry as string | undefined) ?? "",
    price: `$${quote.price.toFixed(2)}`,
    changePercent: `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%`,
    changePositive: quote.changePercent >= 0,
    asOf: new Date().toISOString().slice(0, 10),
    asOfShort: fmtDate(new Date().toISOString()),
    /** The real Research page's tab strip (app/research/page.tsx TABS). */
    tabs: ["Conviction", "Analysis", "Financials", "Ownership", "Details"],
    metrics: [
      ["Market cap", fmtCompact(quote.marketCap)],
      ["Enterprise value", fmtCompact(num(ks.enterpriseValue))],
      ["Revenue (TTM)", fmtCompact(revenueTtm)],
      ["Net income (TTM)", fmtCompact(num(ks.netIncomeToCommon))],
      ["P/E (TTM)", num(sd.trailingPE) != null ? `${num(sd.trailingPE)!.toFixed(1)}x` : "n/a"],
      ["Dividend yield", num(sd.dividendYield) != null ? `${(num(sd.dividendYield)! * 100).toFixed(2)}%` : "n/a"],
    ] as [string, string][],
    revenue,
    revenueTtmDisplay: fmtCompact(revenueTtm),
    revenueGrowthDisplay: revenueGrowth != null ? `${revenueGrowth >= 0 ? "+" : ""}${(revenueGrowth * 100).toFixed(1)}% YoY` : null,
    revenueGrowthPositive: (revenueGrowth ?? 0) >= 0,
    news: news.map((n) => ({ headline: n.headline, date: fmtDate(n.publishedAt) })),
  };
}

/* ── Screener: one real run of the shipped pipeline ─────────────────────── */

const SCREEN_REQUEST = {
  assetClass: "equity" as const,
  templateId: null,
  filters: {
    marketCap: { kind: "range" as const, min: 1e9, max: null },
    forwardPE: { kind: "range" as const, min: null, max: 25 },
    revenueGrowthYoY: { kind: "range" as const, min: 10, max: null },
    roic: { kind: "range" as const, min: 12, max: null },
  },
  sortKey: "rankScore",
  sortDir: "desc" as const,
  size: 8,
  offset: 0,
};

async function buildScreener() {
  // First call may build the universe; loop until the dataset is ready.
  for (let i = 0; i < 120; i++) {
    const res = await runScreen(SCREEN_REQUEST);
    if (res.status.stage !== "ready") {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    // Timing claim: measure a warm run (steady-state screen, not the build).
    const t0 = performance.now();
    await runScreen(SCREEN_REQUEST);
    const warmMs = performance.now() - t0;

    return {
      filters: ["Market cap > $1B", "Forward P/E < 25", "Revenue growth > 10%", "ROIC > 12%"],
      total: res.total,
      universe: res.universeReady,
      screenedIn: `${(warmMs / 1000).toFixed(2)}s`,
      builtAt: res.status.builtAt,
      rows: res.rows.map((r) => ({
        ticker: r.symbol,
        company: r.name,
        cap: fmtCompact(r.metrics.marketCap ?? null),
        pe: r.metrics.forwardPE != null ? `${r.metrics.forwardPE.toFixed(1)}x` : "n/a",
        growth: r.metrics.revenueGrowthYoY != null ? `${r.metrics.revenueGrowthYoY.toFixed(1)}%` : "n/a",
        roic: r.metrics.roic != null ? `${r.metrics.roic.toFixed(1)}%` : "n/a",
        score: r.rankScore,
        confidence: r.confidence,
      })),
    };
  }
  throw new Error("equity universe never became ready");
}

/* ── Portfolio: the demo book's engine-computed snapshots ───────────────── */

interface SnapshotSummary {
  totalValue: number;
  totalCost: number;
  health: number;
  healthGrade: string;
  volatility: number;
  topAssetClassWeight: number;
  allocation: { assetClass: string; weight: number }[];
}

const CLASS_LABEL: Record<string, string> = {
  cash: "Cash",
  equity: "Equities",
  bond: "Bonds",
  etf: "ETFs",
  crypto: "Crypto",
  reit: "REITs",
};

async function buildPortfolio() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "app.db"), { readOnly: true });
  // Committed states only: 'pre-execution' rows are what-if simulation
  // pre-states, so mixing them in would plot moments that never held.
  const snaps = db
    .prepare("SELECT created_at, summary FROM portfolio_snapshot WHERE label = 'post-execution' ORDER BY created_at ASC")
    .all() as { created_at: string; summary: string }[];
  const lots = db
    .prepare("SELECT DISTINCT symbol, asset_class FROM portfolio_lot WHERE asset_class IN ('equity','etf') ORDER BY symbol")
    .all() as { symbol: string; asset_class: string }[];
  db.close();
  if (snaps.length === 0) throw new Error("no demo portfolio snapshots");

  const series = snaps.map((s) => ({
    at: s.created_at,
    value: (JSON.parse(s.summary) as SnapshotSummary).totalValue,
  }));
  const latest = JSON.parse(snaps[snaps.length - 1].summary) as SnapshotSummary;

  // Downsample the trajectory to ~14 points for the sparkline, keeping ends.
  const step = Math.max(1, Math.floor(series.length / 13));
  const points = series.filter((_, i) => i % step === 0 || i === series.length - 1);

  const totalReturn = ((latest.totalValue - latest.totalCost) / latest.totalCost) * 100;
  const sinceLabel = new Date(series[0].at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

  // Today's movers among the book's exchange-listed holdings, live quotes.
  const quotes = await Promise.allSettled(lots.map((l) => getQuote(l.symbol)));
  const movers = quotes
    .flatMap((q) => (q.status === "fulfilled" ? [q.value] : []))
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 5)
    .map((q) => ({
      ticker: q.symbol,
      delta: `${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%`,
      up: q.changePercent >= 0,
    }));

  const alloc = [...latest.allocation].sort((a, b) => b.weight - a.weight);

  return {
    valueDisplay: `$${Math.round(latest.totalValue).toLocaleString("en-US")}`,
    totalReturnDisplay: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`,
    totalReturnPositive: totalReturn >= 0,
    sinceLabel,
    health: `${latest.health}`,
    healthGrade: latest.healthGrade,
    volatilityDisplay: `${latest.volatility.toFixed(1)}%`,
    trajectory: points.map((p) => ({ at: p.at.slice(0, 10), value: p.value })),
    allocation: alloc.map((a) => ({
      label: CLASS_LABEL[a.assetClass] ?? a.assetClass,
      pct: `${a.weight.toFixed(1)}%`,
      weight: a.weight,
    })),
    /** Deterministic engine findings from the snapshot, not AI prose. */
    findings: [
      `Health ${latest.health} (${latest.healthGrade}), volatility ${latest.volatility.toFixed(1)}%`,
      `${CLASS_LABEL[alloc[0].assetClass] ?? alloc[0].assetClass} is the largest sleeve at ${alloc[0].weight.toFixed(1)}%`,
      `${alloc.length} asset classes held; top weight ${latest.topAssetClassWeight.toFixed(1)}%`,
    ],
    movers,
    moversAsOf: new Date().toISOString().slice(0, 10),
  };
}

/* ── AI assistant: one REAL exchange through the shipped chain ──────────── */

type ValuationData = Awaited<ReturnType<typeof buildValuation>>;

/**
 * The division of labour the product actually ships: the engine computed the
 * valuation above; the AI explains it, quoting only engine figures. The
 * response below is a real completion from the app's provider chain
 * (lib/ai runPromptWithMeta), captured at generation time with the model id.
 * A response that introduces numbers not present in the engine output is
 * rejected, so a bad generation fails the build instead of shipping.
 */
async function buildAssistant(v: ValuationData) {
  const base = v.scenarios.find((s) => s.id === "base")!;
  const question = `Why is fair value ${base.fairValue} when ${v.name} trades at ${v.spotDisplay}?`;

  // Reuse the previously captured exchange when the engine numbers behind it
  // have not changed (same question), so reruns do not spend a live AI call.
  // Pass --fresh-ai to force a new capture.
  if (!process.argv.includes("--fresh-ai")) {
    try {
      const prev = readFileSync(OUT, "utf8");
      const parsed = JSON.parse(prev.slice(prev.indexOf("= ") + 2, prev.lastIndexOf(" as const"))) as {
        assistant?: { question: string } & Record<string, unknown>;
      };
      if (parsed.assistant && parsed.assistant.question === question) {
        console.log("assistant: reusing previously captured exchange (same engine numbers)");
        return parsed.assistant as never;
      }
    } catch {
      /* no previous asset; capture fresh */
    }
  }

  const prompt = `You are the research copilot inside UAA. The deterministic valuation engine has already computed everything below for ${v.name} (${v.symbol}). You never compute, adjust, or propose numbers; you explain the engine's output.

ENGINE OUTPUT (${v.method}, 10y explicit + terminal, data as of ${v.asOf})
- Spot price: ${v.spotDisplay}
- Base fair value: ${base.fairValue} per share (${base.upside} vs spot)
- Assumptions: trailing FCF ${v.assumptions[0].display} (Yahoo), FCF growth Y1-5 ${v.assumptions[1].display} (delivered ${v.deliveredGrowth?.label ?? "history"}), Y6-10 fade to ${v.assumptions[2].display}, terminal growth ${v.assumptions[3].display}, WACC ${v.assumptions[4].display} (CAPM), shares ${v.assumptions[5].display}, net debt ${v.assumptions[6].display}
- Bridge: PV explicit ${base.bridge.pvExplicit} + PV terminal ${base.bridge.pvTerminal} - net debt ${base.bridge.netDebt} = equity ${base.bridge.equityValue}; over ${base.bridge.shares} shares = ${base.fairValue}
- Terminal value share of enterprise value: ${v.terminalValueShare}
- Priced-in growth (reverse DCF, conditional on this WACC and terminal growth): ${v.pricedInGrowth?.display ?? "n/a"}

USER QUESTION
${question}

RULES
1. Use ONLY figures listed above, quoted exactly as written. Introduce no other numbers.
2. At most three short sentences and 450 characters total. Plain prose only: no JSON, no headers, no bullets, no markdown, no em dashes.
3. Name where the deciding inputs came from (delivered history, CAPM) so the reader sees the answer is derived, not asserted.`;

  // Truth gate: every decimal figure in the answer must exist in the prompt.
  const validate = (answer: string): string | null => {
    const allowed = new Set((prompt.match(/\d+(?:[.,]\d+)+|\d+(?:\.\d+)?%|\d+(?:\.\d+)?[BMT]\b/g) ?? []).map((m) => m.replace(/[$,]/g, "")));
    const used = answer.match(/\d+(?:[.,]\d+)+|\d+(?:\.\d+)?%|\d+(?:\.\d+)?[BMT]\b/g) ?? [];
    const invented = used.filter((u) => !allowed.has(u.replace(/[$,]/g, "")));
    if (invented.length > 0) return `introduced numbers not in engine output: ${invented.join(", ")}`;
    if (answer.includes("\u2014")) return "contains an em dash";
    if (answer.startsWith("{") || answer.includes("```")) return "not plain prose";
    if (answer.length < 80 || answer.length > 560) return `length out of range (${answer.length} chars)`;
    return null;
  };

  let answer = "";
  let model = "";
  let reason: string | null = "not attempted";
  for (let attempt = 0; attempt < 3 && reason != null; attempt++) {
    // "company-research" is the copilot's free-text Q&A task (prose mode);
    // "scenario-analysis" is jsonMode and would wrap the answer in JSON.
    const res = await runPromptWithMeta("company-research", prompt, { timeoutMs: 180_000 });
    answer = res.text.trim().replace(/\s+/g, " ");
    model = res.model;
    reason = validate(answer);
  }
  if (reason != null) throw new Error(`assistant response rejected: ${reason}`);

  return {
    question,
    answer,
    model,
    generatedAt: new Date().toISOString().slice(0, 10),
    context: {
      symbol: v.symbol,
      name: v.name,
      fairValue: base.fairValue,
      upside: base.upside,
      upsidePositive: base.upsidePositive,
      spot: v.spotDisplay,
    },
    sources: [
      `Valuation case ${v.symbol}`,
      "Reverse DCF",
      `Data: Yahoo, ${v.asOf}`,
    ],
  };
}

/* ── Assembly ───────────────────────────────────────────────────────────── */

async function main() {
  const gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };

  const valuation = await buildValuation();
  const [research, screener, portfolio] = await Promise.all([
    buildResearch(),
    buildScreener(),
    buildPortfolio(),
  ]);

  // The one live AI call. If the chain is unavailable the strip must not ship
  // a fabricated exchange: the panel is dropped (assistant: null) per the
  // fabrication policy, and features.tsx renders the strip without it.
  let assistant: Awaited<ReturnType<typeof buildAssistant>> | null = null;
  try {
    assistant = await buildAssistant(valuation);
  } catch (err) {
    console.warn(`assistant panel NOT generated (${err instanceof Error ? err.message : err}); it will be omitted from the strip`);
  }

  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      gitSha,
      appVersion: pkg.version ?? "0.0.0",
      generator: "scripts/landing-panel-data.ts",
    },
    valuation,
    research,
    screener,
    portfolio,
    assistant,
  };

  const body = `/**
 * GENERATED by scripts/landing-panel-data.ts. Do not edit by hand.
 *
 * Real product output for the landing page's Capabilities panels: every
 * figure below was computed by the shipped engines against live provider
 * data at the timestamp in \`meta\`. Regenerate with:
 *
 *   npx tsx scripts/landing-panel-data.ts
 */
export const PANEL_DATA = ${JSON.stringify(data, null, 2)} as const;

export type PanelData = typeof PANEL_DATA;
`;
  writeFileSync(OUT, body);
  console.log(`wrote ${OUT}`);
  console.log(`valuation: ${valuation.symbol} spot ${valuation.spotDisplay} base FV ${valuation.scenarios[1].fairValue} (${valuation.scenarios[1].upside})`);
  console.log(`research: ${research.symbol} ${research.price} (${research.changePercent}), ${research.news.length} headlines`);
  console.log(`screener: ${screener.total} of ${screener.universe} matched in ${screener.screenedIn}`);
  console.log(`portfolio: ${portfolio.valueDisplay}, health ${portfolio.health} (${portfolio.healthGrade}), ${portfolio.movers.length} movers`);
  console.log(assistant ? `assistant: model ${assistant.model}, ${assistant.answer.length} chars` : "assistant: OMITTED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
