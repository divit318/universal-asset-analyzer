"use client";

import { useState } from "react";
import type { Quote } from "@/lib/types";
import type { ScreenerInCompany, ScreenerInPeer } from "@/lib/screener-in";

interface DeepAnalysisResult {
  model: string;
  sections: {
    summary: string;
    investmentCase: string;
    competitivePosition: string;
    risks: string;
    keyMetrics: string;
    verdict: string;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
}

interface DerivedData {
  promoterHolding: number | null;
  fiiHolding: number | null;
  diiHolding: number | null;
  evToEbitda: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  peers: ScreenerInPeer[];
}

const SECTIONS: { key: keyof DeepAnalysisResult["sections"]; label: string }[] = [
  { key: "summary", label: "Executive Summary" },
  { key: "investmentCase", label: "Why Own / Avoid" },
  { key: "competitivePosition", label: "vs Sector Peers" },
  { key: "risks", label: "Top Risks" },
  { key: "keyMetrics", label: "Watch These Numbers" },
  { key: "verdict", label: "Buy / Hold / Sell" },
];

const STARTER_QUESTIONS = [
  "Is the valuation attractive vs peers?",
  "What does the promoter holding trend say?",
  "How has ROCE trended and what does it mean?",
  "What are the biggest risks for this Indian stock?",
  "Is FII activity increasing or decreasing?",
];

export function AiIndiaPanel({
  company,
  quote,
  derived,
}: {
  company: ScreenerInCompany;
  quote: Quote | null;
  derived: DerivedData;
}) {
  const [mode, setMode] = useState<"idle" | "analysis" | "chat">("idle");
  const [analysis, setAnalysis] = useState<DeepAnalysisResult | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    setMode("idle");
    try {
      const res = await fetch("/api/ai/india", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "analysis", company, quote, derived }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      setAnalysis(json as DeepAnalysisResult);
      setMode("analysis");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function sendChat(q: string) {
    if (!q.trim()) return;
    const userMsg: ChatMessage = { role: "user", content: q };
    setChatHistory((h) => [...h, userMsg]);
    setQuestion("");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/india", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          company,
          quote,
          derived,
          history: chatHistory.map((m) => ({ role: m.role, content: m.content })),
          question: q,
        }),
      });
      const json = await res.json() as { answer: string; model: string };
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Chat failed");
      setChatHistory((h) => [...h, { role: "assistant", content: json.answer, model: json.model }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
      setChatHistory((h) => h.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">AI Research</h2>
          <p className="text-xs text-muted">
            Grounded in screener.in data — valuation, profitability, shareholding, peer comparison
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setMode("chat"); setChatHistory([]); }}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${mode === "chat" ? "border-accent text-accent" : "border-border hover:bg-surface-2"}`}
          >
            Ask a Question
          </button>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="rounded-lg bg-accent-strong px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading && mode !== "chat" ? "Analyzing…" : "Generate Research Note"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      {mode === "analysis" && analysis ? (
        <div className="flex flex-col gap-4">
          {SECTIONS.map(({ key, label }) =>
            analysis.sections[key] ? (
              <div key={key} className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
                <p className="text-sm leading-6">{analysis.sections[key]}</p>
              </div>
            ) : null,
          )}
          <p className="font-mono text-xs text-muted">model: {analysis.model}</p>
          <button
            onClick={() => setMode("chat")}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
          >
            Ask follow-up questions →
          </button>
        </div>
      ) : null}

      {mode === "chat" ? (
        <div className="flex flex-col gap-3">
          {chatHistory.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => void sendChat(q)}
                  disabled={loading}
                  className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}

          {chatHistory.length > 0 ? (
            <div className="flex max-h-96 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface-2 p-3">
              {chatHistory.map((m, i) => (
                <div key={i} className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-5 ${
                      m.role === "user" ? "bg-accent-strong text-background" : "bg-surface text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === "assistant" && m.model ? (
                    <span className="font-mono text-[10px] text-muted">{m.model}</span>
                  ) : null}
                </div>
              ))}
              {loading ? (
                <div className="flex items-start">
                  <div className="rounded-lg bg-surface px-3 py-2 text-sm text-muted">
                    <span className="animate-pulse">Thinking…</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <form
            onSubmit={(e) => { e.preventDefault(); void sendChat(question); }}
            className="flex gap-2"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Ask anything about ${company.symbol}…`}
              disabled={loading}
              className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      ) : null}

      {mode === "idle" && !loading ? (
        <p className="text-sm text-muted">
          Deep analysis synthesises screener.in valuation metrics, profitability ratios,
          shareholding patterns, and peer comparison into a structured research note.
          Use Ask AI for specific questions about {company.symbol}.
        </p>
      ) : null}

      {mode === "idle" && loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          Analyzing {company.symbol} with all available data…
        </div>
      ) : null}
    </section>
  );
}
