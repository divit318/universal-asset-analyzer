/**
 * The dashboard's one clock (audit NI-10/11).
 *
 * The Today page previously defined "today" five different ways: UTC slices in
 * the digest's event window, server-local dates in the brief's grounding facts,
 * viewer-local dates in the header, exchange-session dates in the stamped
 * metrics, and Date.now() everywhere else. Around a UTC midnight (8pm ET) those
 * clocks disagree, and a same-day macro event silently fell out of the
 * calendar window while "today's" P&L still described the finished session.
 *
 * The authoritative calendar day for this product is the US market session
 * day (America/New_York): every "today" that gates data (event windows,
 * grounding facts, session labels) reads from here. Viewer-local time is for
 * display only (the header's date line), never for slicing data.
 *
 * Pure; no I/O. Unit-tested in tests/home-facts.test.ts.
 */

const NY_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The current US market-session calendar day, as YYYY-MM-DD. */
export function marketToday(now: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD directly.
  return NY_DATE.format(now);
}

/** `marketToday` plus `days` calendar days, as YYYY-MM-DD. */
export function marketDayPlus(days: number, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + days * 86_400_000);
  return NY_DATE.format(shifted);
}
