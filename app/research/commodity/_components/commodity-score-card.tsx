import type { ScoreResult } from "@/lib/types";
import { AssetScoreCard } from "@/app/_components/asset-score-card";

/**
 * Commodity-native score card — no analyst consensus, no supply/demand
 * numeric data (that's the AI insight layer, grounded in news); the two
 * signal rows reflect what the commodity scorer actually measures (see
 * lib/commodity-scoring.ts).
 */
export function CommodityScoreCard({ score }: { score: ScoreResult }) {
  return (
    <AssetScoreCard
      score={score}
      signalRows={[
        ["Commodity fundamentals", score.signals.fundamentals, "Momentum, relative strength vs commodity index, risk-adjusted return & drawdown"],
        ["Price momentum", score.signals.momentum, "3-month return & position vs recent high"],
      ]}
    />
  );
}
