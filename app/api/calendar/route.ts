import { NextResponse } from "next/server";
import { listWatchlist, listPortfolio } from "@/lib/db";
import { getQuoteSummary } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type EventType = "earnings" | "exDividend" | "dividend" | "macro";
export type EventSource = "watchlist" | "portfolio" | "macro";
export type ImpactLevel = "high" | "medium" | "low";
export type Region = "US" | "India" | "Europe" | "Asia" | "Global";

export interface CalendarEvent {
  id: string;
  symbol?: string;
  name: string;
  type: EventType;
  date: string;       // YYYY-MM-DD
  dateEnd?: string;
  isEstimate?: boolean;
  source: EventSource;

  // Earnings
  quarter?: string;
  epsEstimate?: number | null;
  revenueEstimate?: number | null;
  timing?: "BMO" | "AMC" | "TNS";

  // Dividend
  dividendAmount?: number | null;
  dividendYield?: number | null;
  paymentDate?: string | null;

  // Macro
  country?: string;
  region?: Region;
  impact?: ImpactLevel;
  previous?: string | null;
  forecast?: string | null;
  actual?: string | null;
  category?: string;
  description?: string;
}

export interface CalendarResponse {
  events: CalendarEvent[];
  portfolioSymbols: string[];
  watchlistSymbols: string[];
  /** Watchlist/portfolio symbols whose earnings/dividend data failed to load this request. */
  unavailableSymbols: string[];
}

// ─── Macro event schedule (rolling 6-month window from mid-2026) ───────────
//
// Dates, event names, and descriptions below are real, publicly-scheduled
// events (central bank meeting calendars and statistical-release schedules
// are published by these institutions well in advance) and are safe to hand-
// author. `forecast`/`previous` numeric values are deliberately NOT included:
// there is no live data source wired up for them, and earlier hardcoded
// placeholder figures were frozen at commit time and rendered indistinguishable
// from the real, live-fetched earnings/dividend data elsewhere on this page —
// this violates the app's own transparency principle (CLAUDE.md: "users see
// the research process, understand the scoring logic"). If real consensus/
// actual figures are wired up later, source them live per-event rather than
// hardcoding numbers here.
//
// MAINTENANCE: this schedule currently ends 2026-12-18. It needs a fresh pass
// to extend the date range periodically — nothing here auto-generates future
// occurrences.
type MacroTemplate = Omit<CalendarEvent, "id">;

