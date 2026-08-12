import { describe, it, expect } from "vitest";
import {
  getRatio,
  getPromoterHolding,
  getFIIHolding,
  getDIIHolding,
} from "../lib/screener-in";
import type { ScreenerInCompany } from "../lib/screener-in";

function makeCompany(overrides: Partial<ScreenerInCompany> = {}): ScreenerInCompany {
  return {
    name: "Test Co",
    symbol: "TEST",
    bseCode: "500001",
    marketCap: 10000,
    currentPrice: 1200,
    high52w: 1500,
    low52w: 900,
    pe: 22.5,
    bookValue: 400,
    dividendYield: 1.5,
    roce: 18,
    roe: 14,
    debt: 2000,
    changePercent: 1.2,
    promoterHolding: 54.2,
    ratios: [
      {
        name: "Price to Earning",
        values: [
          { period: "Mar 2020", value: "18" },
          { period: "Mar 2021", value: "20" },
          { period: "Mar 2022", value: "22" },
          { period: "Mar 2023", value: "25" },
        ],
      },
      {
        name: "EV / EBITDA",
        values: [{ period: "Mar 2023", value: "14.2" }],
      },
    ],
    peers: [],
    shareholding: [
      { holding: "fii", name: "FIIs", values: ["12.3", "13.1", "14.0"] },
      { holding: "dii", name: "DIIs", values: ["8.0", "8.5", "9.0"] },
    ],
    shareholdingPeriods: [],
    annualPL: [],
    quarterlyPL: [],
    balanceSheet: null,
    cashFlow: null,
    basis: "consolidated",
    statementKind: "industrial",
    kpis: [],
    documents: null,
    sector: null,
    industry: null,
    ...overrides,
  };
}

describe("getRatio", () => {
  it("returns the last value for a matching ratio", () => {
    const c = makeCompany();
    expect(getRatio(c, "Price to Earning")).toBe(25);
  });

  it("returns the EV/EBITDA ratio", () => {
    const c = makeCompany();
    expect(getRatio(c, "EV / EBITDA")).toBe(14.2);
  });

  it("returns null for a missing ratio", () => {
    const c = makeCompany();
    expect(getRatio(c, "Nonexistent Ratio")).toBeNull();
  });

  it("handles case-insensitive matching", () => {
    const c = makeCompany();
    expect(getRatio(c, "price to earning")).toBe(25);
  });
});

describe("getPromoterHolding", () => {
  it("returns promoterHolding field", () => {
    const c = makeCompany();
    expect(getPromoterHolding(c)).toBe(54.2);
  });

  it("returns null when promoterHolding is null", () => {
    const c = makeCompany({ promoterHolding: null });
    expect(getPromoterHolding(c)).toBeNull();
  });
});

describe("getFIIHolding", () => {
  it("returns latest FII holding", () => {
    const c = makeCompany();
    expect(getFIIHolding(c)).toBe(14.0);
  });
});

describe("getDIIHolding", () => {
  it("returns latest DII holding", () => {
    const c = makeCompany();
    expect(getDIIHolding(c)).toBe(9.0);
  });
});

/* -------------------------------------------------------------------------- */
/* HTML scraping — regression tests against screener.in's real markup shape   */
/* -------------------------------------------------------------------------- */

import { scrapeAnnualPL, scrapeQuarterlyPL, scrapeRatiosTable } from "../lib/screener-in";

// screener.in renders row labels with &nbsp; before the expand chevron
// ("Sales&nbsp;+"). A 2026-08 regression: without entity decoding, the row
// lookup missed and every Indian stock returned 0 annual / 0 quarterly rows.
// The first <th> of every table is an EMPTY label column (verified live) —
// the fixture encodes that so period↔value alignment is asserted too.
const PL_TABLE = (id: string, next: string, periods: string[]) => `
<section id="${id}">
<table>
<tr><th></th>${periods.map((p) => `<th>${p}</th>`).join("")}</tr>
<tr><td>Sales&nbsp;+</td><td>1,000</td><td>1,200</td></tr>
<tr><td>Expenses&nbsp;+</td><td>800</td><td>900</td></tr>
<tr><td>OPM %</td><td>20%</td><td>25%</td></tr>
<tr><td>Net Profit&nbsp;+</td><td>150</td><td>210</td></tr>
</table>
</section>
<section id="${next}"></section>`;

