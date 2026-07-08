/**
 * Ollama Provider — the only AIProvider implementation today.
 *
 * Wraps the existing HTTP service layer (../ollama.ts: retry/backoff, typed
 * connection errors, <think> tag segregation) behind the provider-agnostic
 * {@link AIProvider} interface. Every field a future provider (a different
 * local runtime, or a hosted API) would need to supply lives here and only
 * here — the Router never imports ../ollama.ts directly.
 */

import {
  checkHealth,
  createThinkingSplitter,
  generate,
  listInstalledModels,
  splitThinking,
  streamChat,
  type ChatTurn,
} from "../ollama";
import type {
  AIProvider,
  ProviderChatTurn,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
} from "../provider";

function toChatTurns(messages: ProviderChatTurn[]): ChatTurn[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export class OllamaProvider implements AIProvider {
  readonly id = "ollama" as const;

  async listModels(): Promise<string[]> {
    return listInstalledModels();
  }

  async healthCheck(): Promise<ProviderHealth> {
    return checkHealth();
  }

  /**
   * Single-shot completion. Single system+user pairs go through `generate()`
   * (fewer round-trip concerns); anything with real multi-turn history is
   * built from `streamChat()`'s deltas so no HTTP logic is duplicated.
   */
  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    const isSimpleTurn =
      request.messages.length <= 2 &&
      request.messages.every((m) => m.role === "system" || m.role === "user");

    if (isSimpleTurn) {
      const system = request.messages.find((m) => m.role === "system")?.content;
      const user = request.messages.find((m) => m.role === "user")?.content ?? "";
      const raw = await generate(user, {
        model: request.model,
        system,
        temperature: request.temperature,
        json: request.json,
        timeoutMs: request.timeoutMs,
      });
      const { reasoning, answer } = splitThinking(raw);
      return { content: answer, reasoning };
    }

    let answer = "";
    let reasoning = "";
    const splitter = createThinkingSplitter({
      onReasoning: (t) => (reasoning += t),
      onAnswer: (t) => (answer += t),
    });
    for await (const delta of streamChat({
      model: request.model,
      messages: toChatTurns(request.messages),
      temperature: request.temperature,
      signal: request.signal,
    })) {
      splitter.push(delta);
    }
    splitter.end();
    return { content: answer.trim(), reasoning: reasoning.trim() };
  }

  async *stream(
    request: ProviderCompleteRequest,
    onReasoning?: (delta: string) => void,
  ): AsyncGenerator<string, void, unknown> {
    let pendingAnswer = "";
    const splitter = createThinkingSplitter({
      onReasoning: (t) => onReasoning?.(t),
      onAnswer: (t) => (pendingAnswer += t),
    });
    for await (const delta of streamChat({
      model: request.model,
      messages: toChatTurns(request.messages),
      temperature: request.temperature,
      signal: request.signal,
    })) {
      splitter.push(delta);
      if (pendingAnswer) {
        yield pendingAnswer;
        pendingAnswer = "";
      }
    }
    splitter.end();
    if (pendingAnswer) yield pendingAnswer;
  }
}
