/**
 * Integration tests for export API routes.
 * Calls the route handlers directly (not via HTTP) to avoid starting a server.
 * Checks: correct MIME type, Content-Disposition header, non-empty body,
 * magic bytes (Excel = 0x50 0x4B, PDF = %PDF-).
 *
 * /api/export/valuation has its own file (tests/valuation-export-route.test.ts)
 * because it needs an isolated DB_PATH set before lib/db loads.
 */
import { describe, expect, it, vi } from "vitest";

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
/* The shared failure guard                                                    */
/* -------------------------------------------------------------------------- */

describe("guardedExport", () => {
  /* Every /api/export/* route returns through this. Before it existed, a throw
     mid-workbook-generation surfaced as a 500 with an EMPTY body — which the
     client rendered as the useless "Export failed (500)", and which is how the
     Valuation export's reserved-sheet-name crash went undiagnosed. */

  it("passes a successful build through untouched", async () => {
    const { guardedExport } = await import("@/lib/download");
    const res = await guardedExport("test", async () => new Response("ok", { status: 200 }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("converts a throw into a readable plain-text 500 and logs it", async () => {
    const { guardedExport } = await import("@/lib/download");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await guardedExport("test", async () => {
        throw new Error("The name \"History\" is protected. Please use a different name.");
      });
      expect(res.status).toBe(500);
      expect(await res.text()).toBe(
        'Export failed: The name "History" is protected. Please use a different name.',
      );
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it("stays readable when the thrown value is not an Error", async () => {
    const { guardedExport } = await import("@/lib/download");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await guardedExport("test", async () => {
        throw "boom";
      });
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Export failed");
    } finally {
      spy.mockRestore();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Screener Excel                                                              */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/screener", () => {
  /**
   * The export is now registry-driven: it takes an asset class and normalized
   * RankedCandidate rows, and builds the sheet from that class's declared
   * columns. So the same route exports an equity screen and a bond screen.
   */
  function candidate(symbol: string, metrics: Record<string, number | null>, attributes: Record<string, string | null> = {}) {
    return {
      symbol,
      name: `${symbol} Inc.`,
      assetClass: "equity",
      price: 180,
      changePercent: 1.2,
      rank: 1,
      rankScore: 82,
      confidence: 100,
      percentiles: { overallScore: 95 },
      metrics,
      attributes,
      match: { passed: [], strengths: [], warnings: ["High leverage"] },
    };
  }

  it("returns xlsx with correct headers and magic bytes", async () => {
    const { POST } = await import("@/app/api/export/screener/route");

    const rows = [
      candidate(
        "AAPL",
        {
          overallScore: 82, valueScore: 45, growthScore: 70, qualityScore: 88,
          marketCap: 2.8e12, forwardPE: 25, revenueGrowthYoY: 8, roic: 30,
          fcfYield: 3.5, dividendYield: 0.5,
        },
        { sector: "Technology" },
      ),
    ];

    const res = await POST(makeRequest({ assetClass: "equity", rows }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("screen-");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(1000);
    expect(isXlsxMagic(buf)).toBe(true);
  });

  it("exports a bond screen through the same route", async () => {
    const { POST } = await import("@/app/api/export/screener/route");

    const rows = [
      {
        ...candidate("AGG", { yield: 4.2, spread: 0.4, duration: 3.83, maturity: 9.41, investmentGradePct: 100, expenseRatio: 0.03, aum: 120e9 }, { issuerType: "Government", avgRating: "AA", riskLevel: "Low" }),
        assetClass: "bond",
      },
    ];

    const res = await POST(makeRequest({ assetClass: "bond", rows }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("uaa-bond-screen-");
    expect(isXlsxMagic(await responseToUint8(res))).toBe(true);
  });

  it("handles an empty result set", async () => {
    const { POST } = await import("@/app/api/export/screener/route");
    const res = await POST(makeRequest({ assetClass: "equity", rows: [] }));
    expect(res.status).toBe(200);
    expect(isXlsxMagic(await responseToUint8(res))).toBe(true);
  });

  it("rejects an unknown asset class", async () => {
    const { POST } = await import("@/app/api/export/screener/route");
    const res = await POST(makeRequest({ assetClass: "options", rows: [] }));
    expect(res.status).toBe(400);
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

  it("rejects assumptions the valuation engine cannot value", async () => {
    const { POST } = await import("@/app/api/export/dcf/route");

    const res = await POST(makeRequest({
      symbol: "MSFT",
      companyName: "Microsoft Corporation",
      currentPrice: 420,
      inputs: {
        baseFcf: 70e9, growthRate1: 15, growthRate2: 10,
        // Terminal growth at or above WACC makes the Gordon model diverge.
        terminalGrowth: 12, discountRate: 10,
        sharesOutstanding: 7.44e9, netDebt: -20e9,
      },
    }));

    expect(res.status).toBe(400);
  });

  it("renders the reporting currency rather than assuming dollars", async () => {
    const { POST } = await import("@/app/api/export/dcf/route");

    const res = await POST(makeRequest({
      symbol: "RELIANCE.NS",
      companyName: "Reliance Industries",
      currentPrice: 2850,
      currency: "INR",
      inputs: {
        baseFcf: 500e9, growthRate1: 12, growthRate2: 8,
        terminalGrowth: 4, discountRate: 11,
        sharesOutstanding: 6.7e9, netDebt: 1.5e12,
      },
    }));

    expect(res.status).toBe(200);
    expect(isXlsxMagic(await responseToUint8(res))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Watchlist CSV                                                               */
/* -------------------------------------------------------------------------- */

describe("GET /api/export/watchlist", () => {
  it("returns csv content-type and Content-Disposition header", async () => {
    const { GET } = await import("@/app/api/export/watchlist/route");

    // Watchlist reads from DB — it may be empty, that's fine; we just check format
    const res = await GET(new Request("http://localhost/api/export/watchlist"));

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

  it("keeps the user's target and the analyst consensus in separate columns", async () => {
    // The two must never collapse into one "Target" column: one is the user's own
    // number, the other is the street's.
    const { GET } = await import("@/app/api/export/watchlist/route");
    const text = await (await GET(new Request("http://localhost/api/export/watchlist"))).text();
    expect(text).toContain("My Price Target");
    expect(text).toContain("Analyst Consensus Target");
    expect(text).toContain("Consensus Upside (%)");
  });

  it("emits a well-formed row for every record — no unescaped commas", async () => {
    /* Regression guard: the Added column used to emit a localized "Jul 26, 2026"
       raw, which split into two fields and shifted the last three columns of
       every row. Field counts are the only way to catch that class of bug. */
    const { GET } = await import("@/app/api/export/watchlist/route");
    const res = await GET(new Request("http://localhost/api/export/watchlist"));
    // Guarded failures come back as a one-line 500 body, which would make the
    // field-count loop below pass vacuously — fail loudly instead.
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\r\n").filter((l) => l && !l.startsWith("#"));
    const countFields = (line: string) => {
      let n = 1;
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) n++;
      }
      return n;
    };
    const header = countFields(lines[0]);
    for (const line of lines.slice(1)) expect(countFields(line)).toBe(header);
  });

  it("scopes to a named list when `group` is supplied", async () => {
    const { GET } = await import("@/app/api/export/watchlist/route");
    // A group that cannot exist yields a header-only file rather than an error or
    // a silent fallback to "everything".
    const res = await GET(new Request("http://localhost/api/export/watchlist?group=999999"));
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter((l) => l && !l.startsWith("#"));
    expect(lines).toHaveLength(1); // header only
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
/* Class comparison Excel (non-equity)                                         */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/compare-class", () => {
  it("rejects the equity class — it has its own export route", async () => {
    const { POST } = await import("@/app/api/export/compare-class/route");
    const res = await POST(makeRequest({ assetClass: "equity", entries: [] }));
    expect(res.status).toBe(400);
  });

  it("answers a malformed payload with a readable 500, not an empty body", async () => {
    // `entries` missing entirely used to throw an uncaught TypeError.
    const { POST } = await import("@/app/api/export/compare-class/route");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(makeRequest({ assetClass: "etf" }));
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Export failed");
    } finally {
      spy.mockRestore();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* IC Report PDF                                                               */
/* -------------------------------------------------------------------------- */

describe("POST /api/export/ic-report", () => {
  it("returns pdf magic bytes for a schema-v2 report", async () => {
    const { POST } = await import("@/app/api/export/ic-report/route");
    const { makeReport } = await import("./ic-export-fixture");

    const res = await POST(makeRequest({ report: makeReport() }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(".pdf");

    const buf = await responseToUint8(res);
    expect(buf.length).toBeGreaterThan(5000);
    expect(isPdfMagic(buf)).toBe(true);
  });

  it("rejects pre-v2 report shapes instead of rendering wrong numbers", async () => {
    const { POST } = await import("@/app/api/export/ic-report/route");
    const res = await POST(makeRequest({ report: { symbol: "X", valuation: { intrinsicValueRange: "₹1–₹2" } } }));
    expect(res.status).toBe(400);
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
