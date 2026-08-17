/**
 * Reference funds probed for co-membership evidence.
 *
 * The problem this solves: "AI Infrastructure" is a genuinely useful way to
 * group NVDA, AVGO and TSM, and it is also exactly the kind of label a language
 * model will happily invent for any five tickers you show it. So the label here
 * is never invented — it is *read off a disclosure*. If two of the book's
 * issuers both appear in SMH's published top-ten, that is a checkable fact with
 * a source and a date, and the evidence line names the fund so the user can go
 * look.
 *
 * Selection rules for this list:
 *   1. A liquid, widely-held US-listed fund whose top-ten the provider reports.
 *   2. A theme an investor would actually recognise as one economic exposure —
 *      not a style box, not a market-cap band, not a country wrapper.
 *   3. Distinct from the others. Two probes that resolve to the same set of
 *      names produce two identical drivers and halve the page's signal.
 *
 * Deliberately NOT here: broad market funds (VOO/SPY/QQQ). Everything is in
 * them, so "co-membership in SPY" would relate every large-cap to every other
 * and tell the user nothing. A probe earns its place by being selective.
 *
 * Cost: one cached `quoteSummary` call per probe, on the drivers pass only
 * (never the first paint). See lib/exposure/drivers.ts.
 */

export interface ThemeProbe {
  /** The reference fund whose disclosed constituents define membership. */
  symbol: string;
  /** The driver label when this probe fires. */
  label: string;
}

export const THEME_PROBES: ThemeProbe[] = [
  { symbol: "SMH", label: "Semiconductors" },
  { symbol: "IGV", label: "Enterprise Software" },
  { symbol: "SKYY", label: "Cloud Infrastructure" },
  { symbol: "IHAK", label: "Cybersecurity" },
  { symbol: "BOTZ", label: "Robotics & Automation" },
  { symbol: "ITA", label: "Aerospace & Defense" },
  { symbol: "XBI", label: "Biotechnology" },
  { symbol: "IHI", label: "Medical Devices" },
  { symbol: "ICLN", label: "Clean Energy" },
  { symbol: "XOP", label: "Oil & Gas Production" },
  { symbol: "KRE", label: "Regional Banks" },
  { symbol: "GDX", label: "Gold Miners" },
  { symbol: "LIT", label: "Lithium & Battery" },
  { symbol: "JETS", label: "Airlines" },
  { symbol: "IYT", label: "Freight & Transport" },
  { symbol: "XRT", label: "Retail" },
  { symbol: "PAVE", label: "US Infrastructure Buildout" },
  { symbol: "URA", label: "Uranium & Nuclear Fuel" },
];

export const PROBE_SYMBOLS: string[] = THEME_PROBES.map((p) => p.symbol);

/* ────────────────────────── Admission thresholds ────────────────────────── */

/**
 * A driver must reach this share of book to be drawn.
 *
 * The old graph's failure mode was volume: 74 nodes, most of them true and none
 * of them consequential. A shared exposure worth less than two points of a
 * portfolio is a fact about the market, not a fact about this book, and drawing
 * it costs the user the attention that belongs to the 17% one.
 */
export const MIN_DRIVER_BOOK_PCT = 2;

/** A driver relates issuers to each other; one issuer is a position, not a driver. */
export const MIN_DRIVER_ISSUERS = 2;

/**
 * Pairwise r at or above this joins two lines into one co-movement driver.
 *
 * Higher than the correlation-cluster detector's 0.85, which is asking a
 * different question (is this whole group one trade?). Here the threshold gates
 * a NODE the user will click, so it should fire on relationships that survive
 * inspection rather than on everything a rising market makes look related.
 */
export const CO_MOVEMENT_R = 0.8;

/**
 * How many issuers get an industry profile fetched.
 *
 * Ranked by effective weight, so the cut always falls on the names that move
 * the portfolio least. Beyond ~50 the marginal issuer is worth a few basis
 * points and costs a provider round-trip; the unresolved tail is disclosed
 * (ExposureDrivers.unresolved) rather than silently dropped.
 */
export const MAX_PROFILED_ISSUERS = 50;

/**
 * Issuers below this share of book are excluded from the model entirely.
 *
 * A 30-line book with 20 funds decomposes to ~250 issuers, most of them a
 * rounding error arriving through one fund's tenth-largest holding. Ten
 * meaningful nodes beat a hundred meaningless ones; the excluded tail is
 * summarised as a labelled band, never dropped in silence.
 */
export const MIN_ISSUER_BOOK_PCT = 0.1;
