import { describe, expect, it } from "vitest";
import { reportToPdf } from "@/lib/ic/export-pdf";
import { makeReport, makeBlockedReport } from "./ic-export-fixture";

describe("reportToPdf", () => {
  it("produces a valid PDF buffer of substance", async () => {
    const buf = await reportToPdf(makeReport());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(10 * 1024);
  });

  it("does not throw for a report with no agent findings", async () => {
    const buf = await reportToPdf(makeReport({ agentFindings: [], synthesis: null }));
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("does not throw for a null historyStats", async () => {
    const buf = await reportToPdf(makeReport({ historyStats: null }));
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("does not throw for a blocked valuation (headline null, blocking violations present)", async () => {
    const report = makeBlockedReport();
    expect(report.valuation.headline).toBeNull();
    expect(report.valuation.blockingViolations.length).toBeGreaterThan(0);
    const buf = await reportToPdf(report);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(10 * 1024);
  });

  it("handles the INR currency without falling back to WinAnsi-unsafe output", async () => {
    const buf = await reportToPdf(makeReport({ currency: "INR" }));
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
