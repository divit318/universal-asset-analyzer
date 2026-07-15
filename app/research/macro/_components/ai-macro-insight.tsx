import type { NewsItem } from "@/lib/types";
import type { MacroSummary } from "@/lib/macro-analysis";
import type { MacroInsightSection } from "@/lib/ai-macro-research";
import { AiInsightPanel } from "@/app/_components/ai-insight-panel";

interface AiMacroInsightProps {
  section: MacroInsightSection;
  resetKey: string;
  summary: MacroSummary;
  /** Only used by the "macro-context" section — already fetched by /api/research, not re-fetched here. */
  news?: NewsItem[];
}

const SECTION_LABELS: Record<MacroInsightSection, string> = {
  curve: "Yield Curve Interpretation",
  "macro-context": "Macro Context",
};

const PROMPT_HINTS: Record<MacroInsightSection, string> = {
  curve: "what does the yield curve shape mean?",
  "macro-context": "what does recent news suggest about inflation/GDP/employment?",
};

export function AiMacroInsight({ section, resetKey, summary, news }: AiMacroInsightProps) {
  return (
    <AiInsightPanel
      label={SECTION_LABELS[section]}
      resetKey={`${resetKey}:${section}`}
      promptHint={PROMPT_HINTS[section]}
      fetchInsight={async () => {
        const res = await fetch("/api/macro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, summary, news }),
        });
        const json = (await res.json()) as { insight?: string; model?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
        return { insight: json.insight ?? "", model: json.model ?? "" };
      }}
    />
  );
}
