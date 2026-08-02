/**
 * Golden-output parity harness (ai-migration/03 §8, Phase 5 amendment 4).
 *
 * Same inputs through BOTH providers, diff the structured fields. The symbol
 * set deliberately includes degenerate inputs — thin float, no SEC filings
 * (OTC ADR), non-US listings, a recent IPO with short history, and quiet
 * mega-caps where the dossier is genuinely ambiguous — because nine runs on
 * AAPL prove determinism, not correctness.
 *
 * The check that matters most is EVIDENCE GROUNDING: every driver's
 * `evidence` field must be traceable to the dossier. A provider that starts
 * inventing drivers when evidence is thin fails parity regardless of how
 * fluent the output is.
 *
 * Usage:
 *   npx tsx scripts/ai-parity.ts                    # both providers, all symbols
 *   npx tsx scripts/ai-parity.ts --devin-only
 *   npx tsx scripts/ai-parity.ts --ollama-only
 *   npx tsx scripts/ai-parity.ts --symbols AAPL,KOSS
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { getQuote, getHistory } from "@/lib/yahoo";
import { getCompanyNews } from "@/lib/news";
import { windowReturn, volumeAnomaly } from "@/lib/movement-explainer";
import {
  MovementAnalysisSchema,
  MovementWireSchema,
  MOVEMENT_SCHEMA_VERSION,
  type MovementAnalysis,
} from "@/lib/ai/schemas/movement";
import type { AnalysisRequest } from "@/lib/ai/analysis-provider";
import { devinAnalysisProvider } from "@/lib/ai/providers/devin/provider";
import { ollamaAnalysisProvider } from "@/lib/ai/providers/ollama-analysis";
import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnvLocal();

const { values: args } = parseArgs({
  options: {
    symbols: { type: "string" },
    "devin-only": { type: "boolean", default: false },
    "ollama-only": { type: "boolean", default: false },
  },
});

/** 15 symbols; the label records WHY each is in the set. */
const SYMBOL_SET: { symbol: string; label: string }[] = [
  { symbol: "AAPL", label: "mega-cap, heavy news" },
  { symbol: "MSFT", label: "mega-cap" },
  { symbol: "NVDA", label: "mega-cap, volatile" },
  { symbol: "JPM", label: "financial" },
  { symbol: "XOM", label: "energy" },
  { symbol: "TSLA", label: "narrative-heavy" },
  { symbol: "KOSS", label: "DEGENERATE: microcap thin float" },
  { symbol: "BGFV", label: "DEGENERATE: microcap, sparse coverage" },
  { symbol: "NSRGY", label: "DEGENERATE: OTC ADR, no SEC filings" },
  { symbol: "RELIANCE.NS", label: "DEGENERATE: non-US listing (NSE India)" },
  { symbol: "7203.T", label: "DEGENERATE: non-US listing (Tokyo)" },
  { symbol: "CRCL", label: "DEGENERATE: recent IPO, short history" },
  { symbol: "PG", label: "DEGENERATE: quiet mover, ambiguous dossier" },
  { symbol: "PEP", label: "DEGENERATE: quiet mover, ambiguous dossier" },
  { symbol: "GLD", label: "DEGENERATE: commodity ETF (no company news)" },
];

interface Dossier {
  symbol: string;
  prompt: string;
  newsCount: number;
  changePercent: number | null;
  historyDays: number;
  volumeAnomalyPct: number | null;
}

async function buildDossier(symbol: string): Promise<Dossier> {
  const windowDays = 5;
  const [quote, history, news] = await Promise.all([
    getQuote(symbol).catch(() => null),
    getHistory(symbol, 30).catch(() => [] as Awaited<ReturnType<typeof getHistory>>),
    getCompanyNews(symbol, 6).catch(() => []),
  ]);
  const changePercent = windowReturn(history, windowDays) ?? quote?.changePercent ?? null;
  const volPct = volumeAnomaly(history);

  const moveDesc =
    changePercent != null
      ? `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% over the last ${windowDays} trading days`
      : "no reliable price history available";
  const volumeDesc =
    volPct != null ? `Volume is ${volPct >= 0 ? "up" : "down"} ${Math.abs(volPct).toFixed(0)}% vs. the prior 3-week average.` : "";
  const newsDesc = news.length
    ? news.map((n) => `• [${n.publishedAt.slice(0, 10)}] ${n.headline}${n.summary ? ` — ${n.summary}` : ""}`).join("\n")
    : "No recent company-specific news found.";

  const prompt = `You are an institutional equity analyst explaining a price movement to a client.

SUBJECT: stock ${symbol}${quote?.name ? ` (${quote.name})` : ""}
OBSERVED MOVE: ${moveDesc}
${volumeDesc}

EVIDENCE — RECENT NEWS:
${newsDesc}

Identify the most likely drivers of this movement. For each driver, cite the
specific evidence above that supports it — do not invent facts not present in
the evidence. If the evidence is too thin to explain the move confidently, say
so in the summary and lower the confidence score accordingly.

${JSON_SCHEMA_LEAD_IN}
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
  "confidence": <0-100 integer>,
  "persistence": "transient" | "short-term" | "durable"
}

Include 1-4 drivers, ranked most important first.`;

  return { symbol, prompt, newsCount: news.length, changePercent, historyDays: history.length, volumeAnomalyPct: volPct };
}

