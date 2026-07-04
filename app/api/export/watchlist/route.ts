import { listWatchlist } from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import type { Quote, WatchlistItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(val: string | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  // Wrap in quotes if it contains comma, quote, newline, or tab
  if (/[",\n\r\t]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmt(v: number | null, digits = 2): string {
  return v != null ? v.toFixed(digits) : "";
}

function fmtPct(v: number | null, digits = 2): string {
  if (v == null) return "";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function fmtMcap(v: number | null): string {
  if (v == null) return "";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

/** GET /api/export/watchlist — returns CSV with live quotes merged */
export async function GET(): Promise<Response> {
  const items: WatchlistItem[] = listWatchlist();

  const quoteMap: Record<string, Quote> = {};
  if (items.length > 0) {
    try {
      const quotes = await getQuotes(items.map((i) => i.symbol));
      for (const q of quotes) quoteMap[q.symbol] = q;
    } catch {
      // best-effort; proceed without live data
    }
  }

  const columns = [
    "Symbol",
    "Company Name",
    "Current Price",
    "Change Today (%)",
    "Market Cap",
    "52W High",
    "52W Low",
    "Target Price",
    "Drop Alert (%)",
    "Notes",
    "Added Date",
    "Days on Watchlist",
    "Status",
  ];

  const rows = items.map((item) => {
    const q = quoteMap[item.symbol];
    const price = q?.price ?? null;
    const targetHit = price != null && item.targetPrice != null && price >= item.targetPrice;
    const dropHit = price != null && item.alertPctDrop != null && q.changePercent <= -item.alertPctDrop;
    const status = targetHit ? "TARGET REACHED" : dropHit ? "DROP ALERT" : "Watching";
    return [
      esc(item.symbol),
      esc(item.name),
      price != null ? `$${price.toFixed(2)}` : "",
      q?.changePercent != null ? fmtPct(q.changePercent) : "",
      fmtMcap(q?.marketCap ?? null),
      q?.fiftyTwoWeekHigh != null ? `$${q.fiftyTwoWeekHigh.toFixed(2)}` : "",
      q?.fiftyTwoWeekLow != null ? `$${q.fiftyTwoWeekLow.toFixed(2)}` : "",
      item.targetPrice != null ? `$${item.targetPrice.toFixed(2)}` : "",
      item.alertPctDrop != null ? `${item.alertPctDrop}%` : "",
      esc(item.notes),
      new Date(item.addedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
      fmt(daysAgo(item.addedAt), 0),
      esc(status),
    ].join(",");
  });

  const date = new Date().toISOString().slice(0, 10);
  const metaLines = [
    `# Universal Asset Analyzer — Watchlist Export`,
    `# Generated: ${new Date().toLocaleString("en-US", { timeZoneName: "short" })}`,
    `# Symbols: ${items.length}`,
    `#`,
  ];

  const csv = [...metaLines, columns.join(","), ...rows].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="watchlist-${date}.csv"`,
    },
  });
}
