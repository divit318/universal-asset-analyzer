/**
 * Prompt Construction Layer — assembles the system + message turns sent to the
 * model from selected evidence blocks and conversation history.
 *
 * The system prompt encodes the copilot's identity (a buy-side analyst working
 * for this user), hard grounding/citation rules, and the professional report
 * structure. Everything here is pure string assembly so it's fully testable.
 */

import type { ProviderChatTurn as ChatTurn } from "./provider";
import type { ChatMessage, ContextBlock } from "./types";
import type { ResearchAction } from "./actions";

/** The institutional report skeleton used for structured actions/questions. */
const REPORT_STRUCTURE = [
  "1. Executive Summary",
  "2. Key Findings",
  "3. Bull Case",
  "4. Bear Case",
  "5. Risks",
  "6. Catalysts",
  "7. Valuation Implications",
  "8. Conclusion",
  "9. Confidence Level (low / medium / high, with a one-line reason)",
].join("\n");

/** Build the system prompt. Pure. */
export function buildSystemPrompt(opts: {
  symbol: string;
  name: string;
  structured: boolean;
  portfolioAware?: boolean;
}): string {
  const lines = [
    `You are an institutional-grade AI Equity Research Copilot — a buy-side equity research analyst working exclusively for this user. You are currently covering ${opts.name} (${opts.symbol}).`,
    "",
    "OPERATING RULES:",
    "- Ground every factual claim in the COMPANY DOSSIER provided below. The dossier is your evidence base.",
    "- When you use a fact from the dossier, cite its source tag inline in square brackets, e.g. [yahoo:valuation], [edgar:statements], [platform:score], [news], [portfolio:context].",
    "- If the data needed to answer is not in the dossier, say so explicitly. NEVER invent numbers, prices, dates, or events.",
    "- Distinguish data-grounded claims (cite them) from your own analytical reasoning and general market knowledge (do not fabricate a citation for these).",
    "- Be decisive and specific like a professional analyst: take a view, quantify it, and state the assumptions behind it. Avoid generic hedging and disclaimers.",
    "- Prefer tight prose and bullet points over long paragraphs. Use markdown headings.",
    "- This is research analysis for the user's own decision-making, not personalized financial advice.",
  ];

  if (opts.portfolioAware) {
    lines.push(
      "",
      "PORTFOLIO CONTEXT INSTRUCTIONS: The dossier includes a USER PORTFOLIO CONTEXT section. You MUST integrate this into every response — frame analysis around how this stock fits the user's specific portfolio. Reference their sector gaps [portfolio:context], whether this fills a missing exposure, and recommend position sizing consistent with their suggested allocation. Never give generic advice when portfolio context is available.",
    );
  }

  lines.push(
    "",
    opts.structured
      ? `STRUCTURE your answer using these sections:\n${REPORT_STRUCTURE}`
      : [
          "STRUCTURE: Lead with the direct answer, then supporting evidence and the key risk or caveat. End with a one-line confidence level (low/medium/high) when making a judgment call.",
          // Depth-matching: casual questions were coming back as ~4,000-char
          // institutional reports with tables (40+s of generation). Depth is
          // the user's choice, not a default.
          "MATCH DEPTH TO THE QUESTION: a simple or factual question gets a few sentences; an analytical question gets focused paragraphs or bullets; only an explicit deep-dive request (a thesis, a full analysis, 'go deep') gets a long, sectioned answer with tables. When in doubt, answer concisely and offer to go deeper.",
        ].join("\n"),
  );

  return lines.join("\n");
}

/** Render selected blocks into the dossier text injected with the question. Pure. */
export function renderDossier(blocks: ContextBlock[], asOf: string): string {
  const body = blocks
    .map((b) => `### ${b.heading}  [${b.source}]\n${b.body}`)
    .join("\n\n");
  return `COMPANY DOSSIER (as of ${asOf.slice(0, 10)}):\n\n${body}`;
}

/** History answers older than the latest one are context, not content the
 * model should re-render — clipping them keeps a 6-turn session from carrying
 * ~20k chars of its own old tables into every new prompt (measured: per-turn
 * latency climbed 33s → 51s → 67s across one session largely on this). */
const OLDER_ANSWER_CLIP = 700;

/**
 * Compress conversation history to fit a turn budget: keep the most recent
 * `keep` turns, clip all but the latest assistant answer, and collapse
 * anything older into a short note so long sessions stay within the context
 * window. Pure / testable.
 *
 * The current user turn is dropped only when it is actually present —
 * session-loaded history ends with the PREVIOUS ASSISTANT ANSWER, and
 * unconditionally slicing it off left the model staring at an unanswered
 * prior question, which it then dutifully re-answered ahead of the real one
 * (the audit's duplicated-answer bug, which also nearly doubled generation
 * time on those turns).
 */
export function compressHistory(messages: ChatMessage[], keep = 6): ChatTurn[] {
  const endsWithCurrentQuestion = messages[messages.length - 1]?.role === "user";
  const prior = endsWithCurrentQuestion ? messages.slice(0, -1) : messages;
  const recent = prior.slice(-keep);
  const older = prior.slice(0, -keep);

  const turns: ChatTurn[] = [];
  if (older.length) {
    const topics = older
      .filter((m) => m.role === "user")
      .map((m) => m.content.replace(/\s+/g, " ").slice(0, 80))
      .slice(-5);
    turns.push({
      role: "assistant",
      content: `(Earlier in this session we discussed: ${topics.join("; ")}.)`,
    });
  }
  const lastAssistantIdx = recent.map((m) => m.role).lastIndexOf("assistant");
  recent.forEach((m, i) => {
    const clip = m.role === "assistant" && i !== lastAssistantIdx && m.content.length > OLDER_ANSWER_CLIP;
    turns.push({
      role: m.role,
      content: clip ? `${m.content.slice(0, OLDER_ANSWER_CLIP)}… (rest of this earlier answer omitted)` : m.content,
    });
  });
  return turns;
}

/**
 * Assemble the full message array for an inference call: system prompt, the
 * grounding dossier (as a leading user turn), compressed history, and the
 * current question (the action instruction when one is active). Pure.
 */
export function buildMessages(opts: {
  symbol: string;
  name: string;
  blocks: ContextBlock[];
  asOf: string;
  history: ChatMessage[];
  question: string;
  action: ResearchAction | null;
  portfolioAware?: boolean;
}): ChatTurn[] {
  const structured = opts.action?.structured ?? false;
  const messages: ChatTurn[] = [
    { role: "system", content: buildSystemPrompt({ symbol: opts.symbol, name: opts.name, structured, portfolioAware: opts.portfolioAware }) },
    { role: "user", content: renderDossier(opts.blocks, opts.asOf) },
    { role: "assistant", content: `Understood. I have the dossier for ${opts.name} (${opts.symbol}) and will ground my analysis in it, citing sources and flagging any gaps.` },
    ...compressHistory(opts.history),
    { role: "user", content: opts.action ? opts.action.instruction : opts.question },
  ];
  return messages;
}
