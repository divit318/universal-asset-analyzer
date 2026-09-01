"use client";

import { useEffect, useRef, useState } from "react";
import { RESEARCH_ACTIONS } from "@/lib/ai/actions";
import { BrandMark } from "@/app/_components/brand";
import { Message } from "./message";
import { useCopilot } from "./use-copilot";
import type { PortfolioContextForAI } from "@/lib/ai/types";
import type { AskAIPayload } from "../pattern-analysis-panel";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";

/** The six actions that lead the chip row — the questions that most often
 *  start a research session. The rest stay one "More" click away. */
const PRIMARY_ACTION_IDS = ["thesis", "bull", "bear", "valuation", "risk", "earnings"];

/**
 * The persistent AI Equity Research Copilot. It stays attached to the currently
 * selected stock, automatically knows the company context, and is the primary
 * interface for understanding, analyzing, and evaluating it — predefined
 * research actions, free-form multi-turn chat, streaming answers, grounded
 * citations, and suggested follow-ups. Replaces the old one-click "Analyze".
 */
export function ResearchCopilot({
  symbol, name, isEquity = true, isFund = false, isCrypto = false, isCommodity = false, isForex = false, isMacro = false, portfolioContext, pendingAsk, onPendingAskHandled,
}: {
  symbol: string;
  name: string;
  isEquity?: boolean;
  /** Fund (ETF/mutual/closed-end): its own starter questions, no equity action chips. */
  isFund?: boolean;
  /** Crypto: its own starter questions, no equity action chips. */
  isCrypto?: boolean;
  /** Commodity future: its own starter questions, no equity action chips. */
  isCommodity?: boolean;
  /** Currency pair: its own starter questions, no equity action chips. */
  isForex?: boolean;
  /** Treasury yield curve: its own starter questions, no equity action chips. */
  isMacro?: boolean;
  portfolioContext?: PortfolioContextForAI;
  /** A question queued externally (e.g. the chart's Ask AI / Technical Analysis quick actions). */
  pendingAsk?: AskAIPayload | null;
  onPendingAskHandled?: () => void;
}) {
  const {
    status, messages, error, models, model, setModel,
    reachable, coverage, warnings, suggestions, send, stop, reset,
  } = useCopilot(symbol);

  const [input, setInput] = useState("");
  const [showAllActions, setShowAllActions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = status === "streaming";

  // Keep the latest turn in view as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, suggestions]);

  // Auto-send a question queued by an external quick action. Waits for the
  // copilot to finish warming up (status !== "init") before firing, then
  // clears the queue via onPendingAskHandled so it never re-sends.
  useEffect(() => {
    if (!pendingAsk || status === "init") return;
    void send({ question: pendingAsk.question, action: pendingAsk.action, label: pendingAsk.label, portfolioContext });
    onPendingAskHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, status]);

  function submit() {
    const q = input.trim();
    if (!q || streaming) return;
    setInput("");
    void send({ question: q, portfolioContext });
  }

  const installed = models.filter((m) => m.installed);
  const showHero = messages.length === 0;

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Was a Unicode `◆` — a stand-in for the logo, in whatever symbol font
              the OS substituted. The Copilot is a UAA agent, so it signs with the
              real mark; ink inherits this row's colour automatically. */}
          <BrandMark size="xs" />
          <h2 className="text-sm font-semibold">AI Research Copilot</h2>
          <span className="hidden text-xs text-muted sm:inline">· {symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <HealthBadge reachable={reachable} status={status} />
          {/* Model/effort-tier selector is a dev affordance — provider and
              model names are implementation detail, not product surface. */}
          {process.env.NODE_ENV !== "production" && (
            <select
              value={model ?? ""}
              onChange={(e) => setModel(e.target.value || null)}
              disabled={installed.length === 0}
              className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground focus:outline-none disabled:opacity-50"
              title="Model effort tier"
            >
              {installed.length === 0 ? (
              <option value="">{reachable ? "No models available" : "AI off — add key in Settings"}</option>
            ) : null}
              {installed.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          )}
          {messages.length > 0 ? (
            <button onClick={reset} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground" title="New conversation">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* Predefined research actions — equity-specific (bull/bear case, filings,
          capital allocation, etc.); hidden for funds and other non-equity
          classes where none of these prompts apply. Six chips lead; the full
          set is one click away — sixteen simultaneous suggestions was a menu
          pretending to be a shortcut row. Every capability stays reachable. */}
      {isEquity ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          {(showAllActions
            ? RESEARCH_ACTIONS
            : PRIMARY_ACTION_IDS.map((id) => RESEARCH_ACTIONS.find((a) => a.id === id)).filter((a) => a != null)
          ).map((a) => (
            <button
              key={a.id}
              disabled={streaming || status === "init"}
              onClick={() => void send({ question: a.instruction, action: a.id, label: a.label, portfolioContext })}
              className="shrink-0 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowAllActions((v) => !v)}
            aria-expanded={showAllActions}
            className="shrink-0 rounded-full px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
          >
            {showAllActions ? "Less" : `More (${RESEARCH_ACTIONS.length - PRIMARY_ACTION_IDS.length}) ▾`}
          </button>
        </div>
      ) : null}

      {/* Conversation */}
      <div ref={scrollRef} className="flex max-h-[34rem] min-h-[18rem] flex-col gap-5 overflow-y-auto px-4 py-4">
        {showHero ? (
          <Hero name={name} symbol={symbol} coverage={coverage} warnings={warnings} reachable={reachable} isEquity={isEquity} isFund={isFund} isCrypto={isCrypto} isCommodity={isCommodity} isForex={isForex} isMacro={isMacro} onPick={(q) => void send({ question: q })} />
        ) : (
          messages.map((m, i) => (
            <Message key={i} message={m} streaming={streaming && i === messages.length - 1} symbol={symbol} />
          ))
        )}

        {error ? (
          <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
            {error}
            {!reachable ? (
              <p className="mt-1 text-xs text-muted">{AI_RECOVERY_HINT}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Suggested follow-ups */}
      {suggestions.length > 0 && !streaming ? (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => void send({ question: s })}
              className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            rows={1}
            placeholder={`Ask anything about ${symbol} — valuation, risks, bull case…`}
            className="max-h-32 flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          {streaming ? (
            <button onClick={stop} className="rounded-md bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-border">
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim() || status === "init"}
              className="rounded-md bg-accent-strong px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function HealthBadge({ reachable, status }: { reachable: boolean; status: string }) {
  if (status === "init") {
    return <span className="text-xs text-muted">Preparing…</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted" title={reachable ? "AI provider connected" : AI_RECOVERY_HINT}>
      <span className={`h-2 w-2 rounded-full ${reachable ? "bg-positive" : "bg-negative"}`} />
      {reachable ? "Ready" : "Offline"}
    </span>
  );
}

function Hero({
  name, symbol, coverage, warnings, reachable, isEquity, isFund, isCrypto, isCommodity, isForex, isMacro, onPick,
}: {
  name: string;
  symbol: string;
  coverage: ReturnType<typeof useCopilot>["coverage"];
  warnings: string[];
  reachable: boolean;
  isEquity: boolean;
  isFund: boolean;
  isCrypto: boolean;
  isCommodity: boolean;
  isForex: boolean;
  isMacro: boolean;
  onPick: (q: string) => void;
}) {
  const isIndiaListing = /\.(NS|BO)$/i.test(symbol);
  const starters = isEquity
    ? isIndiaListing
      ? [
          "Is this company undervalued?",
          "How are promoter and FII holdings trending?",
          "What happened in the latest quarterly results?",
          "How does it compare with peers on ROCE and valuation?",
        ]
      : [
        "Is this company undervalued?",
        "What is the bull case?",
        "What are the key risks?",
        "Would Buffett invest in this company?",
      ]
    : isFund
      ? [
          "What are the top holdings?",
          "Is this fund concentrated or diversified?",
          "How does the expense ratio compare to similar funds?",
          "How has it performed vs its category?",
        ]
      : isCrypto
        ? [
            "How is this performing vs BTC?",
            "What's the risk-adjusted return (Sharpe/Sortino)?",
            "How far is this from its recent high?",
            "Is the current drawdown a buying opportunity or a warning sign?",
          ]
        : isCommodity
          ? [
              "What does recent news suggest about supply and demand?",
              "How is this performing vs the broad commodity index?",
              "What's the risk-adjusted return?",
              "How far is this from its recent high?",
            ]
          : isForex
            ? [
                "What does recent news suggest about central banks or rates?",
                "How is this performing vs the US Dollar Index?",
                "What's the risk-adjusted return?",
                "How far is this from its recent high?",
              ]
            : isMacro
              ? [
                  "Is the yield curve inverted right now?",
                  "Is the curve steepening or flattening?",
                  "What does recent news suggest about inflation or Fed policy?",
                  "What does an inverted curve historically signal?",
                ]
              : [
                  "What does this asset track?",
                  "How does it compare to its benchmark?",
                  "What are the main risks of holding this?",
                  "Is now a good time to buy?",
                ];
  // Coverage badges reflect the equity CompanyContext's data sources
  // (fundamentals/statements/analyst/peers/filings) — showing them as
  // "missing" for a fund would misleadingly read as fetch failures rather
  // than "not applicable to this asset class", so only equities get them.
  const coverageItems = (coverage && isEquity
    ? ([
        ["Fundamentals", coverage.hasFundamentals],
        ["Statements", coverage.hasStatements],
        ["Analyst", coverage.hasAnalyst],
        ["Peers", coverage.hasPeers],
        [`Filings (${coverage.filings ?? 0})`, (coverage.filings ?? 0) > 0],
        [`News (${coverage.news ?? 0})`, (coverage.news ?? 0) > 0],
      ] as [string, boolean][])
    : []
  ).filter(([label]) => Boolean(label));

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
      <div>
        <p className="text-sm font-medium text-foreground">Researching {name}</p>
        <p className="mt-1 max-w-md text-xs text-muted">
          {isEquity
            ? isIndiaListing
              ? `I've assembled a dossier for ${symbol} from screener.in fundamentals, NSE announcements, shareholding data, and recent news. Ask anything, or run a research action above.`
              : `I've assembled a dossier for ${symbol} from fundamentals, filings, analyst data, the platform score, and recent news. Ask anything, or run a research action above.`
            : isFund
              ? `I've assembled fund data for ${symbol} — holdings, sector allocation, cost, and performance vs category. Ask anything about this fund.`
              : isCrypto
                ? `I've assembled price-based data for ${symbol} — momentum, relative strength vs BTC, and risk-adjusted return. Ask anything about this asset (tokenomics/on-chain data isn't available yet).`
                : isCommodity
                  ? `I've assembled price-based data and recent news for ${symbol} — momentum, relative strength vs the commodity index, risk-adjusted return, and supply/demand context. Ask anything about this asset.`
                  : isForex
                    ? `I've assembled price-based data and recent news for ${symbol} — momentum, relative strength vs the US Dollar Index, risk-adjusted return, and macro context. Ask anything about this pair.`
                    : isMacro
                      ? `I've assembled the full US Treasury yield curve and recent news — shape, trend, and macro context. Ask anything about rates or the curve.`
                      : `I've assembled market data and news for ${symbol}. Ask anything about this asset — price drivers, risks, holdings, or outlook.`}
        </p>
      </div>

      {coverageItems.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-1.5">
          {coverageItems.map(([label, ok]) => (
            <span key={label} className={`rounded-full border px-2 py-0.5 text-[0.7rem] ${ok ? "border-border text-muted" : "border-border/50 text-muted/50 line-through"}`}>
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {!reachable ? (
        <p className="text-xs text-negative">No AI provider is reachable. {AI_RECOVERY_HINT}</p>
      ) : (
        <div className="flex max-w-lg flex-wrap justify-center gap-2">
          {starters.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {warnings.length > 0 ? (
        <p className="max-w-md text-[0.7rem] text-muted/70">
          Some data was unavailable ({warnings.length} source{warnings.length > 1 ? "s" : ""}); I&apos;ll flag gaps in my analysis.
        </p>
      ) : null}
    </div>
  );
}
