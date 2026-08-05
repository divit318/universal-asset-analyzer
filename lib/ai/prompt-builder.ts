/**
 * Prompt Builder — reusable, versioned prompt templates.
 *
 * Separates system (identity/rules), developer (task-specific instructions
 * layered on top of the identity), and user (the actual request/data) so no
 * feature module concatenates ad hoc strings by hand. Chat wire protocols
 * typically have only system/user/assistant roles (no "developer" turn), so a developer
 * section is folded into the system turn, clearly delimited — templates
 * still author it separately, which is what keeps it reusable/testable
 * independent of a specific model's chat protocol.
 *
 * This is additive: the Research Copilot's existing lib/ai/prompt.ts already
 * has this separation hand-built for its own pipeline and is left alone.
 * New/refactored feature prompts should adopt this instead of inline
 * template-literal concatenation.
 */

import type { ProviderChatTurn } from "./provider";

export interface PromptTemplate<Vars> {
  /** Stable id, e.g. "watchlist-digest". Used in logs/metadata, not sent to the model. */
  id: string;
  /** Bump when the wording changes in a way that could shift model behavior. */
  version: number;
  system: string | ((vars: Vars) => string);
  developer?: string | ((vars: Vars) => string);
  buildUser: (vars: Vars) => string;
}

/** Identity helper — no-op at runtime, just gives template authors inference of `Vars`. */
export function definePrompt<Vars>(template: PromptTemplate<Vars>): PromptTemplate<Vars> {
  return template;
}

function resolve<Vars>(part: string | ((vars: Vars) => string) | undefined, vars: Vars): string | undefined {
  if (part === undefined) return undefined;
  return typeof part === "function" ? part(vars) : part;
}

/** Render a template into the chat turns a provider expects. */
export function renderPrompt<Vars>(template: PromptTemplate<Vars>, vars: Vars): ProviderChatTurn[] {
  const system = resolve(template.system, vars) ?? "";
  const developer = resolve(template.developer, vars);
  const combinedSystem = developer ? `${system}\n\n${developer}` : system;

  return [
    { role: "system", content: combinedSystem },
    { role: "user", content: template.buildUser(vars) },
  ];
}
