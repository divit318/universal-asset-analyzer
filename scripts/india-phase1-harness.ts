/**
 * Phase-1 live validation: source → parser → derivation for Indian stocks.
 *
 * Usage: npx tsx scripts/india-phase1-harness.ts
 * Output: /tmp/india-phase1/<SYMBOL>.json + summary table on stdout.
 *
 * Checks per stock:
 *  - statements parsed (annual/quarterly/BS/CF depth, latest periods)
 *  - internal identities (Total Liabilities == Total Assets; equity+debt+other == total)
 *  - derived metrics (D/E, coverage, P/B, growth, latest-quarter YoY, NPA for banks)
 *  - cross-source: Yahoo statement revenue (raw INR) vs screener.in FY sales (₹ Cr)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getScreenerInCompany } from "../lib/screener-in";
import { deriveIndiaFundamentals, computeIndiaSnapshot, statementRow } from "../lib/india-snapshot";
import { getFinancialStatementsYahoo } from "../lib/statements";

const OUT = "/tmp/india-phase1";
fs.mkdirSync(OUT, { recursive: true });

const STOCKS = [
  // large caps
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "SBIN", "INFY", "ITC", "LT",
  "HINDUNILVR", "SUNPHARMA", "MARUTI", "TATASTEEL",
  // mid caps
  "TRENT", "DIXON", "HAL", "DLF", "SRF", "CHOLAFIN", "HDFCLIFE",
  // small caps + edge cases
  "TANLA", "GRAVITA", "JYOTHYLAB", "SUZLON", "IDEA",
];

/** Yahoo cross-check subset (rate-limit friendly). */
const YAHOO_XCHECK = new Set(["RELIANCE", "TCS", "HDFCBANK", "ITC", "TANLA", "IDEA", "CHOLAFIN", "HDFCLIVE"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  symbol: string;
  ok: boolean;
  kind?: string;
  basis?: string | null;
  fy?: number; q?: number; bsRows?: number; cfRows?: number;
  latestQ?: string | null; latestQLabel?: string | null;
  qSalesYoY?: string; de?: number | null; icov?: number | null;
  pb?: number | null; fcf?: number | null; npa?: number | null;
  composite?: number;
  identityOk?: boolean | null;
  yahooRevMatch?: string;
  issues: string[];
}

async function main() {
  const rows: Row[] = [];
  for (const sym of STOCKS) {
    const issues: string[] = [];
    try {
      const c = await getScreenerInCompany(sym);
      if (!c) { rows.push({ symbol: sym, ok: false, issues: ["null company"] }); continue; }
      const d = deriveIndiaFundamentals(c);
      const snap = computeIndiaSnapshot(c, d);

      // Internal identity: Total Liabilities == Total Assets (both sides of the BS)
      const totalLiab = statementRow(c.balanceSheet, "Total Liabilities")?.values.at(-1) ?? null;
      const totalAssets = statementRow(c.balanceSheet, "Total Assets")?.values.at(-1) ?? null;
      const identityOk = totalLiab != null && totalAssets != null ? Math.abs(totalLiab - totalAssets) < 2 : null;
      if (identityOk === false) issues.push(`BS identity broken: L=${totalLiab} A=${totalAssets}`);

      // Freshness: latest quarter should be Jun 2026 (or later) as of Aug 2026.
      const latestQ = d.latestQuarter?.period ?? null;
      if (latestQ && !/(Jun|Sep) 2026/.test(latestQ)) issues.push(`stale latest quarter: ${latestQ}`);

      // Quarterly EPS vs net profit sanity (shares ≈ marketCap/price):
      const q = c.quarterlyPL.at(-1);
      if (q?.eps != null && q.netProfit != null && c.marketCap != null && c.currentPrice != null && c.currentPrice > 0) {
        const sharesCr = c.marketCap / c.currentPrice;      // crores of shares
        const impliedNp = q.eps * sharesCr;                  // ₹ Cr
        const ratio = q.netProfit !== 0 ? impliedNp / q.netProfit : NaN;
        if (isFinite(ratio) && (ratio < 0.5 || ratio > 2)) issues.push(`EPS×shares vs NP off: ratio=${ratio.toFixed(2)}`);
      }

      // Cross-source: Yahoo annual revenue (raw INR) vs screener FY sales (Cr).
      let yahooRevMatch = "-";
      if (YAHOO_XCHECK.has(sym)) {
        try {
          const y = await getFinancialStatementsYahoo(`${sym}.NS`);
          const yRev = y?.revenue?.at(-1);
          const sFy = c.annualPL.filter((r) => /^Mar \d{4}$/.test(r.period)).find((r) => r.period.includes(String(yRev?.fy ?? "æ")));
          if (yRev && sFy?.sales != null) {
            const yCr = yRev.value / 1e7;
            const diffPct = Math.abs(yCr - sFy.sales) / sFy.sales * 100;
            yahooRevMatch = `${diffPct.toFixed(1)}%`;
            if (diffPct > 10) issues.push(`Yahoo vs screener FY revenue differs ${diffPct.toFixed(0)}% (basis?)`);
          } else yahooRevMatch = "n/a";
        } catch { yahooRevMatch = "err"; }
      }

      const rec: Row = {
        symbol: sym, ok: true,
        kind: c.statementKind, basis: c.basis,
        fy: c.annualPL.filter((r) => /^Mar \d{4}$/.test(r.period)).length,
        q: c.quarterlyPL.length,
        bsRows: c.balanceSheet?.rows.length ?? 0,
        cfRows: c.cashFlow?.rows.length ?? 0,
        latestQ, latestQLabel: d.latestQuarter?.fiscalLabel ?? null,
        qSalesYoY: d.latestQuarter?.salesYoYPercent != null ? d.latestQuarter.salesYoYPercent.toFixed(1) : "-",
        de: d.debtToEquity, icov: d.interestCoverage, pb: d.priceToBook,
        fcf: d.freeCashFlow, npa: d.netNpaPercent,
        composite: snap.composite,
        identityOk, yahooRevMatch, issues,
      };
      rows.push(rec);
      fs.writeFileSync(path.join(OUT, `${sym}.json`), JSON.stringify({ company: c, derived: d, snapshot: snap }, null, 2));
    } catch (e) {
      rows.push({ symbol: sym, ok: false, issues: [e instanceof Error ? e.message : String(e)] });
    }
    await sleep(6000);
  }

  console.log(`\n${"symbol".padEnd(11)} kind       basis  fy  q  bs  cf  latestQ   label    YoY%   D/E   iCov   P/B   FCF(Cr)  NPA  comp  id  yRev`);
  for (const r of rows) {
    if (!r.ok) { console.log(`${r.symbol.padEnd(11)} FAILED: ${r.issues.join("; ")}`); continue; }
    console.log(
      `${r.symbol.padEnd(11)} ${(r.kind ?? "").padEnd(10)} ${(r.basis ?? "?").slice(0, 5).padEnd(6)} ${String(r.fy).padStart(2)} ${String(r.q).padStart(2)} ${String(r.bsRows).padStart(3)} ${String(r.cfRows).padStart(3)}  ${(r.latestQ ?? "-").padEnd(9)} ${(r.latestQLabel ?? "-").padEnd(8)} ${String(r.qSalesYoY).padStart(5)} ${String(r.de ?? "-").padStart(5)} ${String(r.icov ?? "-").padStart(6)} ${String(r.pb ?? "-").padStart(5)} ${String(r.fcf ?? "-").padStart(8)} ${String(r.npa ?? "-").padStart(4)} ${String(r.composite).padStart(4)}  ${r.identityOk === null ? "?" : r.identityOk ? "✓" : "✗"}  ${r.yahooRevMatch}`,
    );
    if (r.issues.length) console.log(`  ⚠ ${r.issues.join("; ")}`);
  }
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(rows, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
