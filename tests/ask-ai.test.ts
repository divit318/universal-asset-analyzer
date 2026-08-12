import { describe, expect, it } from "vitest";
import { askAiDestination, composeAskQuestion, copilotAskHref, type AskAiContext } from "@/app/_components/ask-ai";

describe("askAi routing — instrument questions go to the copilot, app questions to the panel", () => {
  it("routes symbol-scoped contexts to the copilot", () => {
    const contexts: AskAiContext[] = [
      { source: "notification", symbol: "TSLA", title: "TSLA crossed $300", body: "Now at $302." },
      { source: "screener", symbol: "MU", name: "Micron Technology" },
      { source: "position", symbol: "MSFT" },
      { source: "asset", symbol: "AAPL", question: "Is this expensive?" },
    ];
    for (const ctx of contexts) expect(askAiDestination(ctx)).toBe("copilot");
  });

  it("routes app-level asks to the assistant panel", () => {
    expect(askAiDestination({ source: "app", question: "How diversified am I?" })).toBe("assistant");
  });
});

describe("composeAskQuestion — the handoff carries the context, so the user never restates it", () => {
  it("notification: quotes the alert's own words", () => {
    const q = composeAskQuestion({
      source: "notification",
      symbol: "TSLA",
      title: "TSLA crossed your $300 target",
      body: "Tesla, Inc. is trading at $302.10, above your target of $300.",
    });
    expect(q).toContain("TSLA crossed your $300 target");
    expect(q).toContain("$302.10");
  });

  it("screener: carries the rank when known", () => {
    expect(composeAskQuestion({ source: "screener", symbol: "MU", rank: 3 })).toContain("#3");
  });

  it("asset/app: the question passes through verbatim", () => {
    expect(composeAskQuestion({ source: "asset", symbol: "AAPL", question: "Is this expensive?" })).toBe("Is this expensive?");
    expect(composeAskQuestion({ source: "app", question: "What do I own?" })).toBe("What do I own?");
  });
});

describe("copilotAskHref", () => {
  it("encodes symbol and question into the research deep link", () => {
    const href = copilotAskHref("BRK-B", "What should I know?");
    expect(href).toBe("/research?symbol=BRK-B&ask=What%20should%20I%20know%3F");
  });
});
