/**
 * The only AI in this feature, and the smallest job it could usefully do:
 * putting a human name on a cluster the engine already found.
 *
 * A co-movement driver's deterministic label is its membership — "AMD · AVGO ·
 * NVDA". That is honest and it is unreadable, and the reader still has to work
 * out what the group *is*. Naming it "Semiconductor cycle" is a language task,
 * which is what models are for.
 *
 * The boundaries are absolute and enforced in code below, not by prompt wording:
 *
 *   - The model receives symbols and industries. It never sees a weight, a
 *     correlation, or a portfolio percentage, so it cannot influence a number.
 *   - It cannot add, remove, merge or split a cluster. Membership arrives
 *     settled and leaves unchanged; only `label` is read from the response.
 *   - A label that fails to parse, comes back empty, or exceeds the length
 *     bound is discarded and the deterministic label stands.
 *   - Every renamed driver carries `labelFromAi: true`, and the UI marks it.
 *
 * If AI is unavailable this module returns the input unchanged, which is the
 * page's normal, fully-functional state.
 */

import { runPrompt } from "../ai";
import { extractJsonObject } from "../json-extract";
import { JSON_SCHEMA_LEAD_IN } from "./../ai/prompts";
import type { DriverNode } from "./types";

const MAX_LABEL_LENGTH = 32;

/** Only co-movement-ONLY drivers need naming; the others already read well. */
export function needsLabel(driver: DriverNode): boolean {
  return driver.basis.every((b) => b.kind === "co-movement");
}

export interface LabelRequest {
  id: string;
  symbols: string[];
  /** Industry per symbol where resolved — the model's only substantive input. */
  industries: string[];
}

export function buildLabelPrompt(requests: LabelRequest[]): string {
  const blocks = requests
    .map(
      (r, i) =>
        `${i + 1}. id="${r.id}" members: ${r.symbols.join(", ")}${
          r.industries.length > 0 ? ` — industries: ${[...new Set(r.industries)].join(", ")}` : ""
        }`,
    )
    .join("\n");

  return `Each group below is a set of stocks that a correlation measurement placed together. Give each group a short name describing the shared economic exposure.

Rules:
- 2 to 4 words. No punctuation beyond a space or an ampersand.
- Name the economic driver ("Semiconductor cycle", "Rate-sensitive lenders"), not the sector label and not the tickers.
- If the members have nothing economically in common, return an empty string for that group. An empty answer is correct and expected.
- Do not comment on the investment merits of anything. Do not mention portfolios, weights, or risk.

Groups:
${blocks}

${JSON_SCHEMA_LEAD_IN}
{"labels":[{"id":"<the id given above>","label":"<2-4 words, or empty string>"}]}`;
}

interface LabelResponse extends Record<string, unknown> {
  labels: { id: string; label: string }[];
}

/** Pure: apply a parsed model response to the drivers, rejecting anything unusable. */
export function applyLabels(drivers: DriverNode[], labels: Map<string, string>): DriverNode[] {
  return drivers.map((d) => {
    const proposed = labels.get(d.id)?.trim();
    if (!proposed) return d;
    if (proposed.length > MAX_LABEL_LENGTH) return d;
    // A label that is just the tickers back is not a name.
    const symbols = d.issuerIds.map((i) => i.slice("issuer:".length).toUpperCase());
    if (symbols.some((s) => proposed.toUpperCase() === s)) return d;
    return { ...d, label: proposed, labelFromAi: true };
  });
}

/**
 * Name every co-movement-only cluster in one call. Best-effort: any failure
 * returns the drivers untouched.
 */
export async function nameCoMovementClusters(
  drivers: DriverNode[],
  industryOf: (symbol: string) => string | null,
): Promise<DriverNode[]> {
  const targets = drivers.filter(needsLabel);
  if (targets.length === 0) return drivers;

  const requests: LabelRequest[] = targets.map((d) => {
    const symbols = d.issuerIds.map((i) => i.slice("issuer:".length));
    return {
      id: d.id,
      symbols,
      industries: symbols.map(industryOf).filter((x): x is string => x != null),
    };
  });

  try {
    const raw = await runPrompt("exposure-cluster-label", buildLabelPrompt(requests), {
      json: true,
      timeoutMs: 20_000,
    });
    const parsed = extractJsonObject<LabelResponse>(raw, { labels: [] });
    const map = new Map<string, string>();
    for (const entry of parsed.labels ?? []) {
      if (typeof entry?.id === "string" && typeof entry?.label === "string") {
        map.set(entry.id, entry.label);
      }
    }
    return applyLabels(drivers, map);
  } catch {
    // The deterministic labels are a complete answer. Silence is correct here.
    return drivers;
  }
}
