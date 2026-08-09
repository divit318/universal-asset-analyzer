/**
 * Golden fixtures for the AI grounding eval harness.
 *
 * Each case pairs a piece of evidence (the dossier a model was given) with a
 * candidate answer and the grounding verdict we expect. This is the seed of a
 * regression net for AI output quality: today it holds hand-written good/bad
 * outputs that lock in the verifier's behavior; as we capture real model
 * generations they drop straight in here with an expected verdict, so a prompt
 * or model change that starts producing ungrounded answers fails CI.
 *
 * Kept as plain data (no model, no network) so `npm run test` exercises it.
 */

export interface GroundingEvalCase {
  name: string;
  /** The evidence text the model was grounded in. */
  evidence: string;
  /** Source tags legitimately present in that evidence. */
  allowedTags: string[];
  /** The candidate answer to score. */
  answer: string;
  expect: {
    /** Inclusive lower bound on the grounding score. */
    minScore?: number;
    /** Inclusive upper bound on the grounding score. */
    maxScore?: number;
    /** Expected coarse level. */
    level?: "high" | "medium" | "low";
    /** Substrings that MUST appear among the unsupported figures. */
    mustFlag?: string[];
    /** Figures that must NOT be flagged (guards against false positives). */
    mustNotFlag?: string[];
    /** Citation tags expected to be reported invalid. */
    invalidCitations?: string[];
  };
}

const AAPL_EVIDENCE = [
  "### Valuation  [yahoo:valuation]",
  "P/E (trailing): 28.6 | Forward P/E: 26.1 | PEG: 2.4 | P/B: 46.2 | EV/EBITDA: 21.3x",
  "",
  "### Growth  [yahoo:growth]",
  "Revenue growth (YoY): 4.9% | Earnings growth (YoY): 7.8%",
  "",
  "### Profitability  [yahoo:profitability]",
  "Gross margin: 46.2% | Operating margin: 31.5% | ROE: 147.3% | FCF margin: 25.8%",
  "",
  "### Price & market data  [yahoo:price]",
  "Price: $228.52 | Market cap: $3.42T | 52w range: $164.08–$237.23",
  "",
  "### Platform score  [platform:score]",
  "Composite: 71/100 | Value: 42 | Quality: 88 | Momentum: 74",
].join("\n");

const RELIANCE_EVIDENCE = [
  "### Valuation  [screener:valuation]",
  "P/E: 24.1 | P/B: 2.1 | Market cap: ₹19,80,000 cr",
  "",
  "### Growth  [screener:growth]",
  "Sales growth (TTM): 8.2% | Profit growth (TTM): 11.4%",
].join("\n");

export const GROUNDING_EVAL_CASES: GroundingEvalCase[] = [
  {
    name: "AAPL — well-grounded valuation answer",
    evidence: AAPL_EVIDENCE,
    allowedTags: ["yahoo:valuation", "yahoo:growth", "yahoo:profitability", "yahoo:price", "platform:score"],
    answer:
      "Apple trades at 28.6x trailing earnings [yahoo:valuation], rich versus its 4.9% revenue growth [yahoo:growth]. " +
      "Quality is exceptional — 46.2% gross margin and a 31.5% operating margin [yahoo:profitability] — and the platform " +
      "scores it 71/100 [platform:score]. At a $3.42T cap [yahoo:price] the multiple leaves little margin of safety.",
    expect: { minScore: 0.95, level: "high", mustNotFlag: ["28.6x", "4.9%", "46.2%", "31.5%", "71"] },
  },
  {
    name: "AAPL — rounding and forward-multiple phrasing still grounded",
    evidence: AAPL_EVIDENCE,
    allowedTags: ["yahoo:valuation", "yahoo:price"],
    answer:
      "It's ~26x forward earnings [yahoo:valuation] with the stock around $229 [yahoo:price], near the top of its 52-week range.",
    expect: { minScore: 0.9, level: "high", mustNotFlag: ["26x", "$229"] },
  },
  {
    name: "AAPL — fabricated growth and margin figures",
    evidence: AAPL_EVIDENCE,
    allowedTags: ["yahoo:valuation", "yahoo:growth", "yahoo:profitability"],
    answer:
      "Revenue is compounding at 19% [yahoo:growth] with a 62% gross margin [yahoo:profitability], making the 28.6x " +
      "multiple [yahoo:valuation] look cheap.",
    expect: { maxScore: 0.75, mustFlag: ["19%", "62%"], mustNotFlag: ["28.6x"] },
  },
  {
    name: "AAPL — invented data source",
    evidence: AAPL_EVIDENCE,
    allowedTags: ["yahoo:valuation", "yahoo:price"],
    answer: "Our channel checks [gartner:survey] confirm demand; the stock is $228.52 [yahoo:price].",
    expect: { invalidCitations: ["gartner:survey"], mustNotFlag: ["$228.52"] },
  },
  {
    name: "AAPL — qualitative answer, nothing to trace",
    evidence: AAPL_EVIDENCE,
    allowedTags: ["yahoo:valuation"],
    answer: "Apple's moat is its ecosystem lock-in and brand; the key risk is smartphone market saturation.",
    expect: { minScore: 1, level: "high" },
  },
  {
    name: "RELIANCE — Indian crore magnitudes grounded",
    evidence: RELIANCE_EVIDENCE,
    allowedTags: ["screener:valuation", "screener:growth"],
    answer:
      "Reliance trades at 24x earnings [screener:valuation] on a ₹19,80,000 cr market cap, with sales up 8.2% [screener:growth].",
    expect: { minScore: 0.9, level: "high", mustNotFlag: ["24x", "8.2%"] },
  },
];
