import type { ScoreResult } from "@/lib/types";
import { AssetScoreCard } from "@/app/_components/asset-score-card";

/**
 * Fund-native score card — a fund has no analyst consensus, so this supplies
 * fund-appropriate signal-row labels to the shared AssetScoreCard rather than
 * showing a permanently blank "Analyst consensus" row (see asset-score-card.tsx
 * for why equity keeps its own separate ScoreCard).
 */
export function FundScoreCard({ score }: { score: ScoreResult }) {
  return (
    <AssetScoreCard
      score={score}
      signalRows={[
        ["Fund fundamentals", score.signals.fundamentals, "Cost, diversification, performance & risk-adjusted quality"],
        ["Price momentum", score.signals.momentum, "Technical trend vs moving averages"],
      ]}
    />
  );
}
