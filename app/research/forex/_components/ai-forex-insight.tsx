import type { NewsItem, ScoreResult } from "@/lib/types";
import type { ForexInsightSection } from "@/lib/ai-forex-research";
import { AiInsightPanel } from "@/app/_components/ai-insight-panel";

interface AiForexInsightProps {
  section: ForexInsightSection;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
  score: ScoreResult;
  /** Only used by the "macro-context" section — already fetched by /api/research, not re-fetched here. */
  news?: NewsItem[];
}

const SECTION_LABELS: Record<ForexInsightSection, string> = {
  momentum: "Momentum Interpretation",
  risk: "Risk Profile Analysis",
  "relative-strength": "Relative Strength Context",
  "macro-context": "Macro Context",
};

const PROMPT_HINTS: Record<ForexInsightSection, string> = {
  momentum: "what does this momentum mean?",
  risk: "what does this risk profile mean?",
  "relative-strength": "how does this compare to the US Dollar Index?",
  "macro-context": "what does recent news suggest about central banks/rates?",
};

export function AiForexInsight({ section, symbol, name, price, currency, changePercent, score, news }: AiForexInsightProps) {
  return (
    <AiInsightPanel
      label={SECTION_LABELS[section]}
      resetKey={`${symbol}:${section}`}
      promptHint={PROMPT_HINTS[section]}
      fetchInsight={async () => {
        const res = await fetch("/api/forex", {
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
