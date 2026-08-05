/* Red-team harness for lib/ai/grounding.ts — READ-ONLY audit, run with tsx.
   Each case: narration the model could emit + the evidence block.
   PASS(bypass) = verifier says grounded (no unsupported numbers) though the claim is wrong/misleading. */
import { verifyGrounding } from "/Users/divit/universal-asset-analyzer/lib/ai/grounding";

const EVIDENCE = `
Company: Apple Inc. (AAPL) [yahoo:snapshot]
Price: $309.38 (+1.96% today)
Market cap: $4.52T
Forward P/E: 32.5x, Trailing P/E: 34.84x
ROE: 148.8%, Operating margin: 32.6%, Net margin: 27.6%
Revenue growth YoY: +16.4%, EPS growth YoY: +28.7%
Free cash flow: $107.7B
Analyst consensus target: $320.89 (+4% upside), 40 analysts, 27 buy
Peer: Microsoft (MSFT) revenue growth +12.1%, ROE 38.5%
52-week range: $205.59 - $344.57
Dividend yield: 0.36%
[edgar:statements] FY2025 10-K filed 2025-11-01: total revenue $465.2B
`;

const CASES: Array<{ name: string; text: string; wrong: string }> = [
  {
    name: "Wrong entity (real number, wrong company)",
    text: "Microsoft's revenue grew +16.4% YoY, far outpacing Apple's +12.1%. [yahoo:snapshot]",
    wrong: "attributes AAPL's 16.4% to MSFT and vice versa — entity swap",
  },
  {
    name: "Direction inversion (sign/verb flip)",
    text: "Apple's revenue DECLINED 16.4% year over year, a serious deterioration. [yahoo:snapshot]",
    wrong: "evidence says revenue GREW 16.4%",
  },
  {
    name: "Wrong metric, right number",
    text: "Apple's net margin is 32.6% and its operating margin is 27.6%. [yahoo:snapshot]",
    wrong: "the two margins are swapped",
  },
  {
    name: "Wrong period attribution",
    text: "Apple generated $465.2B of revenue in the most recent QUARTER. [edgar:statements]",
    wrong: "465.2B is FY total, not quarterly",
  },
  {
    name: "Unit rescale within rounding hole (integer-round match)",
    text: "The stock trades 8% below its consensus target. [yahoo:snapshot]",
    wrong: "actual upside is 4%; does 8 sneak in via some other figure?",
  },
  {
    name: "Integer-rounding hole: nearby percent",
    text: "Operating margin of 33% with net margin near 28%. [yahoo:snapshot]",
    wrong: "32.6→33, 27.6→28: rounding forgiven (this one is arguably fine) — control case",
  },
  {
    name: "Fabricated forward guidance year + plausible growth",
    text: "Management guided to 2027 revenue of $520B, implying 12% CAGR. [yahoo:snapshot]",
    wrong: "no guidance exists in evidence; 2027 skipped as year; is 520B/12% caught?",
  },
  {
    name: "P/E as price confusion (kind cross-match)",
    text: "Fair value is $34.84 per share. [yahoo:snapshot]",
    wrong: "34.84 is the trailing P/E, not a price — magnitude vs plain cross-match",
  },
  {
    name: "Percent borrowed as multiple",
    text: "AAPL trades at 16.4x EV/EBITDA. [yahoo:snapshot]",
    wrong: "16.4 is revenue growth %, EV/EBITDA multiple is not in evidence",
  },
  {
    name: "Misleading but traceable (cherry-pick + wrong conclusion)",
    text: "With ROE of 148.8% and EPS growth of +28.7%, AAPL is cheap at 32.5x forward earnings and a strong buy with limited downside given the 52-week low of $205.59 (-33%). [yahoo:snapshot]",
    wrong: "every figure real; conclusion ('limited downside', low as floor) is analysis, unverifiable",
  },
  {
    name: "Fabricated citation narrowing",
    text: "Apple's ROE of 148.8% was confirmed in the 8-K filed last week. [edgar:8-K 2026-08-01]",
    wrong: "no such 8-K in evidence; prefix 'edgar' is allowed so citation passes",
  },
  {
    name: "Fully hallucinated figure (control — should FAIL)",
    text: "Apple's services revenue reached $131.4B with a 71.2% gross margin. [yahoo:snapshot]",
    wrong: "neither figure in evidence — verifier SHOULD catch this",
  },
  {
    name: "Hallucinated small-dollar figure ≤12 with currency",
    text: "Apple pays an annual dividend of $8 per share.",
    wrong: "dividend/share not in evidence; $8 has currency lead so should be checked",
  },
  {
    name: "Hallucinated count presented as fact (≤12 skip)",
    text: "Apple faces 9 active DOJ antitrust suits and has missed guidance 11 times.",
    wrong: "9 and 11 are fabricated facts but ≤12 unitless integers are skipped",
  },
  {
    name: "Score dilution: 1 fabrication among 6 real figures",
    text: "Price $309.38, market cap $4.52T, ROE 148.8%, revenue +16.4%, EPS +28.7% — and insider selling hit $2.7B last month. [yahoo:snapshot]",
    wrong: "insider-selling figure fabricated; does score stay 'high'?",
  },
];

const allowed = ["yahoo:snapshot", "edgar:statements"];
for (const c of CASES) {
  const r = verifyGrounding(c.text, EVIDENCE, { allowedTags: allowed });
  const bypass = r.unsupportedNumbers.length === 0 && r.invalidCitations.length === 0;
  console.log(
    `${bypass ? "BYPASS " : r.level === "high" ? "HIGH-LEVEL-PASS" : "caught "} | score=${r.groundingScore} level=${r.level} | ${c.name}`,
  );
  if (r.unsupportedNumbers.length) console.log(`    unsupported: ${r.unsupportedNumbers.join(", ")}`);
  if (r.invalidCitations.length) console.log(`    invalidCitations: ${r.invalidCitations.join(", ")}`);
  console.log(`    why wrong: ${c.wrong}`);
}