const MACRO_EVENTS: MacroTemplate[] = [
  // US — Employment
  { name: "US Employment Report (Jun)", type: "macro", date: "2026-07-02", source: "macro", country: "US", region: "US", impact: "high", category: "Employment", description: "Non-Farm Payrolls and Unemployment Rate for June 2026. Key labour-market indicator watched closely by the Fed." },
  { name: "US Employment Report (Jul)", type: "macro", date: "2026-08-07", source: "macro", country: "US", region: "US", impact: "high", category: "Employment", description: "Non-Farm Payrolls and Unemployment Rate for July 2026." },
  { name: "US Employment Report (Aug)", type: "macro", date: "2026-09-04", source: "macro", country: "US", region: "US", impact: "high", category: "Employment", description: "Non-Farm Payrolls and Unemployment Rate for August 2026." },
  { name: "US Employment Report (Sep)", type: "macro", date: "2026-10-02", source: "macro", country: "US", region: "US", impact: "high", category: "Employment", description: "Non-Farm Payrolls and Unemployment Rate for September 2026." },
  { name: "US Employment Report (Oct)", type: "macro", date: "2026-11-06", source: "macro", country: "US", region: "US", impact: "high", category: "Employment", description: "Non-Farm Payrolls and Unemployment Rate for October 2026." },
  { name: "US Employment Report (Nov)", type: "macro", date: "2026-12-04", source: "macro", country: "US", region: "US", impact: "high", category: "Employment", description: "Non-Farm Payrolls and Unemployment Rate for November 2026." },

  // US — CPI
  { name: "US CPI Inflation (Jun)", type: "macro", date: "2026-07-10", source: "macro", country: "US", region: "US", impact: "high", category: "Inflation", description: "Consumer Price Index for June 2026. Critical input for Federal Reserve policy decisions." },
  { name: "US CPI Inflation (Jul)", type: "macro", date: "2026-08-13", source: "macro", country: "US", region: "US", impact: "high", category: "Inflation", description: "Consumer Price Index for July 2026." },
  { name: "US CPI Inflation (Aug)", type: "macro", date: "2026-09-11", source: "macro", country: "US", region: "US", impact: "high", category: "Inflation", description: "Consumer Price Index for August 2026." },
  { name: "US CPI Inflation (Sep)", type: "macro", date: "2026-10-09", source: "macro", country: "US", region: "US", impact: "high", category: "Inflation", description: "Consumer Price Index for September 2026." },
  { name: "US CPI Inflation (Oct)", type: "macro", date: "2026-11-12", source: "macro", country: "US", region: "US", impact: "high", category: "Inflation", description: "Consumer Price Index for October 2026." },
  { name: "US CPI Inflation (Nov)", type: "macro", date: "2026-12-10", source: "macro", country: "US", region: "US", impact: "high", category: "Inflation", description: "Consumer Price Index for November 2026." },

  // US — PPI
  { name: "US PPI (Jun)", type: "macro", date: "2026-07-11", source: "macro", country: "US", region: "US", impact: "medium", category: "Inflation", description: "Producer Price Index for June 2026." },
  { name: "US PPI (Aug)", type: "macro", date: "2026-09-12", source: "macro", country: "US", region: "US", impact: "medium", category: "Inflation", description: "Producer Price Index for August 2026." },

  // US — PMI
  { name: "US ISM Manufacturing PMI (Jun)", type: "macro", date: "2026-07-01", source: "macro", country: "US", region: "US", impact: "medium", category: "PMI", description: "ISM Manufacturing PMI for June 2026. Readings above 50 indicate expansion." },
  { name: "US ISM Manufacturing PMI (Jul)", type: "macro", date: "2026-08-03", source: "macro", country: "US", region: "US", impact: "medium", category: "PMI", description: "ISM Manufacturing PMI for July 2026." },
  { name: "US ISM Services PMI (Jun)", type: "macro", date: "2026-07-07", source: "macro", country: "US", region: "US", impact: "medium", category: "PMI", description: "ISM Services PMI for June 2026. Services sector accounts for ~70% of US GDP." },

  // US — GDP
  { name: "US GDP Q2 2026 (Advance)", type: "macro", date: "2026-07-30", source: "macro", country: "US", region: "US", impact: "high", category: "GDP", description: "First estimate of US GDP growth rate for Q2 2026 (Apr–Jun). Released alongside FOMC decision." },
  { name: "US GDP Q3 2026 (Advance)", type: "macro", date: "2026-10-29", source: "macro", country: "US", region: "US", impact: "high", category: "GDP", description: "First estimate of US GDP growth rate for Q3 2026 (Jul–Sep)." },

  // US — Retail Sales
  { name: "US Retail Sales (Jun)", type: "macro", date: "2026-07-16", source: "macro", country: "US", region: "US", impact: "medium", category: "Consumer", description: "US Retail and Food Services Sales for June 2026. Measures consumer spending momentum." },
  { name: "US Retail Sales (Aug)", type: "macro", date: "2026-09-17", source: "macro", country: "US", region: "US", impact: "medium", category: "Consumer", description: "US Retail Sales for August 2026." },

  // US — FOMC
  { name: "FOMC Rate Decision", type: "macro", date: "2026-07-30", source: "macro", country: "US", region: "US", impact: "high", category: "Central Bank", description: "Federal Open Market Committee interest rate decision and statement. July 28–30 meeting. Fed Chair press conference follows." },
  { name: "FOMC Rate Decision", type: "macro", date: "2026-09-17", source: "macro", country: "US", region: "US", impact: "high", category: "Central Bank", description: "FOMC interest rate decision and statement. September 15–17 meeting. Updated economic projections ('dot plot') released." },
  { name: "FOMC Rate Decision", type: "macro", date: "2026-11-05", source: "macro", country: "US", region: "US", impact: "high", category: "Central Bank", description: "FOMC interest rate decision and statement. November 4–5 meeting." },
  { name: "FOMC Rate Decision", type: "macro", date: "2026-12-10", source: "macro", country: "US", region: "US", impact: "high", category: "Central Bank", description: "FOMC interest rate decision and statement. December 9–10 meeting. Updated economic projections." },

  // US — Jackson Hole
  { name: "Jackson Hole Symposium", type: "macro", date: "2026-08-27", dateEnd: "2026-08-29", source: "macro", country: "US", region: "US", impact: "high", category: "Central Bank", description: "Annual Federal Reserve symposium in Jackson Hole, Wyoming. Venue for major Fed policy signals. Fed Chair keynote typically delivers significant market-moving guidance." },

  // India — PMI
  { name: "India Manufacturing PMI (Jun)", type: "macro", date: "2026-07-01", source: "macro", country: "India", region: "India", impact: "medium", category: "PMI", description: "S&P Global India Manufacturing PMI for June 2026." },
  { name: "India Manufacturing PMI (Jul)", type: "macro", date: "2026-08-03", source: "macro", country: "India", region: "India", impact: "medium", category: "PMI", description: "S&P Global India Manufacturing PMI for July 2026." },
  { name: "India Services PMI (Jun)", type: "macro", date: "2026-07-03", source: "macro", country: "India", region: "India", impact: "medium", category: "PMI", description: "S&P Global India Services PMI for June 2026. India's services sector is a key growth engine." },

  // India — Inflation
  { name: "India CPI Inflation (Jun)", type: "macro", date: "2026-07-14", source: "macro", country: "India", region: "India", impact: "medium", category: "Inflation", description: "India Consumer Price Index for June 2026. RBI's primary inflation target." },
  { name: "India CPI Inflation (Aug)", type: "macro", date: "2026-09-12", source: "macro", country: "India", region: "India", impact: "medium", category: "Inflation", description: "India Consumer Price Index for August 2026." },
  { name: "India CPI Inflation (Sep)", type: "macro", date: "2026-10-14", source: "macro", country: "India", region: "India", impact: "medium", category: "Inflation", description: "India Consumer Price Index for September 2026." },

  // India — GDP
  { name: "India GDP Q1 FY27", type: "macro", date: "2026-08-31", source: "macro", country: "India", region: "India", impact: "high", category: "GDP", description: "India GDP growth for Q1 FY2026-27 (April–June 2026). Released by National Statistical Office." },
  { name: "India GDP Q2 FY27", type: "macro", date: "2026-11-30", source: "macro", country: "India", region: "India", impact: "high", category: "GDP", description: "India GDP growth for Q2 FY2026-27 (July–September 2026)." },

  // India — RBI
  { name: "RBI MPC Meeting", type: "macro", date: "2026-08-06", dateEnd: "2026-08-08", source: "macro", country: "India", region: "India", impact: "high", category: "Central Bank", description: "Reserve Bank of India Monetary Policy Committee 3-day meeting. Rate decision and statement released Aug 8. Key for banking and rate-sensitive sectors." },
  { name: "RBI MPC Meeting", type: "macro", date: "2026-10-01", dateEnd: "2026-10-03", source: "macro", country: "India", region: "India", impact: "high", category: "Central Bank", description: "Reserve Bank of India Monetary Policy Committee meeting. Rate decision released Oct 3." },
  { name: "RBI MPC Meeting", type: "macro", date: "2026-12-03", dateEnd: "2026-12-05", source: "macro", country: "India", region: "India", impact: "high", category: "Central Bank", description: "Reserve Bank of India Monetary Policy Committee meeting. Rate decision released Dec 5. Final meeting of calendar year." },

  // India — IIP & Fiscal
  { name: "India IIP Industrial Output (May)", type: "macro", date: "2026-07-11", source: "macro", country: "India", region: "India", impact: "low", category: "Industrial", description: "Index of Industrial Production for May 2026. Measures manufacturing, mining, and electricity output." },

  // Europe — ECB
  { name: "ECB Rate Decision", type: "macro", date: "2026-07-23", source: "macro", country: "Eurozone", region: "Europe", impact: "high", category: "Central Bank", description: "European Central Bank Governing Council rate decision and Christine Lagarde press conference." },
  { name: "ECB Rate Decision", type: "macro", date: "2026-09-10", source: "macro", country: "Eurozone", region: "Europe", impact: "high", category: "Central Bank", description: "ECB Governing Council rate decision. Updated staff economic projections released." },
  { name: "ECB Rate Decision", type: "macro", date: "2026-10-22", source: "macro", country: "Eurozone", region: "Europe", impact: "high", category: "Central Bank", description: "ECB Governing Council rate decision." },
  { name: "ECB Rate Decision", type: "macro", date: "2026-12-10", source: "macro", country: "Eurozone", region: "Europe", impact: "high", category: "Central Bank", description: "ECB Governing Council rate decision and press conference. Updated economic projections." },

  // Europe — Inflation
  { name: "Eurozone CPI Flash (Jun)", type: "macro", date: "2026-07-01", source: "macro", country: "Eurozone", region: "Europe", impact: "medium", category: "Inflation", description: "Eurozone Flash CPI Estimate for June 2026. First look at euro area inflation." },
  { name: "Eurozone CPI Flash (Jul)", type: "macro", date: "2026-07-31", source: "macro", country: "Eurozone", region: "Europe", impact: "medium", category: "Inflation", description: "Eurozone Flash CPI Estimate for July 2026." },

  // Europe — GDP
  { name: "Eurozone GDP Q2 2026 (Flash)", type: "macro", date: "2026-07-30", source: "macro", country: "Eurozone", region: "Europe", impact: "medium", category: "GDP", description: "Eurozone Flash GDP estimate for Q2 2026." },

  // Asia — BOJ
  { name: "BOJ Rate Decision", type: "macro", date: "2026-07-31", source: "macro", country: "Japan", region: "Asia", impact: "high", category: "Central Bank", description: "Bank of Japan Policy Board rate decision. BOJ policy shifts continue to have global market implications given yen carry trade dynamics." },
  { name: "BOJ Rate Decision", type: "macro", date: "2026-09-22", source: "macro", country: "Japan", region: "Asia", impact: "high", category: "Central Bank", description: "Bank of Japan Policy Board rate decision." },
  { name: "BOJ Rate Decision", type: "macro", date: "2026-10-29", source: "macro", country: "Japan", region: "Asia", impact: "high", category: "Central Bank", description: "Bank of Japan Policy Board rate decision." },
  { name: "BOJ Rate Decision", type: "macro", date: "2026-12-18", source: "macro", country: "Japan", region: "Asia", impact: "high", category: "Central Bank", description: "Bank of Japan Policy Board rate decision and year-end outlook." },

  // Asia — Japan CPI
  { name: "Japan CPI (Jun)", type: "macro", date: "2026-07-24", source: "macro", country: "Japan", region: "Asia", impact: "medium", category: "Inflation", description: "Japan Consumer Price Index for June 2026. Key input for BOJ policy decisions." },
  { name: "Japan CPI (Aug)", type: "macro", date: "2026-09-19", source: "macro", country: "Japan", region: "Asia", impact: "medium", category: "Inflation", description: "Japan Consumer Price Index for August 2026." },

  // Asia — China
  { name: "China Manufacturing PMI (Jun)", type: "macro", date: "2026-07-01", source: "macro", country: "China", region: "Asia", impact: "medium", category: "PMI", description: "China Official Manufacturing PMI for June 2026. Key gauge of factory activity in the world's second-largest economy." },
  { name: "China Manufacturing PMI (Jul)", type: "macro", date: "2026-08-01", source: "macro", country: "China", region: "Asia", impact: "medium", category: "PMI", description: "China Official Manufacturing PMI for July 2026." },
  { name: "China GDP Q2 2026", type: "macro", date: "2026-07-15", source: "macro", country: "China", region: "Asia", impact: "high", category: "GDP", description: "China GDP growth for Q2 2026 (April–June). Released by National Bureau of Statistics." },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

let hasWarnedStaleSchedule = false;

/**
 * MACRO_EVENTS is a hand-maintained schedule with a hard end date and no
 * auto-generation — it will silently show fewer and fewer (then zero) macro
 * events as time passes unless someone notices and extends it. Warn once per
 * process when the schedule's last entry is close to (or before) the window
 * we're about to filter against, so this shows up in server logs instead of
 * quietly degrading forever.
 */
function warnIfMacroScheduleRunningOut(windowEndStr: string): void {
  if (hasWarnedStaleSchedule || MACRO_EVENTS.length === 0) return;
  const lastDate = MACRO_EVENTS.reduce((max, m) => (m.date > max ? m.date : max), MACRO_EVENTS[0].date);
  const warnThreshold = new Date(windowEndStr);
  warnThreshold.setDate(warnThreshold.getDate() - 30);
  if (lastDate <= warnThreshold.toISOString().slice(0, 10)) {
    console.warn(
      `[calendar] MACRO_EVENTS schedule ends ${lastDate}, within 30 days of the display window (${windowEndStr}). ` +
      `Extend the hardcoded schedule in app/api/calendar/route.ts or macro events will start silently disappearing.`,
    );
    hasWarnedStaleSchedule = true;
  }
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === "object" && "raw" in (v as object)) {
    const raw = (v as { raw?: number }).raw;
    if (raw != null) return new Date(raw * 1000).toISOString().slice(0, 10);
  }
  if (typeof v === "number") return new Date(v * 1000).toISOString().slice(0, 10);
  return null;
}

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "object" && "raw" in (v as object)
    ? Number((v as { raw?: number }).raw)
    : Number(v);
  return isNaN(n) ? null : n;
}

