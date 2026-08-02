import { describe, expect, it } from "vitest";
import { reportToMarkdown, reportUtcDate } from "@/lib/ic/export-markdown";
import { makeReport, makeBlockedReport } from "./ic-export-fixture";

describe("reportToMarkdown", () => {
  it("renders the symbol, company and header metadata", () => {
    const md = reportToMarkdown(makeReport());
    expect(md).toContain("TESTCO");
    expect(md).toContain("Test Company Inc");
    expect(md).toContain("test-model-7b");
    expect(md).toContain("agents: agents-2");
    expect(md).toContain("2026-08-01"); // UTC date from generatedAt
  });

  it("derives the UTC date from generatedAt, not local time", () => {
    // 23:30 UTC would already be the next day in IST — the slice must stay UTC.
    expect(reportUtcDate("2026-08-01T23:30:00.000Z")).toBe("2026-08-01");
  });

  it("includes signal-check rows for non-fired and not-evaluable checks", () => {
    const md = reportToMarkdown(makeReport());
    expect(md).toContain("Debt increase");
    expect(md).toContain("Passed");
    expect(md).toContain("Insider selling");
    expect(md).toContain("Not evaluable");
    expect(md).toContain("no insider transaction data reported for this name");
    // threshold + evidence columns are present
    expect(md).toContain("fires when net debt grows more than 40% year over year");
    expect(md).toContain("insider transactions, trailing 6 months");
  });

  it("renders the sensitivity grid values", () => {
    const md = reportToMarkdown(makeReport());
    expect(md).toContain("$111.11");
    expect(md).toContain("$156.30");
    expect(md).toContain("n/a (g >= WACC)");
  });

  it("renders explicit not-available statements for missing sections", () => {
    const md = reportToMarkdown(
      makeReport({ synthesis: null, historyStats: null, agentFindings: [], monitorables: [] }),
    );
    expect(md).toContain("synthesis was not run");
    expect(md).toContain("insufficient price history");
    expect(md).toContain("no agent findings");
    expect(md).toContain("no monitorables recorded");
    expect(md.toLowerCase()).toContain("not available");
  });

  it("renders a blocked valuation loudly instead of numbers", () => {
    const md = reportToMarkdown(makeBlockedReport());
    expect(md).toContain("valuation blocked");
    expect(md).toContain("terminal growth < WACC");
    expect(md).toContain("Blocking violations");
  });

  it("contains exactly one disclaimer", () => {
    const md = reportToMarkdown(makeReport());
    expect(md.match(/disclaimer/gi)?.length ?? 0).toBe(1);
  });

  it("never leaks undefined/null/[object Object]", () => {
    for (const report of [makeReport(), makeBlockedReport(), makeReport({ synthesis: null, historyStats: null })]) {
      const md = reportToMarkdown(report);
      expect(md).not.toContain("undefined");
      expect(md).not.toContain("null");
      expect(md).not.toContain("[object Object]");
      expect(md).not.toContain("NaN");
    }
  });

  it("formats INR with the rupee symbol and Indian compact units", () => {
    const md = reportToMarkdown(makeReport({ currency: "INR" }));
    expect(md).toContain("₹");
    expect(md).toContain("Cr"); // market cap in crore
  });
});
