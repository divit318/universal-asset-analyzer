/**
 * POST /api/export/valuation — the Valuation workspace's "Export case" button.
 *
 * This route shipped without a test and was broken from day one: its history
 * sheet was named "History", which the XLSX spec reserves for Excel's own
 * change-tracking log, so ExcelJS threw on every request and the button
 * appeared to do nothing (empty 500). These tests parse the workbook back and
 * pin down the content, so neither the reserved-name crash nor a stale-case
 * export can ship silently again.
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db; VALUATION_PRIORS_PATH points at nothing so the real
 * engine prior can't leak rows into the assertions.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-valuation-export-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.VALUATION_PRIORS_PATH = path.join(tmpDir, "no-priors.json");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// One symbol ("BOOM") gets a synthetic mid-generation failure so the
// guardedExport path — readable 500 body instead of an empty one — is covered.
vi.mock("../lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/db")>();
  return {
    ...actual,
    listValuationEvents: (symbol: string, limit?: number) => {
      if (symbol === "BOOM") throw new Error("synthetic history failure");
      return actual.listValuationEvents(symbol, limit);
    },
  };
});

const { appendValuationEvent } = await import("../lib/db");
const { applyUserEdits, assumptionsToDcf, computeCaseResult, seedAssumptions } =
  await import("../lib/valuation/case");
const { buildScenarios } = await import("../lib/valuation/dcf");
const { POST } = await import("../app/api/export/valuation/route");

const SEED = {
  baseFcf: 100e9,
  sharesOutstanding: 15e9,
  netDebt: -50e9,
  price: 232,
  discountRate: 9,
  terminalGrowth: 2.5,
  deliveredGrowth: 8.1,
};

function seed(symbol: string, overrides: Partial<typeof SEED> = {}) {
  const assumptions = seedAssumptions({ ...SEED, ...overrides });
  return appendValuationEvent({
    symbol,
    currency: "USD",
    author: "reverse",
    kind: "seeded",
    assumptions,
    result: computeCaseResult(assumptions, SEED.price),
    priceAt: SEED.price,
    triggerSource: "first_read",
  });
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/export/valuation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function isXlsxMagic(buf: Uint8Array): boolean {
  return buf[0] === 0x50 && buf[1] === 0x4b;
}

async function loadWorkbook(res: Response): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}

/** label → value map from a two-column kv sheet ("Valuation Case"). */
function kvMap(ws: ExcelJS.Worksheet): Map<string, ExcelJS.CellValue> {
  const map = new Map<string, ExcelJS.CellValue>();
  ws.eachRow((row) => {
    const label = row.getCell(1).value;
    if (typeof label === "string" && label) map.set(label, row.getCell(2).value);
  });
  return map;
}

