/**
 * System-wide currency correctness — regression guards.
 *
 * 2026-08-14 audit: beyond the Research Hub charts, hardcoded dollars lived in
 * the Excel research report, the portfolio/watchlist/compare exports, the
 * Compare UI, the calendar's dividend rows, the derivatives module, and half
 * a dozen AI prompt builders (whose symbols the model then narrates). Every
 * fixed surface is pinned here at three levels:
 *
 *   1. Source scans — the dollar-literal shapes that caused the bugs may not
 *      reappear in the fixed files. Files where "$" is EARNED (compare-chart's
 *      USD-normalized series, class-sections' USD futures, portfolio
 *      base-currency narration, AI spend) are deliberately NOT scanned; each
 *      carries a source comment justifying its dollar.
 *   2. Wiring — the currency actually reaches the formatter (source-level
 *      contracts on the exact expressions).
 *   3. Contracts — pure-function behavior for the resolution rules (ADR
 *      reporting currency, class-compare forex rates, statement currency).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classPriceDisplay } from "@/lib/compare/types";
import { statementsCurrency } from "@/lib/format";

const ROOT = join(__dirname, "..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* -------------------------------------------------------------------------- */
/* 1. Source scans                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Files that formerly hardcoded dollars onto non-USD-guaranteed values.
 * Every monetary display in them now routes through lib/format with an
 * explicit currency, so no dollar-literal pattern may exist at all.
 */
const NO_DOLLAR_FILES = [
  // Excel research report + exports
  "app/api/report/route.ts",
  "app/api/export/portfolio/route.ts",
  "app/api/export/watchlist/route.ts",
  "app/api/export/compare/route.ts",
  "app/api/export/compare-class/route.ts",
  // Compare UI (chart component excluded — its dollars label USD-converted series)
  "app/compare/page.tsx",
  "app/compare/_components/class-compare-view.tsx",
  "app/compare/_components/class-sections.ts",
  // Calendar
  "lib/calendar.ts",
  "app/calendar/page.tsx",
  "app/calendar/_components/event-drawer.tsx",
  // Derivatives
  "app/research/derivatives/_components/derivatives-summary-card.tsx",
  "app/research/derivatives/_components/ai-derivatives-insight.tsx",
  // AI prompt builders — the model narrates whatever symbol these print
  "lib/ai/retrieval.ts",
  "lib/analysis-prompt.ts",
  "lib/ai-compare.ts",
  "lib/ai-crypto-research.ts",
  "lib/ai-derivatives-research.ts",
  "lib/ai-calendar-brief.ts",
  "lib/scanner/thesis-builder.ts",
];

