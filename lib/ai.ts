/**
 * Unified AI provider layer.
 *
 * Provider selection: set AI_PROVIDER=claude (default) or AI_PROVIDER=ollama.
 * Claude needs ANTHROPIC_API_KEY. Ollama needs OLLAMA_HOST (default localhost:11434).
 */

import type { AiAnalysis } from "./types";
import type { AnalysisInput } from "./ollama";
import { buildAnalysisPrompt, analyzeWithOllama } from "./ollama";

export type AiProvider = "claude" | "ollama";

function activeProvider(): AiProvider {
  const v = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  return v === "ollama" ? "ollama" : "claude";
}

async function analyzeWithClaude(input: AnalysisInput): Promise<AiAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
  const prompt = buildAnalysisPrompt(input);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Anthropic API error (${res.status})`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text: string }[];
    model?: string;
  };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  return { model: data.model ?? model, analysis: text.trim() };
}

/** Route to the configured provider. Falls back to Ollama if Claude key is missing. */
export async function analyzeAsset(input: AnalysisInput): Promise<AiAnalysis> {
  const provider = activeProvider();
  if (provider === "ollama") return analyzeWithOllama(input);
  try {
    return await analyzeWithClaude(input);
  } catch (err) {
    // Surface config errors clearly rather than silently retrying.
    throw err;
  }
}

/** Run an arbitrary prompt through the configured provider. Returns raw text. */
export async function runPrompt(
  prompt: string,
  opts: { maxTokens?: number; json?: boolean } = {},
): Promise<string> {
  const provider = activeProvider();
  const maxTokens = opts.maxTokens ?? 2048;

  if (provider === "ollama") {
    const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
    const model = process.env.OLLAMA_MODEL ?? "mistral";
    const res = await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: opts.json
          ? `${prompt}\n\nRespond ONLY with valid JSON. No markdown, no explanation.`
          : prompt,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama error (${res.status})`);
    const data = (await res.json()) as { response?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return (data.response ?? "").trim();
  }

  // Claude
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

  const systemPrompt = opts.json
    ? "You are a precise data extraction assistant. Always respond with valid JSON only — no markdown fences, no explanation."
    : undefined;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Anthropic API error (${res.status})`);
  }

  const data = (await res.json()) as { content?: { type: string; text: string }[] };
  return data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
}
