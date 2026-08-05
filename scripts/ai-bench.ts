/**
 * AI wire benchmarks — small, bounded, real calls that answer the questions
 * unit tests cannot: does the prompt cache actually hit, what is TTFT with
 * and without a cached prefix, and what does a task-class prompt cost per
 * tier. Every run prints token usage and estimated cost so spend is visible.
 *
 * Usage:
 *   npx tsx scripts/ai-bench.ts --suite cache          # prompt-cache verification (4 calls)
 *   npx tsx scripts/ai-bench.ts --suite cache --runs 2 # repeat for variance
 *   npx tsx scripts/ai-bench.ts --suite tier           # effort-tier latency/cost on a light task
 *
 * Requires an Anthropic key (ANTHROPIC_API_KEY or ~/.uaa/anthropic_api_key).
 * Spend per cache run is a few cents (two ~1.5k-token prompts, 64-token
 * answers, plus one cache write premium).
 */

import { parseArgs } from "node:util";
import { AnthropicProvider } from "../lib/ai/providers/anthropic-provider";
import { estimateCostUsd } from "../lib/ai/telemetry";
import type { ProviderChatTurn, ProviderTokenUsage } from "../lib/ai/provider";

const { values: args } = parseArgs({
  options: {
    suite: { type: "string", default: "cache" },
    runs: { type: "string", default: "1" },
    model: { type: "string", default: "claude-opus-5-low" },
  },
});

const provider = new AnthropicProvider();

interface CallStats {
  label: string;
  ttftMs: number;
  totalMs: number;
  usage: ProviderTokenUsage | undefined;
  costUsd: number | null;
  answer: string;
}

/** One streamed call, measuring TTFT at the first answer delta. */
async function timedCall(label: string, model: string, messages: ProviderChatTurn[], maxTokens = 64): Promise<CallStats> {
  let usage: ProviderTokenUsage | undefined;
  const startedAt = Date.now();
  let firstDeltaAt: number | null = null;
  let answer = "";
  const stream = provider.stream({
    model,
    messages,
    maxTokens,
    timeoutMs: 120_000,
    onUsage: (u) => {
      usage = u;
    },
  });
  for await (const delta of stream) {
    if (firstDeltaAt === null) firstDeltaAt = Date.now();
    answer += delta;
  }
  const totalMs = Date.now() - startedAt;
  return {
    label,
    ttftMs: (firstDeltaAt ?? Date.now()) - startedAt,
    totalMs,
    usage,
    costUsd: estimateCostUsd(model, usage),
    answer,
  };
}

function report(s: CallStats): void {
  const u = s.usage ?? {};
  console.log(
    `  ${s.label.padEnd(28)} ttft ${String(s.ttftMs).padStart(5)}ms  total ${String(s.totalMs).padStart(6)}ms` +
      `  in ${String(u.promptTokens ?? 0).padStart(5)}  out ${String(u.completionTokens ?? 0).padStart(4)}` +
      `  cacheW ${String(u.cacheCreationTokens ?? 0).padStart(5)}  cacheR ${String(u.cacheReadTokens ?? 0).padStart(5)}` +
      `  ~$${(s.costUsd ?? 0).toFixed(5)}`,
  );
}

/**
 * A deterministic >1024-token system prompt so it clears the cacheable
 * minimum. Content mirrors the app's house rules; the numbered filler lines
 * are inert padding, clearly labeled as such.
 */
function bigSystemPrompt(salt: string): string {
  const rules = [
    `You are an institutional-grade equity research analyst (bench run ${salt}).`,
    "Ground every claim in the evidence provided. Never invent numbers.",
    "Cite sources inline in square brackets. Be decisive and specific.",
  ];
  const filler = Array.from(
    { length: 220 },
    (_, i) => `Reference note ${i + 1}: this line is deterministic padding for prompt-cache benchmarking and carries no instruction.`,
  );
  return [...rules, "", ...filler].join("\n");
}

/**
 * Suite "cache": four calls.
 *   A1  big system + Q1   → expect cache WRITE (cacheW > 0, cacheR = 0)
 *   A2  same system + Q2  → expect cache READ  (cacheR > 0)  + faster TTFT
 *   B1  multi-turn (system+dossier+ack+Q1) → write of the conversation prefix
 *   B2  same prefix, history + new question → read of the grown prefix
 */
