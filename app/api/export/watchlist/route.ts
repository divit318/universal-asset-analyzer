import { getFreshFundamentals, listWatchlist, listWatchlistByGroup } from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { STAGE_LABEL } from "@/lib/idea-stage";
import {
  formatAge,
  isTargetReached,
  percentFrom52WeekHigh,
  rangePosition52Week,
  resolveTargetDirection,
  upsidePercent,
} from "@/lib/watchlist-metrics";
import type { Quote, WatchlistItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The watchlist as CSV.
 *
 * Column names and semantics track the page exactly, which they previously did
 * not: the file said "Target Price" for what the UI now calls "My target", it had
 * no upside column at all, and its Status field computed `price >= target`
 * independently of both the page and the notification engine — a third
 * implementation of the same rule. All of the arithmetic now comes from
 * `lib/watchlist-metrics.ts`.
 */

function esc(val: string | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  // Wrap in quotes if it contains comma, quote, newline, or tab
  if (/[",\n\r\t]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** A plain decimal for a spreadsheet — no currency glyph, no thousands separator. */
function num(v: number | null | undefined, digits = 2): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : "";
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function fmtMcap(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}

/**
 * GET /api/export/watchlist[?group=2] — CSV with live quotes merged.
 *
 * Scoped to one named list when `group` is supplied, so "export what I'm looking
 * at" matches the screen; unscoped it exports everything tracked, which is the
 * pre-named-lists behaviour.
 */
export async function GET(request: Request): Promise<Response> {
  const groupParam = new URL(request.url).searchParams.get("group");
  const groupId = groupParam != null && Number.isInteger(Number(groupParam)) ? Number(groupParam) : null;
  const items: WatchlistItem[] = groupId != null ? listWatchlistByGroup(groupId) : listWatchlist();

  const quoteMap: Record<string, Quote> = {};
  if (items.length > 0) {
    try {
      const quotes = await getQuotes(items.map((i) => i.symbol));
      for (const q of quotes) quoteMap[q.symbol] = q;
    } catch {
      // best-effort; proceed without live data
    }
  }

  // Sector comes from the shared fundamentals cache, the same join /api/watchlist
  // does. `listWatchlist` alone does not carry it, so the column was silently
  // empty for every row.
  const sectorBySymbol = new Map<string, string | null>();
  const consensusBySymbol = new Map<string, { mean: number | null; opinions: number | null }>();
  try {
    const { rows } = getFreshFundamentals(7 * 24 * 60 * 60 * 1000);
    for (const r of rows) {
      sectorBySymbol.set(r.symbol, r.sector ?? null);
      consensusBySymbol.set(r.symbol, {
        mean: r.analystTargetMean ?? null,
        opinions: r.analystOpinions ?? null,
      });
    }
  } catch {
    /* sector/consensus are enhancements — empty columns beat a failed export */
  }

  const columns = [
    "Symbol",
    "Company Name",
    "Currency",
    "Last Price",
    "Change Today (%)",
    "My Price Target",
    "Target Trigger",
    "Upside (%)",
    "Analyst Consensus Target",
    "Analyst Count",
    "Consensus Upside (%)",
    "From 52W High (%)",
    "52W Range Position (%)",
    "52W Low",
    "52W High",
    "Market Cap",
    "Drop Alert (%)",
    "Idea Stage",
    "Sector",
    "Thesis",
    "Added Date",
    "Days on Watchlist",
    "Status",
  ];

  const rows = items.map((item) => {
    const q = quoteMap[item.symbol];
    const price = q?.price ?? null;
    const direction = resolveTargetDirection(item.targetDirection, item.targetPrice, price);
    const targetHit = isTargetReached(price, item.targetPrice, direction);
    const dropHit =
      q != null && item.alertPctDrop != null && q.changePercent <= -Math.abs(item.alertPctDrop);
    const status = targetHit ? "TARGET REACHED" : dropHit ? "DROP ALERT" : "Watching";
    const consensus = consensusBySymbol.get(item.symbol);

    return [
      esc(item.symbol),
      esc(item.name),
      esc(q?.currency ?? ""),
      num(price),
      fmtPct(q?.changePercent ?? null),
      num(item.targetPrice),
      // Spelled out rather than "above"/"below", so the file is readable without
      // the app to explain it.
      item.targetPrice != null
        ? direction === "above"
          ? "Rises to or above"
          : "Falls to or below"
        : "",
      fmtPct(upsidePercent(price, item.targetPrice)),
      // The street's target, kept in its own columns so it can never be mistaken
      // for the user's own.
      num(consensus?.mean ?? null),
      consensus?.opinions != null ? String(consensus.opinions) : "",
      fmtPct(upsidePercent(price, consensus?.mean ?? null)),
      fmtPct(percentFrom52WeekHigh(price, q?.fiftyTwoWeekHigh)),
      num(rangePosition52Week(price, q?.fiftyTwoWeekLow, q?.fiftyTwoWeekHigh), 1),
      num(q?.fiftyTwoWeekLow ?? null),
      num(q?.fiftyTwoWeekHigh ?? null),
      fmtMcap(q?.marketCap ?? null),
      num(item.alertPctDrop, 1),
      esc(STAGE_LABEL[item.stage]),
      esc(item.sector ?? sectorBySymbol.get(item.symbol) ?? ""),
      esc(item.notes),
      // ISO, and escaped. The localized "Jul 26, 2026" this used to emit contains
      // a comma and was written raw, so it split into two fields and shifted
      // every column after it — silently corrupting the last three columns of
      // every row in the file. An ISO date also sorts correctly in a spreadsheet.
      esc(item.addedAt.slice(0, 10)),
      esc(formatAge(item.addedAt)),
      esc(status),
    ].join(",");
  });

  const date = new Date().toISOString().slice(0, 10);
  const metaLines = [
    `# Universal Asset Analyzer — Watchlist Export`,
    `# Generated: ${new Date().toLocaleString("en-US", { timeZoneName: "short" })}`,
    `# Symbols: ${items.length}`,
    `# "My Price Target" is your own target, not the analyst consensus.`,
    `# "Upside (%)" is (target - price) / price. Prices are in each row's own currency.`,
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
