import type { NewsItem, ScoreResult } from "@/lib/types";
import type { CommodityInsightSection } from "@/lib/ai-commodity-research";
import { AiInsightPanel } from "@/app/_components/ai-insight-panel";

interface AiCommodityInsightProps {
  section: CommodityInsightSection;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
  score: ScoreResult;
  /** Only used by the "supply-demand" section — already fetched by /api/research, not re-fetched here. */
  news?: NewsItem[];
}

const SECTION_LABELS: Record<CommodityInsightSection, string> = {
  momentum: "Momentum Interpretation",
  risk: "Risk Profile Analysis",
  "relative-strength": "Relative Strength Context",
  "supply-demand": "Supply & Demand Context",
};

const PROMPT_HINTS: Record<CommodityInsightSection, string> = {
  momentum: "what does this momentum mean?",
  risk: "what does this risk profile mean?",
  "relative-strength": "how does this compare to the broad commodity index?",
  "supply-demand": "what does recent news suggest about supply/demand?",
};

export function AiCommodityInsight({ section, symbol, name, price, currency, changePercent, score, news }: AiCommodityInsightProps) {
  return (
    <AiInsightPanel
      label={SECTION_LABELS[section]}
      resetKey={`${symbol}:${section}`}
      promptHint={PROMPT_HINTS[section]}
      fetchInsight={async () => {
        const res = await fetch("/api/commodity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, symbol, name, price, currency, changePercent, score, news }),
        });
        const json = (await res.json()) as { insight?: string; model?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
        return { insight: json.insight ?? "", model: json.model ?? "" };
      }}
    />
  );
}
