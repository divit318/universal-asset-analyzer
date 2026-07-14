import type { ScoreResult } from "@/lib/types";
import { AssetScoreCard } from "@/app/_components/asset-score-card";

/**
 * Crypto-native score card — no analyst consensus, no fund-style cost/
 * holdings; the two signal rows reflect what the crypto scorer actually
 * measures (see lib/crypto-scoring.ts).
 */
export function CryptoScoreCard({ score }: { score: ScoreResult }) {
  return (
    <AssetScoreCard
      score={score}
      signalRows={[
        ["Crypto fundamentals", score.signals.fundamentals, "Momentum, relative strength vs BTC, risk-adjusted return & drawdown"],
        ["Price momentum", score.signals.momentum, "3-month return & position vs recent high"],
      ]}
    />
  );
}
