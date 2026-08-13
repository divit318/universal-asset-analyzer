import { pageRawScreener, q } from "../lib/yahoo-screener";
async function main() {
  const rows = await pageRawScreener(
    {
      quoteType: "EQUITY",
      query: q.and(q.eq("region", "in"), q.gte("intradaymarketcap", 2e10)), // > ₹2,000 Cr
      sortField: "intradaymarketcap",
      sortDir: "desc",
    },
    30,
  );
  console.log("rows:", rows.length);
  for (const r of rows.slice(0, 12)) console.log(r.symbol, "|", r.longName ?? r.shortName, "| exch:", r.exchange, "| mcap:", r.marketCap ?? r.intradaymarketcap);
  const exchanges = new Set(rows.map((r) => r.exchange));
  console.log("exchanges seen:", [...exchanges]);
}
main();
