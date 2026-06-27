/**
 * Unified AI provider layer.
 *
 * Priority order (first available wins):
 *   1. Ollama Cloud  — OLLAMA_API_KEY set (https://ollama.com/api)
 *   2. Ollama local  — AI_PROVIDER=ollama, no OLLAMA_API_KEY (localhost)
 *   3. Claude        — AI_PROVIDER=claude (default), ANTHROPIC_API_KEY set
 *
 * Env vars:
 *   OLLAMA_API_KEY      — Ollama cloud key (enables cloud mode automatically)
 *   OLLAMA_MODEL        — model name for Ollama cloud or local (default: llama3.2)
 *   OLLAMA_HOST         — local Ollama host (default: http://localhost:11434)
 *   AI_PROVIDER         — "claude" | "ollama" (overridden by OLLAMA_API_KEY presence)
 *   ANTHROPIC_API_KEY   — Claude API key
 *   CLAUDE_MODEL        — Claude model (default: claude-sonnet-4-6)
 */

import type { AiAnalysis } from "./types";
import type { AnalysisInput } from "./ollama";
import { buildAnalysisPrompt, analyzeWithOllama } from "./ollama";

export type AiProvider = "ollama-cloud" | "ollama" | "claude";

/** Human-readable model name for the active provider — use in response metadata. */
export function getActiveModelName(): string {
  if (process.env.OLLAMA_API_KEY) return `ollama-cloud/${process.env.OLLAMA_MODEL ?? "gemma3:12b"}`;
  const v = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  if (v === "ollama") return process.env.OLLAMA_MODEL ?? "mistral";
  return process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
}

function activeProvider(): AiProvider {
  // Ollama cloud key present → always use cloud regardless of AI_PROVIDER
  if (process.env.OLLAMA_API_KEY) return "ollama-cloud";
  const v = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  return v === "ollama" ? "ollama" : "claude";
}

/** Call Ollama cloud (/api/chat) or local (/api/generate) and return text. */
async function callOllama(
  prompt: string,
  opts: { maxTokens?: number; json?: boolean; cloud: boolean },
): Promise<string> {
  const model = process.env.OLLAMA_MODEL ?? "llama3.2";
  const userContent = opts.json
    ? `${prompt}\n\nRespond ONLY with valid JSON. No markdown, no explanation.`
    : prompt;

  if (opts.cloud) {
    const apiKey = process.env.OLLAMA_API_KEY!;
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Ollama cloud error (${res.status})`);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) throw new Error(data.error);
    return (data.message?.content ?? "").trim();
  }

  // Local Ollama
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const res = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: userContent, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama local error (${res.status})`);
  const data = (await res.json()) as { response?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.response ?? "").trim();
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

/** Route to the configured provider. */
export async function analyzeAsset(input: AnalysisInput): Promise<AiAnalysis> {
  const provider = activeProvider();
  if (provider === "ollama-cloud") {
    const model = process.env.OLLAMA_MODEL ?? "llama3.2";
    const text = await callOllama(buildAnalysisPrompt(input), { cloud: true });
    return { model: `ollama-cloud/${model}`, analysis: text };
  }
  if (provider === "ollama") return analyzeWithOllama(input);
  return analyzeWithClaude(input);
}

/** Run an arbitrary prompt through the configured provider. Returns raw text. */
export async function runPrompt(
  prompt: string,
  opts: { maxTokens?: number; json?: boolean } = {},
): Promise<string> {
  const provider = activeProvider();

  if (provider === "ollama-cloud") {
    return callOllama(prompt, { ...opts, cloud: true });
  }

  if (provider === "ollama") {
    return callOllama(prompt, { ...opts, cloud: false });
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
      max_tokens: opts.maxTokens ?? 2048,
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
