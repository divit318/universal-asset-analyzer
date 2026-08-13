/**
 * Live harness for the Indian news pipeline (lib/india-news.ts).
 *
 * Fetches real NSE announcements + Google News India coverage for a spread of
 * Indian listings (large/mid/small cap, across sectors) and prints what a user
 * would see, so relevance can be verified by eye:
 *
 *   npx tsx scripts/india-news-harness.ts             # default 16-stock panel
 *   npx tsx scripts/india-news-harness.ts TCS.NS      # specific symbols
 *
 * Free sources only — no keys, no spend. Hits NSE + Google News + Yahoo
 * (name lookup), so expect ~10-20s for the full panel.
 */

import { getIndianCompanyNews, getIndianFilings } from "../lib/india-news";
import { getQuote } from "../lib/yahoo";

const PANEL = [
  // Large caps across sectors
  "RELIANCE.NS",   // energy/conglomerate
  "HDFCBANK.NS",   // bank (the HDFC-siblings matching trap)
  "TCS.NS",        // IT (alias-dependent: headlines say "TCS")
  "HINDUNILVR.NS", // FMCG (alias HUL)
  "SUNPHARMA.NS",  // pharma
  "LT.NS",         // industrials (alias L&T)
  "TATAMOTORS.NS", // auto (Tata-siblings trap)
  "SBIN.NS",       // PSU bank
  "BHARTIARTL.NS", // telecom
  // Mid caps
  "IRCTC.NS",      // travel/PSU
  "PERSISTENT.NS", // IT midcap
  "ASTRAL.NS",     // building materials
  "APLAPOLLO.NS",  // steel tubes
  // Small / less-followed
  "GRAVITA.NS",    // small cap recycling
  "KIRLOSENG.NS",  // small cap industrials
  // BSE-suffix routing check
  "TATASTEEL.BO",
];

function fmt(iso: string): string {
  return iso.slice(0, 10);
}

async function main() {
  const symbols = process.argv.slice(2).length > 0 ? process.argv.slice(2) : PANEL;

  for (const symbol of symbols) {
    const name = await getQuote(symbol).then((q) => q.name, () => "(name unavailable)");
    console.log(`\n${"=".repeat(78)}\n${symbol} — ${name}\n${"=".repeat(78)}`);

    const [news, filings] = await Promise.all([
      getIndianCompanyNews(symbol, 8),
      getIndianFilings(symbol, 5),
    ]);

    console.log(`\n  Developments (${news.length}):`);
    for (const n of news) {
      const cat = n.category && n.category !== "news" ? ` [${n.category}]` : "";
      console.log(`   • ${fmt(n.publishedAt)}  ${n.headline.slice(0, 90)}`);
      console.log(`     ${n.source}${cat}`);
    }
    if (news.length === 0) console.log("   (none — check source availability)");

    console.log(`\n  NSE filings (${filings.length}):`);
    for (const f of filings) {
      console.log(`   • ${fmt(f.filedAt)}  [${f.form}] ${f.description.slice(0, 80)}`);
    }
    if (filings.length === 0) console.log("   (none)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