// ─── Route ─────────────────────────────────────────────────────────────────

export async function GET() {
  const watchlist = listWatchlist();
  const portfolio = listPortfolio();

  const watchlistSymbols = watchlist.map((w) => w.symbol);
  const portfolioSymbols = portfolio.map((p) => p.symbol);

  const symbolMap = new Map<string, { name: string; source: "watchlist" | "portfolio" }>();
  for (const w of watchlist) symbolMap.set(w.symbol, { name: w.name, source: "watchlist" });
  for (const p of portfolio) {
    if (!symbolMap.has(p.symbol)) symbolMap.set(p.symbol, { name: p.name, source: "portfolio" });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const future = new Date();
  future.setDate(future.getDate() + 180); // 6-month window

  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const futureStr = future.toISOString().slice(0, 10);

  warnIfMacroScheduleRunningOut(futureStr);

  const events: CalendarEvent[] = [];
  let macroIdx = 0;

  // Macro events (static schedule)
  for (const m of MACRO_EVENTS) {
    if (m.date >= cutoffStr && m.date <= futureStr) {
      events.push({ ...m, id: `macro-${macroIdx++}` });
    }
  }

  if (symbolMap.size === 0) {
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return NextResponse.json({ events, portfolioSymbols, watchlistSymbols, unavailableSymbols: [] } satisfies CalendarResponse);
  }

  const entries = Array.from(symbolMap.entries());

  const settled = await Promise.allSettled(
    entries.map(async ([sym]) => {
      const raw = await getQuoteSummary(sym, [
        "calendarEvents",
        "price",
        "earningsTrend",
        "summaryDetail",
      ]) as Record<string, unknown>;
      return { sym, raw };
    }),
  );

  const unavailableSymbols: string[] = [];
  let symIdx = 0;
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "rejected") {
      const [sym] = entries[i];
      unavailableSymbols.push(sym);
      console.error(`[calendar] Failed to load calendar data for ${sym}:`, result.reason);
      symIdx++;
      continue;
    }
    const { sym, raw } = result.value;
    const meta = symbolMap.get(sym)!;

    const pr = (raw.price ?? {}) as Record<string, unknown>;
    const name =
      (pr.longName as string | undefined) ??
      (pr.shortName as string | undefined) ??
      meta.name;

    const cal = (raw.calendarEvents ?? {}) as Record<string, unknown>;
    const earningsCal = (cal.earnings ?? {}) as Record<string, unknown>;
    const sd = (raw.summaryDetail ?? {}) as Record<string, unknown>;
    const trendData = (raw.earningsTrend ?? {}) as Record<string, unknown>;
    const trends = Array.isArray(trendData.trend)
      ? (trendData.trend as Record<string, unknown>[])
      : [];
    const currentQ = trends.find((t) => t.period === "0q") ?? trends[0] ?? {};

    // ── Earnings ─────────────────────────────────────────────────────────
    const earningsDates = (earningsCal.earningsDate ?? []) as unknown[];
    const earningsStart = earningsDates[0] != null ? toIso(earningsDates[0]) : null;
    const earningsEnd = earningsDates[1] != null ? toIso(earningsDates[1]) : null;
    const isEstimate = (earningsCal.isEarningsDateEstimate as boolean | undefined) ?? false;

    if (earningsStart) {
      const d = new Date(earningsStart);
      if (d >= cutoff && d <= future) {
        const epsEst = safeNum((currentQ.earningsEstimate as Record<string, unknown> | undefined)?.avg);
        const revEst = safeNum((currentQ.revenueEstimate as Record<string, unknown> | undefined)?.avg);
        const endDateRaw = currentQ.endDate as string | Date | undefined;

        let quarter = "";
        if (endDateRaw) {
          const ed = new Date(endDateRaw);
          if (!isNaN(ed.getTime())) {
            const q = Math.ceil((ed.getMonth() + 1) / 3);
            quarter = `Q${q} ${ed.getFullYear()}`;
          }
        }

        events.push({
          id: `earnings-${sym}-${symIdx}`,
          symbol: sym,
          name,
          type: "earnings",
          date: earningsStart,
          dateEnd: earningsEnd ?? undefined,
          isEstimate,
          source: meta.source,
          quarter: quarter || undefined,
          epsEstimate: epsEst,
          revenueEstimate: revEst,
        });
      }
    }

    // ── Ex-dividend ───────────────────────────────────────────────────────
    const exDiv = toIso(cal.exDividendDate);
    if (exDiv) {
      const d = new Date(exDiv);
      if (d >= cutoff && d <= future) {
        const divRate = safeNum(sd.dividendRate);
        const rawYield = safeNum(sd.dividendYield);
        const payDate = toIso(cal.dividendDate);

        events.push({
          id: `exdiv-${sym}-${symIdx}`,
          symbol: sym,
          name,
          type: "exDividend",
          date: exDiv,
          source: meta.source,
          dividendAmount: divRate != null ? +(divRate / 4).toFixed(4) : null,
          dividendYield: rawYield != null ? +(rawYield * 100).toFixed(2) : null,
          paymentDate: payDate,
        });
      }
    }

    // ── Dividend payment date (distinct from ex-div) ──────────────────────
    const divDate = toIso(cal.dividendDate);
    const exDivStr = toIso(cal.exDividendDate);
    if (divDate && divDate !== exDivStr) {
      const d = new Date(divDate);
      if (d >= cutoff && d <= future) {
        events.push({
          id: `div-${sym}-${symIdx}`,
          symbol: sym,
          name,
          type: "dividend",
          date: divDate,
          source: meta.source,
        });
      }
    }

    symIdx++;
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return NextResponse.json({ events, portfolioSymbols, watchlistSymbols, unavailableSymbols } satisfies CalendarResponse);
}