describe("scrapeAnnualPL", () => {
  it("decodes &nbsp; in row labels and parses sales/profit/OPM", () => {
    const html = PL_TABLE("profit-loss", "balance-sheet", ["Mar 2025", "Mar 2026"]);
    const rows = scrapeAnnualPL(html);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ period: "Mar 2026", sales: 1200, netProfit: 210, opmPercent: 25, expenses: 900 });
  });
});

describe("scrapeQuarterlyPL", () => {
  it("parses quarterly rows with entity-encoded labels", () => {
    const html = PL_TABLE("quarters", "profit-loss", ["Mar 2026", "Jun 2026"]);
    const rows = scrapeQuarterlyPL(html);
    expect(rows).toHaveLength(2);
    expect(rows[1].period).toBe("Jun 2026");
    expect(rows[1].sales).toBe(1200);
  });
});

describe("scrapeRatiosTable", () => {
  it("skips premium-gated placeholder rows (xx / x.xx) and keeps real ones", () => {
    const html = `
<section id="ratios">
<table>
<tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr>
<tr><td>ROCE %</td><td>18%</td><td>21%</td></tr>
<tr><td>xx</td><td>xx</td><td>xx</td></tr>
<tr><td>x.xx</td><td>x.xx</td><td>x.xx</td></tr>
<tr><td>Debtor Days&nbsp;</td><td>45</td><td>41</td></tr>
</table>
</section>
<section id="shareholding"></section>`;
    const ratios = scrapeRatiosTable(html);
    expect(ratios.map((r) => r.name)).toEqual(["ROCE %", "Debtor Days"]);
    expect(ratios[0].values.at(-1)).toEqual({ period: "Mar 2026", value: "21%" });
  });
});

import { scrapeStatements, scrapeBasis } from "../lib/screener-in";

// Balance-sheet / cash-flow markup shape verified live (RELIANCE/HDFCBANK,
// 2026-08): empty first <th>, one column per period, ₹ Cr values with Indian
// digit grouping, collapsible rows suffixed "&nbsp;+".
describe("scrapeStatements", () => {
  const HTML = `
<section id="balance-sheet">
<table>
<tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr>
<tr><td>Equity Capital</td><td>13,532</td><td>13,532</td></tr>
<tr><td>Reserves</td><td>8,29,668</td><td>8,90,498</td></tr>
<tr><td>Borrowings&nbsp;+</td><td>3,74,313</td><td>4,02,962</td></tr>
<tr><td>Total Liabilities</td><td>19,49,713</td><td>21,77,546</td></tr>
</table>
</section>
<section id="cash-flow">
<table>
<tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr>
<tr><td>Cash from Operating Activity&nbsp;+</td><td>1,78,703</td><td>1,92,113</td></tr>
<tr><td>Free Cash Flow</td><td>41,079</td><td>70,023</td></tr>
<tr><td>CFO/OP</td><td>115%</td><td>113%</td></tr>
</table>
</section>
<section id="ratios"></section>`;

  it("parses every balance-sheet row with aligned periods and Indian grouping", () => {
    const bs = scrapeStatements(HTML, "balance-sheet", "cash-flow");
    expect(bs?.periods).toEqual(["Mar 2025", "Mar 2026"]);
    expect(bs?.rows.find((r) => r.name === "Borrowings")?.values).toEqual([374313, 402962]);
    expect(bs?.rows.find((r) => r.name === "Reserves")?.values).toEqual([829668, 890498]);
  });

  it("parses the cash-flow table including the source-reported Free Cash Flow", () => {
    const cf = scrapeStatements(HTML, "cash-flow", "ratios");
    expect(cf?.rows.find((r) => r.name === "Cash from Operating Activity")?.values).toEqual([178703, 192113]);
    expect(cf?.rows.find((r) => r.name === "Free Cash Flow")?.values).toEqual([41079, 70023]);
  });

  it("returns null for an absent section", () => {
    expect(scrapeStatements(HTML, "no-such-section", "ratios")).toBeNull();
  });
});

describe("scrapeBasis", () => {
  it("reads the page's own basis marker", () => {
    expect(scrapeBasis("<div>Consolidated Figures in Rs. Crores</div>")).toBe("consolidated");
    expect(scrapeBasis("<div>Standalone Figures in Rs. Crores</div>")).toBe("standalone");
    expect(scrapeBasis("<div>nothing here</div>")).toBeNull();
  });
});

