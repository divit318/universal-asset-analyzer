import { describe, expect, it } from "vitest";
import { createThinkingSplitter, splitThinking } from "@/lib/ai/ollama";

describe("splitThinking", () => {
  it("separates a complete think block from the answer", () => {
    const { reasoning, answer } = splitThinking("<think>weigh PE vs growth</think>It looks fair.");
    expect(reasoning).toBe("weigh PE vs growth");
    expect(answer).toBe("It looks fair.");
  });
  it("passes through text with no think block", () => {
    expect(splitThinking("Just an answer.")).toEqual({ reasoning: "", answer: "Just an answer." });
  });
  it("treats an unterminated block as all reasoning", () => {
    const { reasoning, answer } = splitThinking("<think>still thinking");
    expect(reasoning).toBe("still thinking");
    expect(answer).toBe("");
  });
});

describe("createThinkingSplitter", () => {
  it("routes reasoning vs answer across chunk boundaries", () => {
    let reasoning = "";
    let answer = "";
    const s = createThinkingSplitter({
      onReasoning: (t) => (reasoning += t),
      onAnswer: (t) => (answer += t),
    });
    // Feed a <think> tag split across chunks.
    s.push("<thi");
    s.push("nk>analyze ");
    s.push("margins</thi");
    s.push("nk>The answer.");
    s.end();
    expect(reasoning).toBe("analyze margins");
    expect(answer).toBe("The answer.");
  });

  it("treats plain streamed text as answer", () => {
    let answer = "";
    const s = createThinkingSplitter({ onReasoning: () => {}, onAnswer: (t) => (answer += t) });
    s.push("Hello ");
    s.push("world");
    s.end();
    expect(answer).toBe("Hello world");
  });
});