const DOLLAR_LITERALS: [RegExp, string][] = [
  [/\$\$\{/, "template literal `$${…}` (dollar glued to an interpolation)"],
  [/>\$\{/, "JSX text `>${…}` (dollar glued to an expression)"],
  [/["'`]\$["'`]/, "bare '$' string literal"],
  [/["']\$#/, "Excel numFmt with a baked-in dollar"],
];

describe("fixed surfaces carry no hardcoded dollar", () => {
  for (const rel of NO_DOLLAR_FILES) {
    it(`${rel} formats through the canonical currency formatters`, () => {
      const source = src(rel);
      for (const [pattern, label] of DOLLAR_LITERALS) {
        expect(pattern.test(source), `${rel} contains ${label}`).toBe(false);
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 2. Wiring contracts                                                        */
/* -------------------------------------------------------------------------- */

describe("Excel research report wires currency end to end", () => {
  const report = src("app/api/report/route.ts");

  it("prices, targets and EPS use the listing currency", () => {
    expect(report).toContain("formatCurrency(q.price, q.currency)");
    expect(report).toContain("formatCurrency(analyst.targetMean, q.currency)");
    expect(report).toContain("formatPerShare(e.epsActual, q.currency)");
    expect(report).toContain("formatCurrency(p.close, q.currency)");
  });

  it("financialData magnitudes use the REPORTING currency (ADR-safe)", () => {
    expect(report).toContain("statementsCurrency(snap?.financialCurrency, q.currency)");
    expect(report).toContain("fMoney(snap?.freeCashflow, finCur)");
  });

  it("the EDGAR statements sheet stays labelled USD — a property of its USD-only source", () => {
    expect(report).toContain('fMoney(x.value, "USD")');
    expect(report).toContain("figures in USD");
  });
});

describe("portfolio export prices each position in its own currency", () => {
  const route = src("app/api/export/portfolio/route.ts");

  it("Excel money cells take the per-row quote currency numFmt", () => {
    expect(route).toContain("excelMoneyFormat(p.quote?.currency)");
  });
  it("mixed-currency books get unlabelled totals plus a disclosure, not a false symbol", () => {
    expect(route).toContain("TOTAL (mixed currencies — unconverted sum)");
    expect(route).toContain("totals are unconverted sums");
  });
});

describe("compare surfaces derive currency from the entry", () => {
  it("compare export prints price and market cap in the entry's listing currency", () => {
    const route = src("app/api/export/compare/route.ts");
    expect(route).toContain("formatCurrency(e.quote.price, e.quote.currency)");
    expect(route).toContain("formatCompactCurrency(e.quote?.marketCap, e.quote?.currency)");
  });

  it("compare page card market cap follows quote.currency", () => {
    expect(src("app/compare/page.tsx")).toContain(
      "formatCompactCurrency(quote.marketCap, quote.currency)",
    );
  });

  it("the market-cap chart mode converts caps with the same FX the price series uses", () => {
    expect(src("app/api/compare-history/route.ts")).toContain("fxToUsd");
    const chart = src("app/compare/_components/compare-chart.tsx");
    expect(chart).toContain("fxToUsd[sym]");
    expect(chart).toContain("mcap * fx");
    expect(chart).toContain("non-USD values converted to USD");
  });
});

describe("calendar dividends carry the listing currency from source to render", () => {
  it("lib/calendar.ts stamps the dividend event with the quote currency", () => {
    const cal = src("lib/calendar.ts");
    expect(cal).toContain("currency?: string");
    expect(cal).toContain("currency: (pr.currency as string | undefined)");
  });
  it("both renderers and the AI brief format through formatPerShare", () => {
    expect(src("app/calendar/page.tsx")).toContain("formatPerShare(ev.dividendAmount, ev.currency, 4)");
    expect(src("app/calendar/_components/event-drawer.tsx")).toContain(
      "formatPerShare(event.dividendAmount, event.currency, 4)",
    );
    expect(src("lib/ai-calendar-brief.ts")).toContain("formatPerShare(e.epsEstimate, e.estimateCurrency)");
  });
});

describe("AI context builders label money with its own currency", () => {
  it("retrieval blocks use listing currency for quote-scale and reporting currency for financials", () => {
    const retrieval = src("lib/ai/retrieval.ts");
    expect(retrieval).toContain("statementsCurrency(ctx.snapshot?.financialCurrency, cur)");
    expect(retrieval).toContain("formatCompactCurrency(q.marketCap, cur)");
    expect(retrieval).toContain("formatCompactCurrency(s.totalCash, finCur)");
    expect(retrieval).not.toContain("formatMarketCap(");
  });
  it("derivatives prompts thread the underlying's currency", () => {
    expect(src("lib/ai-derivatives-research.ts")).toContain(
      "derivativesDataBlock(underlyingName, summary, currency ?? null)",
    );
    expect(src("app/api/derivatives/route.ts")).toContain("currency: typeof body.currency === \"string\"");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Behavioral contracts                                                    */
/* -------------------------------------------------------------------------- */

describe("classPriceDisplay", () => {
  it("labels USD-by-construction class prices as dollars", () => {
    expect(classPriceDisplay("etf", 412.33)).toBe("$412.33");
    expect(classPriceDisplay("commodity", 2650.4)).toBe("$2,650.40");
    expect(classPriceDisplay("crypto", 67123.55)).toBe("$67,123.55");
  });
  it("renders forex rates bare at FX precision — a USDJPY rate is not dollars", () => {
    expect(classPriceDisplay("forex", 147.3215)).toBe("147.3215");
    expect(classPriceDisplay("forex", 1.0842)).toBe("1.0842");
    expect(classPriceDisplay("forex", 147.3215)).not.toContain("$");
  });
});

describe("ADR-class securities (USD listing, foreign reporting currency)", () => {
  it("statement magnitudes resolve to the reporting currency, quote values to the listing currency", () => {
    // TSM: trades in USD, reports in TWD.
    const listing = "USD";
    const financial = "TWD";
    expect(statementsCurrency(financial, listing)).toBe("TWD");
    // A non-ADR keeps its single currency through both paths.
    expect(statementsCurrency(null, "JPY")).toBe("JPY");
    expect(statementsCurrency(undefined, "INR")).toBe("INR");
  });
});
