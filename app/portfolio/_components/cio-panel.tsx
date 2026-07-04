"use client";

import Link from "next/link";
import { useState, useRef, useCallback } from "react";
import type { PortfolioReport } from "@/lib/portfolio-analytics";

type AuditState = "idle" | "streaming" | "done" | "error";

function SectionBlock({ text }: { text: string }) {
  // Split markdown-ish sections separated by blank lines
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-3" />;
        if (/^#{1,3}\s/.test(line) || /^[A-Z\s&]+:/.test(line)) {
          return (
            <p key={i} className="text-[11px] font-bold uppercase tracking-widest text-muted mt-3 mb-0.5">
              {line.replace(/^#{1,3}\s/, "").replace(/:$/, "")}
            </p>
          );
        }
        if (/^[-•·]\s/.test(line)) {
          return (
            <div key={i} className="flex gap-2 text-sm leading-6">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent/60 shrink-0" />
              <span className="text-foreground/85">{line.replace(/^[-•·]\s/, "")}</span>
            </div>
          );
        }
        return <p key={i} className="text-sm leading-6 text-foreground/85">{line}</p>;
      })}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="inline-block h-4 w-0.5 bg-accent/80 ml-0.5 animate-pulse" />
  );
}

export function CIOPanel({ report }: { report: PortfolioReport }) {
  const [state, setState] = useState<AuditState>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runAudit = useCallback(async () => {
    if (state === "streaming") {
      abortRef.current?.abort();
      setState("idle");
      return;
    }

    setText("");
    setError(null);
    setState("streaming");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Build a compact analytics summary to send
    const summary = {
      totalValue: report.totalValue,
      totalReturn: report.totalReturn,
      positionCount: report.positionCount,
      health: { total: report.health.total, grade: report.health.grade, summary: report.health.summary },
      alerts: report.alerts.slice(0, 6),
      topRecommendations: report.recommendations.slice(0, 5).map((r) => ({
        symbol: r.symbol,
        action: r.action,
        composite: r.composite,
        reasoning: r.reasoning,
      })),
      gaps: { missing: report.gaps.missing.slice(0, 5), concentrationScore: report.gaps.concentrationScore },
      risk: {
        beta: report.risk.beta,
        sharpeRatio: report.risk.sharpeRatio,
        maxDrawdown: report.risk.maxDrawdown,
        hhi: report.risk.hhi,
        concentrationRisk: report.risk.concentrationRisk,
      },
      factors: { topFactor: report.factors.topFactor, bottomFactor: report.factors.bottomFactor },
      sectorAllocation: report.sectorAllocation.slice(0, 8),
      benchmark: report.benchmark,
      worstScenario: report.scenarios.reduce(
        (min, s) => (s.portfolioImpact < (min?.portfolioImpact ?? 0) ? s : min),
        report.scenarios[0] ?? null
      ),
    };

    try {
      const res = await fetch("/api/portfolio/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analytics: summary }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setText((prev) => prev + chunk);
      }

      setState("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setState("idle");
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to generate analysis");
      setState("error");
    }
  }, [state, report]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">AI Chief Investment Officer</h2>
          <p className="text-xs text-muted mt-0.5">
            Local AI reviews your portfolio analytics and writes an institutional memo.
            All computations are deterministic — the AI only adds narrative.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/intelligence?view=timeline&scope=portfolio&id=portfolio"
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Timeline
          </Link>
          <Link
            href="/intelligence?view=graph&scope=portfolio&id=portfolio"
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Graph
          </Link>
          <button
            onClick={() => void runAudit()}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${
              state === "streaming"
                ? "bg-negative/15 border border-negative/30 text-negative hover:opacity-80"
                : "bg-accent-strong text-background hover:opacity-90 disabled:opacity-50"
            }`}
          >
            {state === "streaming" ? "Stop" : state === "done" ? "Re-run Audit" : "Run Portfolio Audit"}
          </button>
        </div>
      </div>

      {/* Idle state */}
      {state === "idle" && !text && (
        <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded-full border border-border bg-surface-2 flex items-center justify-center text-2xl">
            ◈
          </div>
          <p className="text-sm font-semibold mb-1">Portfolio Audit Ready</p>
          <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
            Click &ldquo;Run Portfolio Audit&rdquo; to generate an institutional CIO memo analyzing your
            portfolio&apos;s strengths, weaknesses, hidden risks, and prioritized action plan.
          </p>
          <p className="mt-3 text-[11px] text-muted">
            Powered by local Ollama — analysis stays on your machine.
          </p>
        </div>
      )}

      {/* Error */}
      {state === "error" && error && (
        <div className="rounded-xl border border-negative/25 bg-negative/5 px-5 py-4">
          <p className="text-sm font-semibold text-negative mb-1">Audit Failed</p>
          <p className="text-xs text-muted">{error}</p>
          <p className="text-xs text-muted mt-1">
            Make sure Ollama is running: <code className="font-mono">ollama serve</code>
          </p>
        </div>
      )}

      {/* Streaming / done output */}
      {(state === "streaming" || state === "done" || (state === "idle" && text)) && (
        <div className="rounded-xl border border-border bg-surface p-5">
          {/* Streaming indicator */}
          {state === "streaming" && (
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
              <span className="h-2 w-2 rounded-full bg-positive animate-pulse" />
              <span className="text-xs text-muted font-medium">Generating analysis…</span>
            </div>
          )}

          {state === "done" && (
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
              <span className="h-2 w-2 rounded-full bg-positive" />
              <span className="text-xs text-muted font-medium">Analysis complete</span>
            </div>
          )}

          <div className="prose-sm max-w-none">
            <SectionBlock text={text} />
            {state === "streaming" && <StreamingCursor />}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-muted/60 leading-relaxed">
        This analysis is generated by a local language model based on deterministic portfolio analytics.
        It is not financial advice. All figures are computed from market data and quantitative models,
        not predicted by the AI.
      </p>
    </div>
  );
}
