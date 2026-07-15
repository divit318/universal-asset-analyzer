import type { FundProfileData, ScoreResult } from "@/lib/types";
import type { FundInsightSection } from "@/lib/ai-fund-research";
import { AiInsightPanel } from "@/app/_components/ai-insight-panel";

interface AiFundInsightProps {
  section: FundInsightSection;
  symbol: string;
  name: string;
  fund: FundProfileData;
  score: ScoreResult;
}

const SECTION_LABELS: Record<FundInsightSection, string> = {
  holdings: "Holdings Interpretation",
  allocation: "Allocation Analysis",
  performance: "Performance Context",
  cost: "Cost Analysis",
};

export function AiFundInsight({ section, symbol, name, fund, score }: AiFundInsightProps) {
  return (
    <AiInsightPanel
      label={SECTION_LABELS[section]}
      resetKey={`${symbol}:${section}`}
      promptHint={`what does this ${section} mean?`}
      fetchInsight={async () => {
        const res = await fetch("/api/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, symbol, name, fund, score }),
        });
        const json = (await res.json()) as { insight?: string; model?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
        return { insight: json.insight ?? "", model: json.model ?? "" };
      }}
    />
  );
}
