"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelOption } from "@/lib/ai/models";
import type {
  ChatMessage,
  ChatStreamEvent,
  Citation,
  PortfolioContextForAI,
} from "@/lib/ai/types";

export interface CopilotCoverage {
  hasProfile: boolean;
  hasFundamentals: boolean;
  hasStatements: boolean;
  hasAnalyst: boolean;
  hasPeers: boolean;
  filings: number;
  news: number;
}

interface ContextResponse {
  symbol: string;
  name: string;
  builtAt: string;
  onWatchlist: boolean;
  warnings: string[];
  coverage: CopilotCoverage;
  health: {
    reachable: boolean;
    defaultModel: string | null;
    models: ModelOption[];
  };
}

export type CopilotStatus = "init" | "ready" | "streaming" | "error";

/**
 * Drives the Research Copilot: warms the company context, tracks AI health
 * and the model picker, and runs streaming chat turns by parsing the NDJSON
 * event stream from /api/research/chat. One instance is bound to one symbol;
 * changing the symbol resets the conversation and starts a fresh session.
 */
export function useCopilot(symbol: string) {
  const [status, setStatus] = useState<CopilotStatus>("init");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [reachable, setReachable] = useState(true);
  const [coverage, setCoverage] = useState<CopilotCoverage | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const sessionId = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // (Re)initialize whenever the symbol changes.
  useEffect(() => {
    if (!symbol) return;
    let active = true;
    abortRef.current?.abort();
    sessionId.current =
      (globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random()}`);

    /* eslint-disable react-hooks/set-state-in-effect */
    setStatus("init");
    setMessages([]);
    setError(null);
    setSuggestions([]);
    /* eslint-enable react-hooks/set-state-in-effect */

    (async () => {
      try {
        const res = await fetch(`/api/research/context?symbol=${encodeURIComponent(symbol)}`);
        const json = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(json.error ?? "Failed to prepare copilot");
        const data = json as ContextResponse;
        setModels(data.health.models);
        setModel(data.health.defaultModel);
        setReachable(data.health.reachable);
        setCoverage(data.coverage);
        setWarnings(data.warnings);
        setStatus("ready");
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to prepare copilot");
          setStatus("error");
        }
      }
    })();

    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [symbol]);

  const send = useCallback(
    async (input: { question: string; action?: string; label?: string; portfolioContext?: PortfolioContextForAI }) => {
      const display = (input.label ?? input.question).trim();
      if (!display) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const userMsg: ChatMessage = { role: "user", content: display };
      // History sent to the server = everything so far + this user turn.
      const priorForServer = [...messages, userMsg];

      setError(null);
      setSuggestions([]);
      setStatus("streaming");
      setMessages((m) => [...m, userMsg, { role: "assistant", content: "", reasoning: "" }]);

      const patchAssistant = (fn: (a: ChatMessage) => ChatMessage) =>
        setMessages((m) => {
          const next = [...m];
          const i = next.length - 1;
          if (i >= 0 && next[i].role === "assistant") next[i] = fn(next[i]);
          return next;
        });

      try {
        const res = await fetch("/api/research/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            messages: priorForServer,
            action: input.action,
            model: model ?? undefined,
            sessionId: sessionId.current,
            portfolioContext: input.portfolioContext,
          }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamErr: string | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!raw) continue;
            let ev: ChatStreamEvent;
            try {
              ev = JSON.parse(raw) as ChatStreamEvent;
            } catch {
              continue;
            }
            if (ev.type === "delta") {
              patchAssistant((a) => ({ ...a, content: a.content + ev.text }));
            } else if (ev.type === "reasoning") {
              patchAssistant((a) => ({ ...a, reasoning: (a.reasoning ?? "") + ev.text }));
            } else if (ev.type === "meta") {
              const citations: Citation[] = ev.citations;
              patchAssistant((a) => ({ ...a, citations, grounding: ev.grounding }));
              setSuggestions(ev.suggestions);
            } else if (ev.type === "error") {
              streamErr = ev.message;
              if (ev.code === "ai_unavailable") setReachable(false);
            }
          }
        }

        if (streamErr) {
          setError(streamErr);
          setStatus("error");
        } else {
          setStatus("ready");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong");
        setStatus("error");
      }
    },
    [messages, model, symbol],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("ready");
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionId.current =
      (globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random()}`);
    setMessages([]);
    setSuggestions([]);
    setError(null);
    setStatus("ready");
  }, []);

  return {
    status,
    messages,
    error,
    models,
    model,
    setModel,
    reachable,
    coverage,
    warnings,
    suggestions,
    send,
    stop,
    reset,
  };
}
