/**
 * Prompt-cache placement (lib/ai/providers/anthropic-provider.ts:
 * buildCachedPrompt) — breakpoints must land on the stable prefix and NEVER
 * change a prompt byte. Placement is pure, so this suite needs no backend;
 * whether the cache actually hits on the wire is verified live by
 * scripts/ai-bench.ts against telemetry's cache_read counters.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildCachedPrompt } from "@/lib/ai/providers/anthropic-provider";
import type { ProviderChatTurn } from "@/lib/ai/provider";

afterEach(() => {
  delete process.env.AI_PROMPT_CACHE;
});

const SYSTEM: ProviderChatTurn = { role: "system", content: "You are an analyst." };
const DOSSIER: ProviderChatTurn = { role: "user", content: "COMPANY DOSSIER: facts." };
const ACK: ProviderChatTurn = { role: "assistant", content: "Understood." };
const QUESTION: ProviderChatTurn = { role: "user", content: "What changed?" };

function textOf(content: string | Array<{ type: "text"; text: string }>): string {
  return typeof content === "string" ? content : content.map((b) => b.text).join("");
}

describe("buildCachedPrompt", () => {
  it("marks the system block and nothing else on a one-shot call", () => {
    const { system, turns } = buildCachedPrompt([SYSTEM, QUESTION]);
    expect(system).toEqual([{ type: "text", text: "You are an analyst.", cache_control: { type: "ephemeral" } }]);
    // One-shot: the user prompt never recurs, so no turn breakpoint (a cache
    // write with no reader is a pure +25% on the written tokens).
    expect(turns).toEqual([{ role: "user", content: "What changed?" }]);
  });

  it("marks the last assistant turn in a multi-turn conversation (the Copilot layout)", () => {
    const { turns } = buildCachedPrompt([SYSTEM, DOSSIER, ACK, QUESTION]);
    expect(turns[0]).toEqual({ role: "user", content: "COMPANY DOSSIER: facts." });
    expect(turns[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Understood.", cache_control: { type: "ephemeral" } }],
    });
    expect(turns[2]).toEqual({ role: "user", content: "What changed?" });
  });

  it("moves the breakpoint forward as the conversation grows", () => {
    const history: ProviderChatTurn[] = [
      SYSTEM, DOSSIER, ACK,
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      QUESTION,
    ];
    const { turns } = buildCachedPrompt(history);
    // The LAST assistant turn carries the marker — not the ack.
    expect(turns[1]).toEqual({ role: "assistant", content: "Understood." });
    expect(turns[3]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "A1", cache_control: { type: "ephemeral" } }],
    });
  });

  it("never changes a prompt byte — text round-trips exactly", () => {
    const messages: ProviderChatTurn[] = [SYSTEM, DOSSIER, ACK, QUESTION];
    const { system, turns } = buildCachedPrompt(messages);
    expect(system?.map((b) => b.text).join("\n\n")).toBe(SYSTEM.content);
    expect(turns.map((t) => textOf(t.content))).toEqual([DOSSIER.content, ACK.content, QUESTION.content]);
  });

  it("keeps the synthetic leading user turn when the array starts with an assistant turn", () => {
    const { turns } = buildCachedPrompt([SYSTEM, { role: "assistant", content: "hello" }]);
    expect(turns[0]).toEqual({ role: "user", content: "Proceed." });
  });

  it("AI_PROMPT_CACHE=off strips every marker but leaves content identical", () => {
    process.env.AI_PROMPT_CACHE = "off";
    const { system, turns } = buildCachedPrompt([SYSTEM, DOSSIER, ACK, QUESTION]);
    expect(system).toEqual([{ type: "text", text: "You are an analyst." }]);
    expect(turns.every((t) => typeof t.content === "string")).toBe(true);
  });
});
