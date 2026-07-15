import type { ScoreResult } from "@/lib/types";
import type { CryptoInsightSection } from "@/lib/ai-crypto-research";
import { AiInsightPanel } from "@/app/_components/ai-insight-panel";

interface AiCryptoInsightProps {
  section: CryptoInsightSection;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
  marketCap: number | null;
  score: ScoreResult;
}

const SECTION_LABELS: Record<CryptoInsightSection, string> = {
  momentum: "Momentum Interpretation",
  risk: "Risk Profile Analysis",
  "relative-strength": "Relative Strength Context",
};

const PROMPT_HINTS: Record<CryptoInsightSection, string> = {
  momentum: "what does this momentum mean?",
  risk: "what does this risk profile mean?",
  "relative-strength": "how does this compare to BTC?",
};

export function AiCryptoInsight({ section, symbol, name, price, currency, changePercent, marketCap, score }: AiCryptoInsightProps) {
  return (
    <AiInsightPanel
      label={SECTION_LABELS[section]}
      resetKey={`${symbol}:${section}`}
      promptHint={PROMPT_HINTS[section]}
      fetchInsight={async () => {
        const res = await fetch("/api/crypto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, symbol, name, price, currency, changePercent, marketCap, score }),
        });
        const json = (await res.json()) as { insight?: string; model?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
        return { insight: json.insight ?? "", model: json.model ?? "" };
      }}
    />
  );
}
