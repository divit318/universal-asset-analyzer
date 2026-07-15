import { AiInsightPanel } from "@/app/_components/ai-insight-panel";

interface AiManualAssetInsightProps {
  assetId: string;
  resetKey: string;
}

/** Single-section AI insight — the server recomputes metrics from the asset id, no client-side data to pass. */
export function AiManualAssetInsight({ assetId, resetKey }: AiManualAssetInsightProps) {
  return (
    <AiInsightPanel
      label="Analysis"
      resetKey={resetKey}
      promptHint="what do these numbers mean?"
      fetchInsight={async () => {
        const res = await fetch(`/api/manual-assets/${assetId}/insight`, { method: "POST" });
        const json = (await res.json()) as { insight?: string; model?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
        return { insight: json.insight ?? "", model: json.model ?? "" };
      }}
    />
  );
}
