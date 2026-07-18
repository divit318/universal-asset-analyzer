import type { MarketRegion } from "./market";

/**
 * Approximate open/closed status for a listing market. This is a plain
 * weekday + standard-hours heuristic — it has no exchange holiday calendar
 * and does not account for early closes, so it can be wrong around holidays.
 * There is no real-time market-calendar data source anywhere in this app;
 * this is deliberately labeled "approximate" everywhere it's surfaced rather
 * than presented as a verified fact.
 */
const HOURS: Record<Exclude<MarketRegion, "CRYPTO">, { timeZone: string; openMinute: number; closeMinute: number }> = {
  US: { timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60 },
  IN: { timeZone: "Asia/Kolkata", openMinute: 9 * 60 + 15, closeMinute: 15 * 60 + 30 },
  JP: { timeZone: "Asia/Tokyo", openMinute: 9 * 60, closeMinute: 15 * 60 },
  HK: { timeZone: "Asia/Hong_Kong", openMinute: 9 * 60 + 30, closeMinute: 16 * 60 },
  AU: { timeZone: "Australia/Sydney", openMinute: 10 * 60, closeMinute: 16 * 60 },
  EU: { timeZone: "Europe/Paris", openMinute: 9 * 60, closeMinute: 17 * 60 + 30 },
};

/** Minutes since midnight and day-of-week (0 = Sunday) for `date` in `timeZone`, without any getTimezoneOffset arithmetic. */
function partsInZone(date: Date, timeZone: string): { weekday: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayStr);
  return { weekday, minutesOfDay: hour * 60 + minute };
}

/** Approximate open/closed for a market region — see module doc-comment for the accuracy caveat. */
export function estimateMarketStatus(region: MarketRegion, now: Date = new Date()): "open" | "closed" {
  if (region === "CRYPTO") return "open";
  const hours = HOURS[region];
  const { weekday, minutesOfDay } = partsInZone(now, hours.timeZone);
  if (weekday === 0 || weekday === 6) return "closed";
  return minutesOfDay >= hours.openMinute && minutesOfDay < hours.closeMinute ? "open" : "closed";
}
