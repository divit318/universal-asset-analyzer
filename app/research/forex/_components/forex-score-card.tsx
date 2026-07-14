import type { ScoreResult } from "@/lib/types";
import { AssetScoreCard } from "@/app/_components/asset-score-card";

/**
 * Forex-native score card — no analyst consensus, no central bank/macro
 * numeric data (that's the AI insight layer, grounded in news); the two
 * signal rows reflect what the forex scorer actually measures (see
 * lib/forex-scoring.ts).
 */
export function ForexScoreCard({ score }: { score: ScoreResult }) {
  return (
    <AssetScoreCard
      score={score}
      signalRows={[
        ["Forex fundamentals", score.signals.fundamentals, "Momentum, relative strength vs Dollar Index, risk-adjusted return & drawdown"],
        ["Price momentum", score.signals.momentum, "3-month return & position vs recent high"],
      ]}
    />
  );
}
