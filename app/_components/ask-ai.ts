/**
 * "Ask AI about this" — the ONE contract every UAA surface uses to hand a
 * user's moment of curiosity to the right AI surface with its context intact.
 *
 * UAA has two AI surfaces with deliberately different scopes, so the core of
 * this module is a ROUTING decision, not a button:
 *
 *   - **Research Copilot** (symbol-grounded, dossier-cited, streaming): the
 *     destination for any question ABOUT AN INSTRUMENT — "why is TSLA
 *     moving", "is this expensive", "what does this alert mean for my
 *     thesis". Reached by navigating to /research?symbol=X&ask=… ; the
 *     research page consumes `ask` once and auto-sends it to the copilot.
 *   - **App Assistant** (app-, portfolio- and navigation-aware panel): the
 *     destination for questions about the user's portfolio, the app, or
 *     anything not tied to one instrument. Reached by dispatching
 *     OPEN_ASSISTANT_EVENT with the question; the panel auto-asks it.
 *
 * Surfaces do not compose prompts or pick destinations themselves — they
 * describe the moment (`AskAiContext`) and this module writes the question
 * the user would have typed. That keeps handoff copy consistent, keeps
 * context contracts in one reviewable place, and means a future surface
 * (a new alert type, a new analytics view) integrates in one call:
 *
 *   askAi(router, { source: "notification", symbol, name, title, body })
 */

import type { useRouter } from "next/navigation";

import { OPEN_ASSISTANT_EVENT } from "./ai-assistant";

type Router = ReturnType<typeof useRouter>;

export type AskAiContext =
  | {
      /** An alert/notification the user is looking at. */
      source: "notification";
      symbol: string;
      title: string;
      body: string;
    }
  | {
      /** A screener result row the user finds interesting. */
      source: "screener";
      symbol: string;
      name?: string;
      /** 1-based rank in the current screen, when known. */
      rank?: number;
    }
  | {
      /** A held position (read-only analysis, never mutation). */
      source: "position";
      symbol: string;
      name?: string;
    }
  | {
      /** Any instrument-scoped ask with a preformed question. */
      source: "asset";
      symbol: string;
      question: string;
    }
  | {
      /** App/portfolio-level ask — goes to the assistant panel. */
      source: "app";
      question: string;
    };

/** The question each context implies — what the user would have typed. Pure. */
export function composeAskQuestion(ctx: AskAiContext): string {
  switch (ctx.source) {
    case "notification":
      return `My alert "${ctx.title}" just fired: ${ctx.body} What should I know, and does it change anything?`;
    case "screener":
      return `This came up ${ctx.rank ? `at #${ctx.rank} ` : ""}in my screen — give me a quick read: what's the setup, and is it worth researching further?`;
    case "position":
      return `I hold this position. How is it doing, and is there anything in the recent data I should pay attention to?`;
    case "asset":
      return ctx.question;
    case "app":
      return ctx.question;
  }
}

/** Where each context belongs. Pure — see the module header for the rule. */
export function askAiDestination(ctx: AskAiContext): "copilot" | "assistant" {
  return ctx.source === "app" ? "assistant" : "copilot";
}

/** Build the copilot handoff URL (consumed once by app/research/page.tsx). */
export function copilotAskHref(symbol: string, question: string): string {
  return `/research?symbol=${encodeURIComponent(symbol)}&ask=${encodeURIComponent(question)}`;
}

/**
 * Hand the moment to the right AI surface. Client-side only.
 */
export function askAi(router: Router, ctx: AskAiContext): void {
  const question = composeAskQuestion(ctx);
  if (askAiDestination(ctx) === "assistant") {
    window.dispatchEvent(new CustomEvent(OPEN_ASSISTANT_EVENT, { detail: { question } }));
    return;
  }
  router.push(copilotAskHref((ctx as { symbol: string }).symbol, question));
}
