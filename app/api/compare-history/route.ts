import { getHistory, getQuote } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** Fetch the current USD exchange rate for a non-USD currency via Yahoo Finance.
 *  Uses the {CURRENCY}USD=X pair (e.g. INRUSD=X → value of 1 INR in USD).
 *  Returns null if the rate can't be fetched. */
async function getFxRateToUsd(currency: string): Promise<number | null> {
  if (currency === "USD") return 1;
  try {
    const pair = `${currency}USD=X`;
    const q = await getQuote(pair);
    const rate = q?.price;
    return rate != null && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 5);
  const days = Math.min(parseInt(searchParams.get("days") ?? "365", 10), 5 * 365);

  if (!symbols.length) return Response.json({ error: "symbols required" }, { status: 400 });

  // Fetch history + currency info for all symbols in parallel
  const results = await Promise.allSettled(
    symbols.map(async (s) => {
      const [history, quote] = await Promise.all([
        getHistory(s, days + 10),
        getQuote(s).catch(() => null),
      ]);
      return { symbol: s, history, currency: quote?.currency ?? "USD" };
    }),
  );

  // Determine which currencies need FX conversion
  const currencyMap: Record<string, string> = {};
  for (const r of results) {
    if (r.status === "fulfilled") currencyMap[r.value.symbol] = r.value.currency;
  }
  const uniqueCurrencies = [...new Set(Object.values(currencyMap))].filter((c) => c !== "USD");

  // Fetch FX rates once per unique non-USD currency
  const fxRates: Record<string, number> = { USD: 1 };
  await Promise.allSettled(
    uniqueCurrencies.map(async (c) => {
      const rate = await getFxRateToUsd(c);
      if (rate != null) fxRates[c] = rate;
    }),
  );

  // Build response — convert prices to USD where possible
  const data: Record<string, { date: string; close: number; adjClose: number }[]> = {};
  const convertedSymbols: string[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { symbol, history, currency } = r.value;
    const rate = fxRates[currency] ?? null;
    const needsConversion = currency !== "USD" && rate != null;

    if (needsConversion) convertedSymbols.push(symbol);

    data[symbol] = history.map((p) => {
      const adj = p.adjClose ?? p.close;
      return {
        date: p.date,
        close: needsConversion ? +(p.close * rate!).toFixed(4) : p.close,
        adjClose: needsConversion ? +(adj * rate!).toFixed(4) : adj,
      };
    });
  }

  return Response.json({ ...data, _meta: { currencies: currencyMap, convertedToUsd: convertedSymbols } });
}
