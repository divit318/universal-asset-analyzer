import { describe, expect, it } from "vitest";
import { matchFastPath } from "@/lib/assistant-fastpath";

describe("matchFastPath — deterministic navigation", () => {
  it.each([
    ["Open my portfolio", "portfolio"],
    ["open portfolio", "portfolio"],
    ["Where's my portfolio?", "portfolio"],
    ["go to watchlist", "watchlist"],
    ["Take me to the watchlist", "watchlist"],
    ["open the screener", "screener"],
    ["Show me the calendar", "calendar"],
    ["open the wire", "wire"],
    ["go to the decision journal", "journal"],
    ["watchlist", "watchlist"],
  ] as const)("%s → navigate:%s", (q, dest) => {
    expect(matchFastPath(q)).toEqual({ kind: "navigate", destination: dest });
  });

  it("answers holdings questions locally", () => {
    expect(matchFastPath("What do I own?")).toEqual({ kind: "holdings" });
    expect(matchFastPath("what are my holdings")).toEqual({ kind: "holdings" });
  });

  it("matches portfolio-metric questions to the deterministic report", () => {
    expect(matchFastPath("What are my biggest positions?")).toEqual({ kind: "portfolio-metric", metric: "top-positions" });
    expect(matchFastPath("How is my portfolio doing?")).toEqual({ kind: "portfolio-metric", metric: "performance" });
    expect(matchFastPath("What's my total P&L?")).toEqual({ kind: "portfolio-metric", metric: "performance" });
    expect(matchFastPath("How diversified am I?")).toEqual({ kind: "portfolio-metric", metric: "sector-exposure" });
    expect(matchFastPath("What am I most exposed to?")).toEqual({ kind: "portfolio-metric", metric: "sector-exposure" });
  });

  it("parameterized portfolio questions still go to the model", () => {
    expect(matchFastPath("How much of my portfolio is in technology?")).toBeNull();
    expect(matchFastPath("Which positions are dragging my portfolio?")).toBeNull();
    expect(matchFastPath("Do I already own Tesla?")).toBeNull();
  });
});

describe("matchFastPath — everything uncertain goes to the model", () => {
  it.each([
    "open the screener with dividend stocks under 15 P/E",
    "add Tesla to my watchlist",
    "show me research on Nvidia",
    "what's my portfolio's P&L today?",
    "should I open a position in Apple?",
    "compare my portfolio to the S&P 500",
    "open my portfolio and tell me what to sell",
    "what does P/E mean?",
    "remove Tesla from my watchlist",
    "",
  ])("%s → null", (q) => {
    expect(matchFastPath(q)).toBeNull();
  });
});
