/**
 * Allowlist for tests/no-private-score-bands.test.ts — the static guard that
 * fails the build when a file interprets a 0-100 score through a private
 * numeric threshold table instead of lib/recommendation.ts.
 *
 * Every entry is a VERIFIED legitimate specialization (2026-08-17 audit).
 * One line of justification each. Adding an entry here is a methodology
 * decision, not a convenience — if your new code maps a canonical 0-100
 * score to labels/colors, use lib/recommendation.ts instead.
 */
export const SCORE_INTERPRETATION_ALLOWLIST: Record<string, string> = {
  "lib/recommendation.ts":
    "The canonical interpretation layer itself — the only place bands may live.",
  "lib/thematic-engine.ts":
    "Checklist signals on the AI's 0-10 STAGE scores (>=7 positive, >=5 neutral) — a different scale from the canonical 0-100; the theme's 0-100 verdict routes through scoreToOpportunityVerdict.",
  "lib/auth-gate.ts":
    "Password-strength meter (length/variety): not a financial score at all; its Weak/Fair/Strong labels coincide with grade words by accident.",
  "lib/portfolio/engines/position-size-explain.ts":
    "Sizing-policy gates keyed off the SHARED Recommendation enum plus conviction/allocation minima (0.55 conviction, 2.5% weight) — policy on canonical outputs, not a re-banding of them.",
  "lib/wire/labels.ts":
    "modelReadTier (75/55) tiers an LLM-asserted CONFIDENCE in its own read, not an asset score.",
  "lib/portfolio/alignment/tone.ts":
    "The alignment domain's ONE severity mapping (positive/neutral/warning on alignmentLabelOf's 70/55 edges; warning ceiling per 2026-08-17 ruling 3) — every alignment surface derives from it.",
  "app/portfolio/_components/universal/decision-center.tsx":
    "Decision Score is centered at 50 = 'no measurable improvement' (lib/portfolio/engines/decision.ts scoreOf); Buy/Sell band edges would be meaningless on it.",
  "app/portfolio/_components/universal/key-facts-strip.tsx":
    "Concentration/cash/illiquidity facts judge WEIGHT PERCENTAGES (>=20% single position, >=80% one geography), not 0-100 scores.",
  "app/portfolio/_components/universal/risk-lab.tsx":
    "Risk-domain statistics (avg correlation 0.7, HHI 2500/1500, class/sector weights): standard risk thresholds, not score bands.",
  "app/portfolio/_components/universal/attribution-panel.tsx":
    "Return-attribution breadth judgment (top-3 share of P&L >= 70% narrow / <= 40% broad): a weight share, not a score.",
  "app/portfolio/page.tsx":
    "Cash-weight judgment (>25% drag / <1% no buffer): a weight percentage, not a score. (Its alignment tone derives from lib/portfolio/alignment/tone.ts.)",
  "app/engine/_components/model-health.tsx":
    "Quant-desk statistical judgments (IC >= 0.06, hit-rate >= 0.55, decay >= 0.5): domain thresholds on model diagnostics, not 0-100 asset scores.",
  "app/engine/_components/conviction-book.tsx":
    "P(up) probability judgment (0.55/0.45 around the 0.5 coin-flip): a calibrated probability, not a 0-100 score.",
  "app/research/_components/conviction-breakdown.tsx":
    "confidenceLabel (70/45) grades DATA CONFIDENCE (input coverage), not a directional 0-100 score; its score bars route through scoreMeterTone.",
  "app/research/_components/research-confidence-meter.tsx":
    "Data-coverage meter (80/50): measures how much of the input set was available, not asset attractiveness.",
  "app/research/_components/ownership-card.tsx":
    "Short-interest judgment (>10% of float negative, >5% neutral): a market-positioning metric, not a score.",
  "app/research/india/_components/ranked-peers.tsx":
    "Peer-percentile bar in equal thirds (66/33): position within a small peer set, not a canonical 0-100 score.",
  "app/research/india/_components/financial-charts.tsx":
    "Growth/margin judgments on raw domain metrics (YoY% >= 10, OPM >= 20): financial metrics, not 0-100 scores.",
  "app/research/india/_components/ratio-sparklines.tsx":
    "Ratio-level judgments on raw metrics (ROCE/ROE >= 15%): financial metrics, not 0-100 scores.",
  "app/watchlist/_components/row-detail.tsx":
    "Days-until-earnings urgency (<= 7 days = warning): a calendar distance, not a score.",
  "app/wire/_components/strength.ts":
    "The Wire's single signal-strength grammar (70/45, accent midband): signal strength, not an asset score; deliberately not warning-colored (see file header).",
  "app/_components/ui/score-chip.tsx":
    "neutralTone for NON-BANDED score kinds (quality): highlights >=65, never renders negative — coloring low quality red would assert a sell call the number does not make (lib/score-kinds.ts).",
};
