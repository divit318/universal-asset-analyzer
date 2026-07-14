/**
 * AI research prompts for manual assets (Real Estate / Private Markets /
 * Alternatives / Structured Products), grounded in ManualAsset (lib/types.ts)
 * plus its category-specific computed metrics (lib/manual-asset-analysis.ts).
 * Unlike the market-data domains, there's no live feed or news to ground
 * against — the "data" is the user's own entered facts and the pure-math
 * metrics derived from them, so the prompt is explicit about not inventing
 * numbers beyond what's supplied (comparable local cap rates, similar deal
 * terms, market color, etc.).
 *
 * One insight section, not two like most other domains — the four
 * categories are too heterogeneous to force a shared second tab, and each
 * already gets a full category-specific data block.
 */

import { runPromptWithMeta } from "./ai";
import type { RealEstateMetrics, PrivateMarketMetrics, AlternativeMetrics, StructuredProductMetrics } from "./manual-asset-analysis";
import type { ManualAssetMetrics } from "./manual-asset-metrics";
import type { ManualAsset } from "./types";
import type { ChatMessage } from "./ai-research";

const fmtPct = (n: number | null) => (n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(1)}%` : "n/a");
const fmtNum = (n: number | null, digits = 2) => (n != null ? n.toFixed(digits) : "n/a");
const fmtMoney = (n: number | null) => (n != null ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "n/a");

function manualAssetDataBlock(asset: ManualAsset, metrics: ManualAssetMetrics): string {
  const base = `ASSET: ${asset.name}
Category: ${asset.category.replace("_", " ")}
Acquired: ${asset.acquisitionDate} for ${fmtMoney(asset.acquisitionCost)}
Current value: ${asset.currentValue != null ? `${fmtMoney(asset.currentValue)} (as of ${asset.currentValueAsOf ?? "unknown date"})` : "not entered — user has not provided a current valuation"}
${asset.notes ? `Notes: ${asset.notes}` : ""}`;

  switch (asset.category) {
    case "real_estate": {
      const d = asset.details;
      const m = metrics as RealEstateMetrics;
      return `${base}

PROPERTY: ${d.propertyType}${d.address ? ` — ${d.address}` : ""}
Annual rental income: ${fmtMoney(d.annualRentalIncome)}
Annual expenses: ${fmtMoney(d.annualExpenses)}
Outstanding mortgage: ${fmtMoney(d.outstandingMortgage)}${d.mortgageRatePercent != null ? ` @ ${d.mortgageRatePercent.toFixed(2)}%` : ""}

COMPUTED METRICS:
  Net operating income (NOI): ${fmtMoney(m.noi)}
  Cap rate: ${fmtPct(m.capRatePercent)}
  Gross rental yield: ${fmtPct(m.rentalYieldPercent)}
  Approx. annual debt service: ${fmtMoney(m.approxAnnualDebtService)}
  Cash-on-cash return: ${fmtPct(m.cashOnCashReturnPercent)}
  Total price appreciation since acquisition: ${fmtPct(m.totalAppreciationPercent)}

NOTE: Cash-on-cash return uses an approximate debt service (rate x balance, no amortization schedule collected) — treat it as directional, not exact.`;
    }
    case "private_market": {
      const d = asset.details;
      const m = metrics as PrivateMarketMetrics;
      return `${base}

COMPANY: ${d.companyName}${d.round ? ` — ${d.round} round` : ""}
Ownership stake: ${d.ownershipPercent != null ? `${d.ownershipPercent}%` : "n/a"}
Last round valuation: ${fmtMoney(d.lastRoundValuation)}

COMPUTED METRICS:
  MOIC (multiple on invested capital): ${m.moic != null ? `${m.moic.toFixed(2)}x` : "n/a"}
  Annualized return: ${fmtPct(m.annualizedReturnPercent)}
  Implied ownership value (ownership % x last round valuation): ${fmtMoney(m.impliedOwnershipValue)}

