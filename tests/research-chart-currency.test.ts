/**
 * Research Hub chart currency — regression guards.
 *
 * 2026-08-14: every Research Hub chart hardcoded a dollar sign (a local
 * `fmtPrice`, a `$${v}B` tooltip, a `$`-prefixed EPS axis), so 7974.T's
 * ¥14,655 price rendered as "$14655". The fix routes every monetary chart
 * surface through lib/format's formatChartPrice / formatChartMoneyCompact /
 * formatCompactCurrency with the currency that travelled with the data
 * (Quote.currency for prices, financialCurrency for statements).
 *
 * Three layers of guard, all node-safe (no DOM):
 *   1. Source scan — no dollar-literal formatting may reappear in the chart
 *      components (the exact pattern class that caused the bug).
 *   2. Wiring — the page must actually pass a currency into every chart, and
 *      the charts must pass it on to their formatters/children.
 *   3. Contract — switching the researched symbol (US → India → Japan …)
 *      changes chart output purely through Quote.currency, with the missing-
 *      metadata fallback rendering unlabelled numbers, never assumed dollars.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatChartPrice } from "@/lib/format";
import type { Quote } from "@/lib/types";

const RESEARCH = join(__dirname, "..", "app", "research");
const src = (...parts: string[]) => readFileSync(join(...parts), "utf8");

/* -------------------------------------------------------------------------- */
/* 1. No hardcoded dollar formatting in Research Hub chart components         */
/* -------------------------------------------------------------------------- */

/**
 * Every chart-bearing Research Hub component (plus the shared relative-
 * strength chart the fund path renders). India's financial-charts are
 * excluded deliberately: their data source (screener.in) is INR-only and the
 * ₹ crore formatting there is correct by construction.
 */
const CHART_COMPONENTS = [
  join(RESEARCH, "_components", "interactive-chart.tsx"),
  join(RESEARCH, "_components", "candle-chart.tsx"),
  join(RESEARCH, "_components", "charts.tsx"),
  join(RESEARCH, "_components", "earnings-card.tsx"),
  join(RESEARCH, "_components", "valuation-history-chart.tsx"),
  join(RESEARCH, "_components", "sparkline.tsx"),
  join(RESEARCH, "_components", "ownership-card.tsx"),
  join(RESEARCH, "_components", "analyst-card.tsx"),
  join(RESEARCH, "_components", "pattern-analysis-panel.tsx"),
  join(RESEARCH, "_components", "chart-workspace", "crosshair-panel.tsx"),
  join(RESEARCH, "fund", "_components", "sector-allocation-chart.tsx"),
  join(RESEARCH, "fund", "_components", "fund-performance-card.tsx"),
  join(__dirname, "..", "app", "_components", "relative-strength-chart.tsx"),
];

/** The literal shapes a hardcoded dollar takes in JSX/TS source. */
const DOLLAR_LITERALS: [RegExp, string][] = [
  [/\$\$\{/, "template literal `$${…}` (dollar glued to an interpolation)"],
  [/>\$\{/, "JSX text `>${…}` (dollar glued to an expression)"],
  [/["'`]\$["'`]/, "bare '$' string literal"],
  [/["']USD["']/, "hardcoded 'USD' code"],
  [/formatMarketCap\(/, "formatMarketCap (dollar-only helper)"],
];

describe("Research Hub charts carry no hardcoded dollar", () => {
  for (const file of CHART_COMPONENTS) {
    const name = file.split("/").slice(-2).join("/");
    it(`${name} formats through the canonical currency formatters`, () => {
      const source = src(file);
      for (const [pattern, label] of DOLLAR_LITERALS) {
        expect(pattern.test(source), `${name} contains ${label}`).toBe(false);
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 2. The page threads a currency into every monetary chart                   */
/* -------------------------------------------------------------------------- */

describe("Research page wires currency into every chart", () => {
  const page = src(RESEARCH, "page.tsx");

  it("InteractiveChart, EarningsCard, OwnershipCard, AnalystCard get the listing currency", () => {
    // One occurrence per component; InteractiveChart's is inside its JSX block.
    for (const component of ["<EarningsCard", "<OwnershipCard", "<AnalystCard"]) {
      const at = page.indexOf(component);
      expect(at, `${component} not rendered`).toBeGreaterThan(-1);
      const jsx = page.slice(at, page.indexOf("/>", at) + 2);
      expect(jsx, `${component} missing currency={quote.currency}`).toContain(
        "currency={quote.currency}",
      );
    }
    const chartAt = page.indexOf("<InteractiveChart");
    const chartJsx = page.slice(chartAt, page.indexOf("/>", chartAt) + 2);
    expect(chartJsx).toContain("currency={quote.currency}");
  });

  it("RevenueFcfChart gets the REPORTING currency (financialCurrency, ADR-safe)", () => {
    const at = page.indexOf("<RevenueFcfChart");
    expect(at).toBeGreaterThan(-1);
    const jsx = page.slice(at, page.indexOf("/>", at) + 2);
    expect(jsx).toContain(
      "statementsCurrency(fundamentals.snapshot.financialCurrency, quote.currency)",
    );
  });

  it("InteractiveChart hands the currency on to CandleChart", () => {
    const chart = src(RESEARCH, "_components", "interactive-chart.tsx");
    const at = chart.indexOf("<CandleChart");
    const jsx = chart.slice(at, chart.indexOf("/>", at) + 2);
    expect(jsx).toContain("currency={currency}");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Switching the researched symbol switches the chart currency             */
/* -------------------------------------------------------------------------- */

/** A quote as the research page receives it — only the fields at play here. */
function quoteFixture(symbol: string, currency: string, price: number): Pick<Quote, "symbol" | "currency" | "price"> {
  return { symbol, currency, price };
}

describe("chart currency follows the researched security", () => {
  it("US → India → Japan re-derives the chart's unit from each new quote", () => {
    // The chart's only currency input is quote.currency (see wiring test
    // above), so formatting the same way the axis/tooltip does proves a
    // symbol switch re-labels the chart.
    const aapl = quoteFixture("AAPL", "USD", 232.55);
    const reliance = quoteFixture("RELIANCE.NS", "INR", 2954);
    const nintendo = quoteFixture("7974.T", "JPY", 14655);

    expect(formatChartPrice(aapl.price, aapl.currency)).toBe("$233");
    expect(formatChartPrice(reliance.price, reliance.currency)).toBe("₹2,954");
    expect(formatChartPrice(nintendo.price, nintendo.currency)).toBe("¥14,655");
  });

  it("a quote with unknown currency renders unlabelled — never dollars", () => {
    expect(formatChartPrice(2954, null)).toBe("2,954");
    expect(formatChartPrice(2954, null)).not.toContain("$");
  });

  it("an unsupported market currency stays explicit via its ISO code", () => {
    expect(formatChartPrice(184.2, "KWD")).toBe("KWD 184");
  });
});