/**
 * Is a driver's `evidence` traceable to the dossier? Token overlap rather
 * than exact substring, because models quote with elisions: ≥60% of the
 * evidence's significant words (len>3) must appear in the dossier.
 */
export function isGrounded(evidence: string, dossier: string): boolean {
  const words = evidence.toLowerCase().match(/[a-z0-9%$.]{4,}/g) ?? [];
  if (words.length === 0) return false;
  const hay = dossier.toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits / words.length >= 0.6;
}

interface ProviderOutcome {
  ok: boolean;
  ms: number;
  output?: MovementAnalysis;
  ungroundedDrivers?: { category: string; evidence: string }[];
  sessionUrl?: string;
  error?: string;
}

async function runProvider(kind: "ollama" | "devin", d: Dossier): Promise<ProviderOutcome> {
  const req: AnalysisRequest<MovementAnalysis> = {
    taskType: "explain-movement",
    subjectKey: `parity:${d.symbol}`,
    prompt: d.prompt,
    schema: MovementAnalysisSchema,
    wireSchema: MovementWireSchema,
    schemaVersion: MOVEMENT_SCHEMA_VERSION,
    idempotencyKey: `parity-${kind}-${d.symbol}-${Date.now()}`,
  };
  const t0 = performance.now();
  try {
    const provider = kind === "devin" ? devinAnalysisProvider : ollamaAnalysisProvider;
    const res = await provider.run(req);
    const ungrounded = res.data.drivers
      .filter((dr) => !isGrounded(dr.evidence, d.prompt))
      .map((dr) => ({ category: dr.category, evidence: dr.evidence }));
    return {
      ok: true,
      ms: performance.now() - t0,
      output: res.data,
      ungroundedDrivers: ungrounded,
      sessionUrl: res.meta.sessionUrl,
    };
  } catch (err) {
    return { ok: false, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

interface SymbolReport {
  symbol: string;
  label: string;
  dossier: { newsCount: number; changePercent: number | null; historyDays: number; promptChars: number };
  devin?: ProviderOutcome;
  ollama?: ProviderOutcome;
  diff?: {
    persistenceAgree: boolean;
    confidenceDelta: number | null;
    driverCategoryOverlap: string[];
    directionConflicts: string[];
  };
}

function diffOutcomes(a?: ProviderOutcome, b?: ProviderOutcome): SymbolReport["diff"] | undefined {
  if (!a?.output || !b?.output) return undefined;
  const catsA = new Map(a.output.drivers.map((d) => [d.category, d.direction]));
  const catsB = new Map(b.output.drivers.map((d) => [d.category, d.direction]));
  const overlap = [...catsA.keys()].filter((c) => catsB.has(c));
  return {
    persistenceAgree: a.output.persistence === b.output.persistence,
    confidenceDelta: a.output.confidence - b.output.confidence,
    driverCategoryOverlap: overlap,
    directionConflicts: overlap.filter((c) => catsA.get(c) !== catsB.get(c)),
  };
}

async function main() {
  const only = args["devin-only"] ? "devin" : args["ollama-only"] ? "ollama" : null;
  const chosen = args.symbols
    ? args.symbols.split(",").map((s) => ({ symbol: s.trim().toUpperCase(), label: "custom" }))
    : SYMBOL_SET;

  console.log(`[parity] ${chosen.length} symbols, providers: ${only ?? "both"}\n`);
  console.log(`[parity] building dossiers from live data…`);
  const dossiers: (Dossier & { label: string })[] = [];
  for (const { symbol, label } of chosen) {
    const d = await buildDossier(symbol);
    dossiers.push({ ...d, label });
    console.log(
      `  ${symbol.padEnd(12)} news=${d.newsCount} move=${d.changePercent?.toFixed(2) ?? "n/a"}% history=${d.historyDays}d prompt=${d.prompt.length}ch  (${label})`,
    );
  }

  // Devin: concurrent (proven to 40-way with no penalty). Ollama: sequential
  // (the daemon serializes generations anyway).
  const reports = new Map<string, SymbolReport>(
    dossiers.map((d) => [
      d.symbol,
      {
        symbol: d.symbol,
        label: d.label,
        dossier: { newsCount: d.newsCount, changePercent: d.changePercent, historyDays: d.historyDays, promptChars: d.prompt.length },
      },
    ]),
  );

  if (only !== "ollama") {
    console.log(`\n[parity] devin: ${dossiers.length} concurrent sessions…`);
    const outcomes = await Promise.all(dossiers.map((d) => runProvider("devin", d)));
    outcomes.forEach((o, i) => {
      reports.get(dossiers[i].symbol)!.devin = o;
      console.log(
        `  devin  ${dossiers[i].symbol.padEnd(12)} ${o.ok ? "ok " : "FAIL"} ${(o.ms / 1000).toFixed(1)}s conf=${o.output?.confidence ?? "-"} drivers=${o.output?.drivers.length ?? "-"} ungrounded=${o.ungroundedDrivers?.length ?? "-"}${o.error ? ` err=${o.error.slice(0, 80)}` : ""}`,
      );
    });
  }
  if (only !== "devin") {
    console.log(`\n[parity] ollama: ${dossiers.length} sequential generations…`);
    for (const d of dossiers) {
      const o = await runProvider("ollama", d);
      reports.get(d.symbol)!.ollama = o;
      console.log(
        `  ollama ${d.symbol.padEnd(12)} ${o.ok ? "ok " : "FAIL"} ${(o.ms / 1000).toFixed(1)}s conf=${o.output?.confidence ?? "-"} drivers=${o.output?.drivers.length ?? "-"} ungrounded=${o.ungroundedDrivers?.length ?? "-"}${o.error ? ` err=${o.error.slice(0, 80)}` : ""}`,
      );
    }
  }

  for (const r of reports.values()) r.diff = diffOutcomes(r.devin, r.ollama);

  /* ------------------------------ summary ------------------------------- */
  console.log(`\n========== PARITY SUMMARY ==========`);
  console.log(`symbol       | news | move%  | devin conf/drv/ungr | ollama conf/drv/ungr | pers agree | conf Δ | dir conflicts`);
  for (const r of reports.values()) {
    const dv = r.devin, ol = r.ollama;
    const fmt = (o?: ProviderOutcome) =>
      o?.output ? `${String(o.output.confidence).padStart(3)}/${o.output.drivers.length}/${o.ungroundedDrivers?.length ?? 0}` : o ? "FAIL" : "—";
    console.log(
      `${r.symbol.padEnd(12)} | ${String(r.dossier.newsCount).padStart(4)} | ${(r.dossier.changePercent?.toFixed(1) ?? "n/a").padStart(6)} | ${fmt(dv).padEnd(19)} | ${fmt(ol).padEnd(20)} | ${r.diff ? (r.diff.persistenceAgree ? "yes" : "NO ").padEnd(10) : "—".padEnd(10)} | ${r.diff?.confidenceDelta != null ? String(r.diff.confidenceDelta).padStart(5) : "    —"} | ${r.diff?.directionConflicts.join(",") || "none"}`,
    );
  }

  const all = [...reports.values()];
  const devinUngrounded = all.flatMap((r) => r.devin?.ungroundedDrivers ?? []);
  const ollamaUngrounded = all.flatMap((r) => r.ollama?.ungroundedDrivers ?? []);
  console.log(`\nEvidence discipline: devin ungrounded drivers=${devinUngrounded.length}, ollama ungrounded drivers=${ollamaUngrounded.length}`);
  for (const [name, list] of [["devin", devinUngrounded], ["ollama", ollamaUngrounded]] as const) {
    for (const u of list) console.log(`  [${name}] UNGROUNDED (${u.category}): "${u.evidence.slice(0, 100)}"`);
  }

  const outDir = path.join(process.cwd(), "bench-out", "parity");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `parity-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify([...reports.values()], null, 2));
  console.log(`\n[parity] full record → ${outFile}`);

  const failures = all.filter((r) => (r.devin && !r.devin.ok) || (r.ollama && !r.ollama.ok));
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[parity] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