describe("POST /api/export/valuation", () => {
  it("exports the persisted case as a valid workbook with the expected headers", async () => {
    seed("AAPL");
    const res = await POST(makeRequest({ symbol: "AAPL" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("valuation-AAPL-");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");

    const buf = new Uint8Array(await res.clone().arrayBuffer());
    expect(buf.length).toBeGreaterThan(1000);
    expect(isXlsxMagic(buf)).toBe(true);
  });

  it("never names a sheet with the XLSX-reserved word 'History'", async () => {
    // Regression: wb.addWorksheet("History") throws in ExcelJS because the
    // spec reserves that exact name for change tracking. That single call
    // 500'd the whole route and made the Export case button appear dead.
    seed("MSFT");
    const wb = await loadWorkbook(await POST(makeRequest({ symbol: "MSFT" })));

    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toEqual(["Valuation Case", "Assumptions", "Version History", "Model"]);
    expect(names).not.toContain("History");
  });

  it("exports the case's actual assumptions with provenance, not placeholders", async () => {
    seed("GOOG");
    const wb = await loadWorkbook(await POST(makeRequest({ symbol: "GOOG" })));

    const ws = wb.getWorksheet("Assumptions")!;
    const rows = new Map<string, { value: ExcelJS.CellValue; source: ExcelJS.CellValue }>();
    ws.eachRow((row) => {
      const label = row.getCell(1).value;
      if (typeof label === "string") {
        rows.set(label, { value: row.getCell(2).value, source: row.getCell(3).value });
      }
    });

    // Rates are written as fractions so Excel's 0.0% format renders them.
    expect(rows.get("FCF growth Y1–5")?.value).toBeCloseTo(0.081, 10);
    expect(rows.get("FCF growth Y1–5")?.source).toBe("Reported history");
    expect(rows.get("WACC")?.value).toBeCloseTo(0.09, 10);
    expect(rows.get("Terminal growth")?.value).toBeCloseTo(0.025, 10);
    expect(rows.get("Trailing FCF")?.value).toBe(100e9);
    expect(rows.get("Shares outstanding")?.value).toBe(15e9);
    expect(rows.get("Net debt")?.value).toBe(-50e9);
  });

  it("exports the latest version after an edit — not the stale original", async () => {
    const first = seed("NVDA");
    const edited = applyUserEdits(first.assumptions, [
      { key: "growthRate1", value: 7, rationale: "Decelerating." },
    ]);
    appendValuationEvent({
      symbol: "NVDA",
      currency: "USD",
      author: "user",
      kind: "assumption_changed",
      assumptions: edited,
      result: computeCaseResult(edited, SEED.price),
      priceAt: SEED.price,
    });

    const wb = await loadWorkbook(await POST(makeRequest({ symbol: "NVDA" })));

    expect(kvMap(wb.getWorksheet("Valuation Case")!).get("Version")).toBe("v2");

    let growthCell: ExcelJS.CellValue = null;
    wb.getWorksheet("Assumptions")!.eachRow((row) => {
      if (row.getCell(1).value === "FCF growth Y1–5") growthCell = row.getCell(2).value;
    });
    expect(growthCell).toBeCloseTo(0.07, 10);

    // Both versions in the log, newest first, with the change spelled out.
    const versions: string[] = [];
    wb.getWorksheet("Version History")!.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === "string" && /^v\d+$/.test(v)) versions.push(v);
    });
    expect(versions).toEqual(["v2", "v1"]);
  });

  it("writes Bear/Base/Bull rows that match the shared DCF engine for this case", async () => {
    const saved = seed("AMZN");
    const wb = await loadWorkbook(await POST(makeRequest({ symbol: "AMZN" })));

    const expected = buildScenarios(assumptionsToDcf(saved.assumptions));
    const found = new Map<string, ExcelJS.CellValue>();
    wb.getWorksheet("Model")!.eachRow((row) => {
      const label = row.getCell(1).value;
      if (label === "Bear" || label === "Base" || label === "Bull") {
        found.set(label, row.getCell(2).value);
      }
    });

    expect(found.get("Bear")).toBeCloseTo(expected.bear.fairValuePerShare!, 6);
    expect(found.get("Base")).toBeCloseTo(expected.base.fairValuePerShare!, 6);
    expect(found.get("Bull")).toBeCloseTo(expected.bull.fairValuePerShare!, 6);

    // The bridge from projection to per-share value, straight off the engine.
    const bridge = kvMap(wb.getWorksheet("Model")!);
    expect(bridge.get("Enterprise value")).toBeCloseTo(expected.base.enterpriseValue, 6);
    expect(bridge.get("Less: net debt")).toBe(-50e9);
    expect(bridge.get("Equity value")).toBeCloseTo(expected.base.equityValue, 6);
    expect(bridge.get("→ Fair value per share")).toBeCloseTo(expected.base.fairValuePerShare!, 6);
  });

  it("still exports a case whose assumptions are not currently computable", async () => {
    // WACC at or below terminal growth: the Gordon model diverges, fair value
    // is null — the file must still say so rather than the route failing.
    seed("DIS", { discountRate: 2, terminalGrowth: 2.5 });
    const res = await POST(makeRequest({ symbol: "DIS" }));

    expect(res.status).toBe(200);
    const wb = await loadWorkbook(res);
    const kv = kvMap(wb.getWorksheet("Valuation Case")!);
    expect(kv.get("Fair value per share")).toBe("not computable");
    expect(kv.get("Not computable because")).toBe("wacc_below_terminal_growth");
  });

  it("404s for a symbol with no case, naming the symbol", async () => {
    const res = await POST(makeRequest({ symbol: "ZZZZ" }));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("ZZZZ");
  });

  it("400s for an invalid symbol and for invalid JSON", async () => {
    expect((await POST(makeRequest({ symbol: "$$$" }))).status).toBe(400);
    expect((await POST(makeRequest("{not json"))).status).toBe(400);
  });

  it("answers a mid-generation failure with a readable 500 body, not an empty one", async () => {
    seed("BOOM");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(makeRequest({ symbol: "BOOM" }));
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Export failed: synthetic history failure");
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
