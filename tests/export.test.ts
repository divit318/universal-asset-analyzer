/**
 * Integration tests for export API routes.
 * Calls the route handlers directly (not via HTTP) to avoid starting a server.
 * Checks: correct MIME type, Content-Disposition header, non-empty body,
 * magic bytes (Excel = 0x50 0x4B, PDF = %PDF-).
 */
import { describe, expect, it } from "vitest";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function makeRequest(body?: unknown): Request {
  if (body == null) return new Request("http://localhost/");
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(url = "http://localhost/"): Request {
  return new Request(url);
}

function isPdfMagic(buf: Uint8Array): boolean {
  return (
    buf[0] === 0x25 && // %
    buf[1] === 0x50 && // P
    buf[2] === 0x44 && // D
    buf[3] === 0x46    // F
  );
}

function isXlsxMagic(buf: Uint8Array): boolean {
  return (
    buf[0] === 0x50 && // P
    buf[1] === 0x4b && // K
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
  );
}

async function responseToUint8(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

/* -------------------------------------------------------------------------- */
/* Screener Excel                                                              */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/screener", () => {
  it("returns xlsx with correct headers and magic bytes", async () => {
    const { POST } = await import("@/app/api/export/screener/route");

    const rows = [
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        sector: "Technology",
        industry: "Consumer Electronics",
        price: 180,
        changePercent: 1.2,
        marketCap: 2.8e12,
        peRatio: 28,
        forwardPE: 25,
        pegRatio: 1.2,
        priceToBook: 45,
        evToEbitda: 20,
        revenueGrowth: 8,
        earningsGrowth: 12,
        grossMargin: 43,
        netMargin: 25,
        operatingMargin: 30,
        returnOnEquity: 160,
        returnOnAssets: 22,
        debtToEquity: 1.5,
        currentRatio: 0.94,
        fcfYield: 3.5,
        dividendYield: 0.5,
        payoutRatio: 15,
        volume: 55e6,
        fiftyTwoWeekHigh: 200,
        fiftyTwoWeekLow: 130,
        analystUpside: 12,
        scores: {
          overall: 82,
          value: 45,
          growth: 70,
          quality: 88,
          momentum: 75,
          financialHealth: 60,
        },
      },
    ];

    const res = await POST(makeRequest({ rows }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("screener-");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(1000);
    expect(isXlsxMagic(buf)).toBe(true);
  });

  it("handles empty rows array", async () => {
    const { POST } = await import("@/app/api/export/screener/route");
    const res = await POST(makeRequest({ rows: [] }));
    expect(res.status).toBe(200);
    const buf = await responseToUint8(res);
    expect(isXlsxMagic(buf)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* DCF Excel                                                                   */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/dcf", () => {
  it("returns xlsx with correct headers and magic bytes", async () => {
    const { POST } = await import("@/app/api/export/dcf/route");

    const payload = {
      symbol: "MSFT",
      companyName: "Microsoft Corporation",
      currentPrice: 420,
      inputs: {
        baseFcf: 70e9,
        growthRate1: 15,
        growthRate2: 10,
        terminalGrowth: 3,
        discountRate: 10,
        sharesOutstanding: 7.44e9,
        netDebt: -20e9,
      },
      scenarios: { bear: 340, base: 460, bull: 590 },
      sensitivity: [
        [300, 320, 340, 360, 380, 400, 420],
        [330, 350, 370, 390, 410, 430, 450],
        [360, 380, 400, 420, 440, 460, 480],
        [390, 410, 430, 450, 470, 490, 510],
        [420, 440, 460, 480, 500, 520, 540],
        [450, 470, 490, 510, 530, 550, 570],
        [480, 500, 520, 540, 560, 580, 600],
      ],
      waccRange: [7, 8, 9, 10, 11, 12, 13],
      tgRange: [1, 1.5, 2, 2.5, 3, 3.5, 4],
    };

    const res = await POST(makeRequest(payload));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("MSFT");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(1000);
    expect(isXlsxMagic(buf)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Watchlist CSV                                                               */
/* -------------------------------------------------------------------------- */

describe("GET /api/export/watchlist", () => {
  it("returns csv content-type and Content-Disposition header", async () => {
    const { GET } = await import("@/app/api/export/watchlist/route");

    // Watchlist reads from DB — it may be empty, that's fine; we just check format
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("watchlist-");
    expect(res.headers.get("Content-Disposition")).toContain(".csv");

    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    // Should have the CSV header row
    expect(text).toContain("Symbol");
    expect(text).toContain("Company Name");
  });
});

/* -------------------------------------------------------------------------- */
/* Portfolio Excel                                                             */
/* -------------------------------------------------------------------------- */

describe("GET /api/export/portfolio?format=excel", () => {
  it("returns xlsx magic bytes", async () => {
    const { GET } = await import("@/app/api/export/portfolio/route");

    const res = await GET(new Request("http://localhost/?format=excel"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(1000);
    expect(isXlsxMagic(buf)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Compare PDF                                                                 */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/compare", () => {
  it("returns xlsx magic bytes for two entries", async () => {
    const { POST } = await import("@/app/api/export/compare/route");

    const entries = [
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        quote: { symbol: "AAPL", name: "Apple Inc.", price: 180, change: 1.5, changePercent: 0.84, marketCap: 2.8e12, volume: 55e6, fiftyTwoWeekHigh: 200, fiftyTwoWeekLow: 130 },
        snapshot: {
          forwardPE: 25, trailingPE: 28, pegRatio: 1.2, priceToBook: 45,
          returnOnEquity: 1.6, returnOnAssets: 0.22, grossMargins: 0.43,
          operatingMargins: 0.30, profitMargins: 0.25, revenueGrowth: 0.08,
          earningsGrowth: 0.12, debtToEquity: 150, currentRatio: 0.94,
        },
        score: { total: 82, composite: 80, recommendation: "buy" },
        fcfYieldPct: 3.5,
        netDebtToEbitda: -0.5,
        oneYearReturn: 28,
        momentum: { vsSma200: 15, return3m: 8, pctFrom52WkHigh: -10 },
        analyst: { upsidePercent: 12 },
      },
      {
        symbol: "MSFT",
        name: "Microsoft Corp.",
        quote: { symbol: "MSFT", name: "Microsoft Corp.", price: 420, change: 2.1, changePercent: 0.50, marketCap: 3.1e12, volume: 20e6, fiftyTwoWeekHigh: 450, fiftyTwoWeekLow: 310 },
        snapshot: {
          forwardPE: 32, trailingPE: 36, pegRatio: 1.8, priceToBook: 12,
          returnOnEquity: 0.45, returnOnAssets: 0.18, grossMargins: 0.68,
          operatingMargins: 0.42, profitMargins: 0.36, revenueGrowth: 0.17,
          earningsGrowth: 0.20, debtToEquity: 40, currentRatio: 1.8,
        },
        score: { total: 88, composite: 86, recommendation: "strong_buy" },
        fcfYieldPct: 2.8,
        netDebtToEbitda: -2.1,
        oneYearReturn: 35,
        momentum: { vsSma200: 20, return3m: 12, pctFrom52WkHigh: -5 },
        analyst: { upsidePercent: 8 },
      },
    ];

    const res = await POST(makeRequest({ entries }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("AAPL-MSFT");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(1000);
    expect(isXlsxMagic(buf)).toBe(true);
  });

  it("includes ai verdict and returns valid xlsx", async () => {
    const { POST } = await import("@/app/api/export/compare/route");
    const entries = [
      { symbol: "TSLA", name: "Tesla Inc.", quote: { symbol: "TSLA", name: "Tesla", price: 250, change: 0, changePercent: 0, marketCap: 800e9, volume: 100e6, fiftyTwoWeekHigh: 300, fiftyTwoWeekLow: 150 } },
    ];
    const res = await POST(makeRequest({ entries, aiVerdict: "TSLA shows strong growth but high valuation." }));
    expect(res.status).toBe(200);
    const buf = await responseToUint8(res);
    expect(isXlsxMagic(buf)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* IC Report PDF                                                               */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/ic-report", () => {
  it("returns pdf magic bytes for a full report", async () => {
    const { POST } = await import("@/app/api/export/ic-report/route");

    const report = {
      symbol: "RELIANCE",
      companyName: "Reliance Industries Ltd.",
      generatedAt: new Date().toISOString(),
      model: "llama3.2",
      questions: ["What is the revenue growth?", "How is the debt?"],
      signals: [
        { id: "s1", category: "growth", severity: "low" as const, description: "Accelerating revenue growth YoY" },
        { id: "s2", category: "debt", severity: "medium" as const, description: "Net debt elevated but manageable" },
      ],
      agentFindings: [
        {
          agent: "fundamental",
          agentLabel: "Fundamental Analyst",
          questionsAnswered: 3,
          findings: "Strong operating cash flow generation. Margins expanding.",
          keyInsights: ["Revenue CAGR of 15% over 3Y", "Operating leverage kicking in"],
          confidence: "high" as const,
          dataLimitations: null,
        },
      ],
      thesis: {
        bull: "Jio and retail are secular growth engines with multi-year runway.",
        bear: "Refining margins may compress under global oil oversupply.",
        base: "Double-digit earnings growth likely over 3–5 years.",
        variantPerception: "Market underappreciating Jio's platform economics.",
        keyCatalysts: ["Jio IPO monetisation", "Green energy capex returns"],
        keyRisks: ["Crude oil price volatility", "Regulatory changes in telecom"],
      },
      valuation: {
        currentPrice: "₹2,850",
        intrinsicValueRange: "₹3,100–₹3,500",
        impliedUpside: "+12% to +23%",
        approaches: [
          { method: "DCF", priceTarget: "₹3,300", impliedUpside: "+16%", assumptions: "WACC 10%, TGR 4%", confidence: "Medium" },
        ],
        scenarios: [],
        valuationVerdict: "Trading at a moderate discount to intrinsic value. Attractive entry.",
      },
      monitorables: [
        "Jio ARPU quarterly trend",
        "Refining gross margin vs Singapore complex",
        "New energy capex deployment timeline",
      ],
      runHotCold: {
        oneYearReturn: 22.4,
        medianReturn: 18.1,
        percentile: 62,
        signal: "neutral" as const,
      },
    };

    const res = await POST(makeRequest({ report }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("RELIANCE");
    expect(res.headers.get("Content-Disposition")).toContain(".pdf");

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(5000);
    expect(isPdfMagic(buf)).toBe(true);
  });

  it("returns 400 for missing report", async () => {
    const { POST } = await import("@/app/api/export/ic-report/route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */
/* Quant Engine Excel                                                          */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/engine", () => {
  it("returns xlsx magic bytes with scorecard rows", async () => {
    const { POST } = await import("@/app/api/export/engine/route");

    const rows = [
      {
        symbol: "INFY",
        date: new Date().toISOString().slice(0, 10),
        name: "Infosys Ltd",
        sector: "Technology",
        momentum_score: 72,
        quality_score: 80,
        value_score: 65,
        low_vol_score: 70,
        revision_score: 55,
        regime_score: 68,
        forecast_score: 74,
        mc_upside: 18.5,
        kelly_fraction: 6.2,
        composite_score: 71.4,
        signal: "Buy",
        confidence: 72,
      },
      {
        symbol: "TCS",
        date: new Date().toISOString().slice(0, 10),
        name: "Tata Consultancy Services",
        sector: "Technology",
        momentum_score: 85,
        quality_score: 90,
        value_score: 50,
        low_vol_score: 80,
        revision_score: 70,
        regime_score: 75,
        forecast_score: 82,
        mc_upside: 22.1,
        kelly_fraction: 8.4,
        composite_score: 79.1,
        signal: "Strong Buy",
        confidence: 84,
      },
    ];

    const res = await POST(makeRequest({ rows }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("quant-engine");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(1000);
    expect(isXlsxMagic(buf)).toBe(true);
  });

  it("handles empty rows", async () => {
    const { POST } = await import("@/app/api/export/engine/route");
    const res = await POST(makeRequest({ rows: [] }));
    expect(res.status).toBe(200);
    const buf = await responseToUint8(res);
    expect(isXlsxMagic(buf)).toBe(true);
  });
});