NOTE: Private-market valuations are illiquid and infrequently marked — MOIC/annualized return only reflect the user's entered current value, which may be stale relative to the last priced round.`;
    }
    case "alternative": {
      const d = asset.details;
      const m = metrics as AlternativeMetrics;
      return `${base}

SUBCATEGORY: ${d.subcategory}
Condition: ${d.condition ?? "n/a"}
Provenance: ${d.provenance ?? "n/a"}

COMPUTED METRICS:
  Appreciation since acquisition: ${fmtPct(m.appreciationPercent)}
  CAGR: ${fmtPct(m.cagrPercent)}

NOTE: There is no public market price for this asset — the current value is the user's own estimate (appraisal, comparable sale, insurance valuation, etc.), not a verified market quote.`;
    }
    case "structured_product": {
      const d = asset.details;
      const m = metrics as StructuredProductMetrics;
      const levelsLines = Object.entries(m.currentLevelsPercent)
        .map(([sym, pct]) => `    ${sym}: ${pct.toFixed(1)}% of initial level`)
        .join("\n") || "    n/a — underlying quotes unavailable";
      const scenarioLines = m.payoffScenarios
        ? m.payoffScenarios.map((s) => `    ${fmtPct(s.finalLevelPercent - 100)} underlying move -> ${s.payoffPercent.toFixed(1)}% of principal`).join("\n")
        : "    not modeled for this product type (autocallable/other lack a well-defined non-path-dependent formula)";

      return `${base}

PRODUCT TYPE: ${d.productType.replace(/_/g, " ")}
Underlyings: ${d.underlyingSymbols.join(", ")}
Barrier: ${d.barrierPercent != null ? `${d.barrierPercent}% of initial level` : "n/a"}
Coupon rate: ${d.couponRatePercent != null ? `${d.couponRatePercent}%/yr` : "n/a"}
Participation rate: ${d.participationRatePercent != null ? `${d.participationRatePercent}%` : "n/a"}
Principal protection: ${d.principalProtectionPercent != null ? `${d.principalProtectionPercent}%` : "n/a"}
Maturity: ${d.maturityDate} (${m.yearsToMaturity.toFixed(2)} years remaining)

CURRENT UNDERLYING LEVELS (vs level at issuance):
${levelsLines}

Worst-of level: ${m.worstOfLevelPercent != null ? `${m.worstOfLevelPercent.toFixed(1)}%` : "n/a"}
Distance to barrier: ${m.distanceToBarrierPercent != null ? `${fmtNum(m.distanceToBarrierPercent, 1)}pp` : "n/a"}${m.distanceToBarrierPercent != null && m.distanceToBarrierPercent < 0 ? " — BARRIER BREACHED" : ""}

PAYOFF AT MATURITY UNDER HYPOTHETICAL MOVES:
${scenarioLines}

NOTE: Underlying levels use live current prices; the barrier/payoff logic is worst-of across all listed underlyings, standard for multi-underlying structured notes.`;
    }
  }
}

export interface ManualAssetSectionInsightInput {
  asset: ManualAsset;
  metrics: ManualAssetMetrics;
}

const CATEGORY_FOCUS: Record<ManualAsset["category"], string> = {
  real_estate: "Interpret the cap rate, cash-on-cash return, and appreciation together — is this property cash-flowing well relative to its debt load, and how much of the return so far is income vs. price appreciation?",
  private_market: "Interpret the MOIC and annualized return, and flag if the implied ownership value diverges meaningfully from the user's entered current value (a sign the position may be marked stale).",
  alternative: "Interpret the appreciation and CAGR, and remind the reader that this rests on a self-reported valuation with no public market to verify it against.",
  structured_product: "Interpret the distance to barrier and the payoff scenarios — how much cushion exists before principal is at risk, and what does the risk/reward asymmetry look like versus simply holding the underlying(s)?",
};

export async function manualAssetSectionInsight(
  input: ManualAssetSectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { asset, metrics } = input;

  const prompt = `You are a private-wealth analyst reviewing a manually-tracked, illiquid asset. In 2-3 sentences, ${CATEGORY_FOCUS[asset.category]}

${manualAssetDataBlock(asset, metrics)}

Be direct and cite specific numbers from the data above. Do not invent comparable market data, appraisals, or benchmarks that aren't supplied — if you'd normally want a market comparison to judge this, say what's missing rather than fabricating a figure.`;

  const { text: raw, model } = await runPromptWithMeta("manual-asset-research", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface ManualAssetChatInput {
  asset: ManualAsset;
  metrics: ManualAssetMetrics;
  history: ChatMessage[];
  question: string;
}

export async function manualAssetChatWithData(input: ManualAssetChatInput): Promise<{ answer: string; model: string }> {
  const { asset, metrics, history, question } = input;

  const system = `You are an expert private-wealth analyst. Using ONLY the structured data below, answer the user's question about this asset. Be precise, cite specific numbers. This asset has no live market feed — all figures come from the user's own entries and the metrics computed from them. If asked for a comparable, benchmark, or market data point that isn't in the data, say clearly that it isn't available rather than guessing. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${manualAssetDataBlock(asset, metrics)}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const { text: answer, model } = await runPromptWithMeta("manual-asset-research", fullPrompt, { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