describe("bank-shaped P&L rows", () => {
  const BANK_HTML = `
<section id="quarters">
<table>
<tr><th></th><th>Mar 2026</th><th>Jun 2026</th></tr>
<tr><td>Revenue&nbsp;+</td><td>85,040</td><td>90,575</td></tr>
<tr><td>Interest</td><td>44,000</td><td>45,100</td></tr>
<tr><td>Financing Profit</td><td>24,500</td><td>26,000</td></tr>
<tr><td>Financing Margin %</td><td>29%</td><td>29%</td></tr>
<tr><td>Net Profit&nbsp;+</td><td>19,200</td><td>20,383</td></tr>
<tr><td>EPS in Rs</td><td>12.5</td><td>13.3</td></tr>
<tr><td>Gross NPA %</td><td>1.4</td><td>1.3</td></tr>
<tr><td>Net NPA %</td><td>0.4</td><td>0.4</td></tr>
</table>
</section>
<section id="profit-loss"></section>`;

  it("extracts bank rows: revenue-as-sales, financing profit/margin, NPA, EPS", () => {
    const q = scrapeQuarterlyPL(BANK_HTML);
    expect(q).toHaveLength(2);
    const latest = q.at(-1)!;
    expect(latest.period).toBe("Jun 2026");
    expect(latest.sales).toBe(90575);
    expect(latest.financingProfit).toBe(26000);
    expect(latest.financingMarginPercent).toBe(29);
    expect(latest.grossNpaPercent).toBe(1.3);
    expect(latest.netNpaPercent).toBe(0.4);
    expect(latest.eps).toBe(13.3);
  });
});

import { scrapeDocuments } from "../lib/screener-in";

// Documents-section markup shape verified live (RELIANCE, 2026-08).
describe("scrapeDocuments", () => {
  const HTML = `
<section id="documents">
<h3>Announcements</h3>
<div><ul><li><a href="https://www.bseindia.com/stockinfo/x.pdf">Some announcement</a></li></ul></div>
<h3>Annual reports</h3>
<div class="show-more-box"><ul class="list-links">
<li><a href="https://www.bseindia.com/xml-data/corpfiling/AttachHis/abc.pdf" target="_blank">
Financial Year 2026 <div class="ink-600 smaller"> from bse </div></a></li>
<li><a href="https://archives.nseindia.com/annual_reports/AR_x.zip" target="_blank">
Financial Year 2013 <div class="ink-600 smaller"> from nse </div></a></li>
</ul></div>
<h3>Credit ratings</h3>
<div class="show-more-box"><ul class="list-links">
<li><a href="https://www.careratings.com/upload/x.pdf" target="_blank">
Rating update <div class="ink-600 smaller"> 3 Jul from care </div></a></li>
</ul></div>
<h3>Concalls</h3>
<div class="show-more-box"><ul class="list-links">
<li class="flex"><div class="ink-600 font-size-15 font-weight-500 nowrap" style="width: 74px">Jul 2026</div>
<a class="concall-link" href="https://www.bseindia.com/stockinfo/t.pdf" title="Raw Transcript">Transcript</a>
<a class="concall-link" href="https://www.bseindia.com/stockinfo/p.pdf">PPT</a></li>
<li class="flex"><div class="ink-600 nowrap" style="width: 74px">Apr 2026</div>
<a class="concall-link" href="https://www.bseindia.com/stockinfo/t2.pdf">Transcript</a></li>
</ul></div>
</section>`;

  it("extracts annual reports with their source notes", () => {
    const d = scrapeDocuments(HTML)!;
    expect(d.annualReports).toHaveLength(2);
    expect(d.annualReports[0]).toEqual({
      label: "Financial Year 2026",
      url: "https://www.bseindia.com/xml-data/corpfiling/AttachHis/abc.pdf",
      note: "from bse",
    });
  });

  it("extracts concalls with dated transcript/PPT links", () => {
    const d = scrapeDocuments(HTML)!;
    expect(d.concalls).toHaveLength(2);
    expect(d.concalls[0]).toEqual({
      date: "Jul 2026",
      transcriptUrl: "https://www.bseindia.com/stockinfo/t.pdf",
      pptUrl: "https://www.bseindia.com/stockinfo/p.pdf",
      recordingUrl: null,
    });
    expect(d.concalls[1].pptUrl).toBeNull();
  });

  it("extracts credit ratings with agency/date notes", () => {
    const d = scrapeDocuments(HTML)!;
    expect(d.creditRatings[0].note).toBe("3 Jul from care");
  });

  it("returns null when the section is absent", () => {
    expect(scrapeDocuments("<div>no docs</div>")).toBeNull();
  });
});
