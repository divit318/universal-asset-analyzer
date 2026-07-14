import type { DerivativesSummary } from "@/lib/derivatives-analysis";
import type { DerivativesInsightSection } from "@/lib/ai-derivatives-research";
import { AiInsightPanel } from "@/app/_components/ai-insight-panel";

interface AiDerivativesInsightProps {
  section: DerivativesInsightSection;
  symbol: string;
  underlyingName: string;
  summary: DerivativesSummary;
}

const SECTION_LABELS: Record<DerivativesInsightSection, string> = {
  volatility: "Volatility Interpretation",
  positioning: "Positioning Interpretation",
};

const PROMPT_HINTS: Record<DerivativesInsightSection, string> = {
  volatility: "what does the implied volatility mean?",
  positioning: "what does the open-interest positioning mean?",
};

export function AiDerivativesInsight({ section, symbol, underlyingName, summary }: AiDerivativesInsightProps) {
  return (
    <AiInsightPanel
      label={SECTION_LABELS[section]}
      resetKey={`${symbol}:derivatives:${section}`}
      promptHint={PROMPT_HINTS[section]}
      fetchInsight={async () => {
        const res = await fetch("/api/derivatives", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, underlyingName, summary }),
        });
        const json = (await res.json()) as { insight?: string; model?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
        return { insight: json.insight ?? "", model: json.model ?? "" };
      }}
    />
  );
}
