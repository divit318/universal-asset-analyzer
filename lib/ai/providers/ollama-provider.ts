/**
 * Ollama Provider — the only AIProvider implementation today.
 *
 * Wraps the HTTP service layer (../ollama.ts: retry/backoff, typed connection
 * errors, reasoning segregation) behind the provider-agnostic {@link AIProvider}
 * interface. Every field a future provider would need to supply lives here and
 * only here — the Router never imports ../ollama.ts directly.
 *
 * Reasoning arrives on two channels and both are handled: modern Ollama returns
 * it in a native `thinking` field, while older models inline it as <think> tags
 * in the answer text. Reading only one of the two is how chain-of-thought
 * previously vanished (or leaked into answers) depending on the model.
 */

import {
  checkHealth,
  createThinkingSplitter,
  generate,
  listModelInfo,
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
  ProviderModelInfo,
} from "../provider";

function toChatTurns(messages: ProviderChatTurn[]): ChatTurn[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export class OllamaProvider implements AIProvider {
  readonly id = "ollama" as const;

  async listModels(): Promise<ProviderModelInfo[]> {
    return listModelInfo();
  }

  async healthCheck(): Promise<ProviderHealth> {
    return checkHealth();
  }

  /**
   * Single-shot completion. A single system+user pair goes through `generate()`;
   * anything with real multi-turn history is assembled from `streamChat()`'s
   * deltas so no HTTP logic is duplicated.
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
        think: request.thinking,
        numCtx: request.numCtx,
        maxTokens: request.maxTokens,
        timeoutMs: request.timeoutMs,
        keepAlive: request.keepAlive,
      });
      // Native `thinking` field first; fall back to inline <think> tags for
      // models/runtimes that still embed reasoning in the answer text.
      const inline = splitThinking(raw.content);
      return {
        content: inline.answer,
        reasoning: raw.thinking || inline.reasoning,
      };
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
      json: request.json,
      think: request.thinking,
      numCtx: request.numCtx,
      maxTokens: request.maxTokens,
      // Same class of bug as `json` above, and the reason a 45s task could run
      // for minutes: this branch handles every multi-turn request, so any
      // conversation with history escaped its own declared deadline.
      timeoutMs: request.timeoutMs,
      keepAlive: request.keepAlive,
      onThinking: (t) => (reasoning += t),
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
      // Was silently dropped once: a streamed JSON task generated UNCONSTRAINED
      // while its non-streamed twin ran under `format: "json"`, making the
      // streamed path materially slower and chattier for the same prompt.
      json: request.json,
      think: request.thinking,
      numCtx: request.numCtx,
      maxTokens: request.maxTokens,
      timeoutMs: request.timeoutMs,
      keepAlive: request.keepAlive,
      onThinking: onReasoning,
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
