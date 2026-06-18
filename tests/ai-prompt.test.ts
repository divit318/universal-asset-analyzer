import { describe, expect, it } from "vitest";
import {
  buildMessages,
  buildSystemPrompt,
  compressHistory,
  renderDossier,
} from "@/lib/ai/prompt";
import { getAction } from "@/lib/ai/actions";
import type { ChatMessage, ContextBlock } from "@/lib/ai/types";

const blocks: ContextBlock[] = [
  { id: "valuation", source: "yahoo:valuation", heading: "Valuation metrics", body: "Forward P/E: 28", priority: 50 },
];

describe("buildSystemPrompt", () => {
  it("identifies the covered company and demands grounded citations", () => {
    const p = buildSystemPrompt({ symbol: "AAPL", name: "Apple Inc.", structured: false });
    expect(p).toContain("Apple Inc.");
    expect(p).toContain("AAPL");
    expect(p).toMatch(/cite/i);
    expect(p).toMatch(/NEVER invent/);
  });
  it("includes the report structure when structured", () => {
    expect(buildSystemPrompt({ symbol: "X", name: "X", structured: true })).toContain("Executive Summary");
  });
});

describe("renderDossier", () => {
  it("labels each block with its source tag", () => {
    const d = renderDossier(blocks, "2026-06-15T00:00:00Z");
    expect(d).toContain("[yahoo:valuation]");
    expect(d).toContain("Forward P/E: 28");
    expect(d).toContain("as of 2026-06-15");
  });
});

describe("compressHistory", () => {
  it("keeps recent turns verbatim and summarizes older ones", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: "user", content: `q${i}` });
      msgs.push({ role: "assistant", content: `a${i}` });
    }
    msgs.push({ role: "user", content: "current" }); // excluded (current turn)
    const turns = compressHistory(msgs, 4);
    // First turn should be the summary note.
    expect(turns[0].content).toMatch(/Earlier in this session/);
    // Current user turn is not included by compressHistory.
    expect(turns.some((t) => t.content === "current")).toBe(false);
  });
});

describe("buildMessages", () => {
  it("assembles system + dossier + action instruction", () => {
    const action = getAction("thesis");
    const turns = buildMessages({
      symbol: "AAPL",
      name: "Apple Inc.",
      blocks,
      asOf: "2026-06-15T00:00:00Z",
      history: [{ role: "user", content: "Investment Thesis" }],
      question: "Investment Thesis",
      action,
    });
    expect(turns[0].role).toBe("system");
    expect(turns[0].content).toContain("Executive Summary"); // structured action
    expect(turns[1].content).toContain("COMPANY DOSSIER");
    expect(turns.at(-1)?.content).toBe(action?.instruction);
  });
});