async function cacheSuite(model: string, run: number): Promise<boolean> {
  const salt = `${Date.now().toString(36)}-${run}`;
  const system = bigSystemPrompt(salt);
  console.log(`\ncache suite, run ${run} (model ${model}, system ~${Math.round(system.length / 4)} tokens)`);

  const a1 = await timedCall("A1 one-shot (cold write)", model, [
    { role: "system", content: system },
    { role: "user", content: "In one sentence: what is your grounding rule?" },
  ]);
  report(a1);
  const a2 = await timedCall("A2 one-shot (expect read)", model, [
    { role: "system", content: system },
    { role: "user", content: "In one sentence: what is your citation rule?" },
  ]);
  report(a2);

  const dossier = `COMPANY DOSSIER (bench ${salt}): Revenue $10B [source:yahoo]. Margin 22% [source:yahoo]. ` +
    Array.from({ length: 120 }, (_, i) => `Fact ${i + 1}: deterministic filler metric ${i * 7} [source:bench].`).join(" ");
  const base: ProviderChatTurn[] = [
    { role: "system", content: system },
    { role: "user", content: dossier },
    { role: "assistant", content: "Understood. I have the dossier and will cite it." },
  ];
  const b1 = await timedCall("B1 chat turn 1 (write)", model, [
    ...base,
    { role: "user", content: "State revenue with its citation, one line." },
  ]);
  report(b1);
  const b2 = await timedCall("B2 chat turn 2 (expect read)", model, [
    ...base,
    { role: "user", content: "State revenue with its citation, one line." },
    { role: "assistant", content: b1.answer || "Revenue is $10B [source:yahoo]." },
    { role: "user", content: "Now the margin, with its citation, one line." },
  ]);
  report(b2);

  const wroteA = (a1.usage?.cacheCreationTokens ?? 0) > 0;
  const readA = (a2.usage?.cacheReadTokens ?? 0) > 0;
  const readB = (b2.usage?.cacheReadTokens ?? 0) > 0;
  const ttftGain = a1.ttftMs > 0 ? 1 - a2.ttftMs / a1.ttftMs : 0;
  console.log(
    `  → system write: ${wroteA ? "yes" : "NO"} | system read: ${readA ? "yes" : "NO"} | ` +
      `conversation read: ${readB ? "yes" : "NO"} | TTFT A2 vs A1: ${(ttftGain * 100).toFixed(0)}%`,
  );
  return wroteA && readA && readB;
}

/**
 * Suite "tier": the same light-task prompt (nl-screener class) across effort
 * tiers — the latency/cost spread that justifies (or refutes) task tiering.
 */
async function tierSuite(models: string[]): Promise<void> {
  const messages: ProviderChatTurn[] = [
    {
      role: "system",
      content:
        "Parse the user's stock screening request into JSON with keys: sector (string|null), maxPe (number|null), minDividendYield (number|null), sortBy (string). Respond with JSON only.",
    },
    { role: "user", content: "cheap tech stocks under 15x earnings paying at least 2% dividends, best first" },
  ];
  console.log("\ntier suite (identical light-task prompt per tier)");
  for (const model of models) {
    const s = await timedCall(model, model, messages, 128);
    report(s);
    console.log(`     answer: ${s.answer.replace(/\s+/g, " ").slice(0, 140)}`);
  }
}

async function main(): Promise<void> {
  const runs = Math.max(1, Number.parseInt(args.runs ?? "1", 10) || 1);
  if (args.suite === "cache") {
    let allOk = true;
    for (let i = 1; i <= runs; i++) allOk = (await cacheSuite(args.model!, i)) && allOk;
    console.log(allOk ? "\nCACHE VERIFIED" : "\nCACHE NOT CONFIRMED — inspect the counters above");
    process.exitCode = allOk ? 0 : 1;
  } else if (args.suite === "tier") {
    await tierSuite(["claude-opus-5-low", "claude-opus-5-medium", "claude-opus-5-high"]);
  } else {
    console.error(`unknown suite "${args.suite}" (expected: cache | tier)`);
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("[ai-bench]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
