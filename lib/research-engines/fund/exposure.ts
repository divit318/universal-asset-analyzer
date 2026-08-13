/**
 * "What you're actually buying" — the interpretation layer over FundProfileData.
 *
 * The fund engine already reports the facts (Technology 58%, Top 10 = 46%). This
 * module answers the question those facts are evidence FOR: what economic bet
 * does owning this fund actually place? It reads the mandate out of the
 * Morningstar category string, measures concentration off the disclosed
 * holdings, finds the sector cluster that carries the fund, and turns each into
 * a claim tagged with how it was arrived at.
 *
 * Two rules this module exists to keep:
 *
 *  1. NEVER restate a number the page already shows without adding a reading of
 *     it. Duplication was the failure mode; every `Claim` here is either a
 *     derived quantity or an interpretation.
 *
 *  2. NEVER imply coverage we don't have. Yahoo's topHoldings module discloses
 *     roughly the ten largest positions, NOT the full portfolio — so there is no
 *     honest way to compute a whole-fund Herfindahl, an "effective number of
 *     holdings", or a total holding count from it. Everything here is either
 *     complete by construction (sector weights sum to 100) or explicitly scoped
 *     to the disclosed slice, and `disclosedWeightPct` travels with the result
 *     so the UI can state the denominator.
 *
 * Pure, synchronous, zero-dependency (types only) and client-safe: the Research
 * Hub runs it in render off data it already has, with no fetch and no AI.
 */

import type { FundHolding, FundProfileData, FundSectorWeight } from "../../types";

/* -------------------------------------------------------------------------- */
/* Claim provenance                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How a statement came to be, so the UI can distinguish a reported figure from
 * a computed one from a judgement. The research page already discloses source
 * and freshness (lib/provenance.ts); this is the finer-grained axis that
 * provenance layer has no opinion on — "who decided this".
 */
export type ClaimBasis =
  /** Reported by the data provider verbatim (expense ratio, sector weights). */
  | "source"
  /** Arithmetic UAA performed on source figures (top-10 sum, shock impact). */
  | "calc"
  /** UAA's reading of what the numbers mean — a judgement, not a measurement. */
  | "read";

export interface Claim {
  text: string;
  basis: ClaimBasis;
}

/* -------------------------------------------------------------------------- */
/* Mandate — parsed out of the Morningstar category                            */
/* -------------------------------------------------------------------------- */

export type MandateSize = "large" | "mid" | "small" | null;
export type MandateStyle = "growth" | "value" | "blend" | null;
export type MandateAssetKind = "equity" | "bond" | "commodity" | "allocation" | "digital" | null;

export interface FundMandate {
  size: MandateSize;
  style: MandateStyle;
  /** Broad region the category names, e.g. "US", "Foreign developed", "Emerging markets". */
  geography: string | null;
  /** Single-sector mandates only ("Technology"), null for diversified funds. */
  sectorFocus: string | null;
  assetKind: MandateAssetKind;
  /** True when geography was inferred from a US listing rather than stated. */
  geographyInferred: boolean;
  /** The category string every field above was read out of — the provenance. */
  category: string | null;
}

const GEOGRAPHY_PATTERNS: [RegExp, string][] = [
  [/emerging|diversified emerg/i, "Emerging markets"],
  [/china|greater china/i, "China"],
  [/\bindia\b/i, "India"],
  [/japan/i, "Japan"],
  [/europe|eurozone/i, "Europe"],
  [/latin america/i, "Latin America"],
  [/pacific|asia/i, "Asia-Pacific"],
  [/global|world/i, "Global"],
  [/foreign|international|ex-us|ex us/i, "Foreign developed"],
];

const SECTOR_PATTERNS: [RegExp, string][] = [
  [/technology|\btech\b/i, "Technology"],
  [/health/i, "Healthcare"],
  [/financial/i, "Financials"],
  [/energy/i, "Energy"],
  [/utilit/i, "Utilities"],
  [/real estate|\breit\b/i, "Real Estate"],
  [/industrial/i, "Industrials"],
  [/communicat/i, "Communication Services"],
  [/consumer/i, "Consumer"],
  [/natural resources|precious metals|\bgold\b/i, "Natural Resources"],
];

/**
 * Read the mandate out of the Morningstar category. Categories are a controlled
 * vocabulary ("Large Growth", "Foreign Large Blend", "Intermediate Core Bond"),
 * which is exactly why they're parseable — this is not free-text guessing.
 *
 * `usListed` only ever supplies the *default* geography, and when it does the
 * result is flagged `geographyInferred` so the UI can hedge it. "Large Growth"
 * genuinely means US large-cap growth in Morningstar's scheme, but that is a
 * convention, not something the string says.
 */
export function parseMandate(category: string | null, usListed: boolean): FundMandate {
  if (!category) {
    return {
      size: null, style: null, geography: null, sectorFocus: null,
      assetKind: null, geographyInferred: false, category: null,
    };
  }

  const assetKind: MandateAssetKind =
    /\bbond\b|\bmuni\b|treasury|government|corporate|high yield|short-term|intermediate|long government/i.test(category) ? "bond"
    : /commodit|precious metals|natural resources/i.test(category) ? "commodity"
    : /digital assets|crypto/i.test(category) ? "digital"
    : /allocation|target-date|target date|balanced/i.test(category) ? "allocation"
    : "equity";

  // Size/style only mean anything for equity mandates — "Intermediate Core Bond"
  // must not be read as a mid-cap fund.
  const isEquity = assetKind === "equity";
  const size: MandateSize = !isEquity ? null
    : /large/i.test(category) ? "large"
    : /mid-cap|mid cap|\bmid\b/i.test(category) ? "mid"
    : /small/i.test(category) ? "small"
    : null;
  const style: MandateStyle = !isEquity ? null
    : /growth/i.test(category) ? "growth"
    : /value/i.test(category) ? "value"
    : /blend/i.test(category) ? "blend"
    : null;

  const geoMatch = GEOGRAPHY_PATTERNS.find(([re]) => re.test(category));
  const geography = geoMatch ? geoMatch[1] : usListed ? "US" : null;
  const geographyInferred = !geoMatch && usListed;

  const sectorMatch = isEquity ? SECTOR_PATTERNS.find(([re]) => re.test(category)) : null;

  return {
    size, style, geography,
    sectorFocus: sectorMatch ? sectorMatch[1] : null,
    assetKind, geographyInferred, category,
  };
}

/** One-line English rendering of the mandate, e.g. "US large-cap growth equity". */
export function describeMandate(m: FundMandate): string | null {
  // An unparsed mandate has nothing to say. Without this guard the `kindWord`
  // default below turns a fund whose category was never reported into a
  // confident "A equity portfolio" — asserting the one thing we don't know.
  if (m.assetKind == null && m.geography == null && m.size == null && m.style == null && m.sectorFocus == null) {
    return null;
  }

  const sizeWord = m.size === "large" ? "large-cap" : m.size === "mid" ? "mid-cap" : m.size === "small" ? "small-cap" : null;
  const kindWord =
    m.assetKind === "bond" ? "bond" :
    m.assetKind === "commodity" ? "commodity" :
    m.assetKind === "digital" ? "digital-asset" :
    m.assetKind === "allocation" ? "multi-asset" :
    m.sectorFocus ? `${m.sectorFocus.toLowerCase()} sector` : "equity";

  const parts = [m.geography, sizeWord, m.style, kindWord].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Concentration                                                               */
/* -------------------------------------------------------------------------- */

export interface ConcentrationProfile {
  /** How many holdings the provider actually disclosed (typically ~10). */
  disclosedCount: number;
  /** Their summed weight — THE denominator every disclosed-scope figure is against. */
  disclosedWeightPct: number;
  largest: FundHolding | null;
  /** Summed weight of the N largest disclosed positions; null when fewer than N exist. */
  top5Pct: number | null;
  top10Pct: number | null;
  /**
   * Percentage points the fund loses if the single largest holding falls 20%,
   * holding everything else still. Pure arithmetic (weight × 20%) — it is a
   * sensitivity, not a forecast, and deliberately ignores correlation.
   */
  largestNameShockPct: number | null;

  topSector: FundSectorWeight | null;
  top3SectorPct: number | null;
  /** Herfindahl over sector weights, 0–10000. Complete: sector weights sum to 100. */
  sectorHhi: number | null;
  /** The smallest set of top sectors that together clear half the fund. */
  clusterSectors: string[];
  clusterPct: number | null;
  /** Fund impact of a 10% drawdown across that whole cluster. */
  clusterShockPct: number | null;
}

const sumWeights = (hs: FundHolding[]) => hs.reduce((s, h) => s + h.weightPercent, 0);

export function analyzeConcentration(fund: FundProfileData): ConcentrationProfile {
  const holdings = fund.holdings.slice().sort((a, b) => b.weightPercent - a.weightPercent);
  const sectors = fund.sectorWeights.slice().sort((a, b) => b.weightPercent - a.weightPercent);

  const largest = holdings[0] ?? null;
  // Guarded: a fund disclosing 6 positions has no honest "top 10" figure, and
  // summing 6 of them under a "Top 10" label is exactly the overstatement this
  // module is supposed to prevent.
  const top5Pct = holdings.length >= 5 ? sumWeights(holdings.slice(0, 5)) : null;
  const top10Pct = holdings.length >= 10 ? sumWeights(holdings.slice(0, 10)) : null;

  const top3SectorPct = sectors.length >= 3 ? sectors.slice(0, 3).reduce((s, x) => s + x.weightPercent, 0) : null;
  const sectorHhi = sectors.length > 0
    ? Math.round(sectors.reduce((s, x) => s + x.weightPercent * x.weightPercent, 0))
    : null;

  // Walk the sorted sectors until they clear 50% — the answer to "how few
  // sectors is this fund really?". Stops as soon as the threshold is crossed,
  // so a genuinely broad fund yields a long list the UI can decline to call a
  // cluster, and a tech-heavy one yields two names.
  const clusterSectors: string[] = [];
  let clusterPct = 0;
  for (const s of sectors) {
    clusterSectors.push(s.sector);
    clusterPct += s.weightPercent;
    if (clusterPct >= 50) break;
  }

  return {
    disclosedCount: holdings.length,
    disclosedWeightPct: sumWeights(holdings),
    largest,
    top5Pct,
    top10Pct,
    largestNameShockPct: largest ? (largest.weightPercent * 20) / 100 : null,
    topSector: sectors[0] ?? null,
    top3SectorPct,
    sectorHhi,
    clusterSectors: clusterPct >= 50 ? clusterSectors : [],
    clusterPct: clusterPct >= 50 ? clusterPct : null,
    clusterShockPct: clusterPct >= 50 ? (clusterPct * 10) / 100 : null,
  };
}

/* -------------------------------------------------------------------------- */
/* The composed exposure read                                                  */
/* -------------------------------------------------------------------------- */

export interface FundExposure {
  mandate: FundMandate;
  concentration: ConcentrationProfile;
  /** One sentence: what economic bet this fund actually is. */
  headline: string | null;
  /** The implicit bets — things true of the portfolio that its name doesn't say. */
  bets: Claim[];
  /** Compact facts for the scannable chip row. */
  chips: { label: string; value: string; basis: ClaimBasis }[];
}

const pct0 = (v: number) => `${Math.round(v)}%`;
const pct1 = (v: number) => `${v.toFixed(1)}%`;

/** Join a list conversationally: ["a","b","c"] → "a, b and c". */
function andList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function deriveFundExposure(fund: FundProfileData, usListed: boolean): FundExposure {
  const mandate = parseMandate(fund.category, usListed);
  const concentration = analyzeConcentration(fund);
  const { clusterSectors, clusterPct, top10Pct, largest, topSector } = concentration;

  /* ── Headline ────────────────────────────────────────────────────────────
     Built from the two things that most often contradict a fund's name: the
     sector cluster it actually rests on, and how much of it the biggest
     positions are. When neither is measurable the mandate alone is stated
     rather than a sentence padded out to look complete. */
  const mandateWords = describeMandate(mandate);
  let headline: string | null = null;
  if (mandateWords) {
    const clauses: string[] = [];
    if (clusterPct != null && clusterSectors.length > 0 && clusterSectors.length <= 3) {
      clauses.push(`${andList(clusterSectors).toLowerCase()} ${clusterSectors.length === 1 ? "is" : "are"} ${pct0(clusterPct)} of assets`);
    } else if (topSector) {
      clauses.push(`${topSector.sector.toLowerCase()} alone is ${pct0(topSector.weightPercent)}`);
    }
    if (top10Pct != null) clauses.push(`the ten largest positions are ${pct0(top10Pct)}`);

    headline = clauses.length > 0
      ? `A ${mandateWords} portfolio that is, economically, a concentrated bet: ${andList(clauses)}.`
      : `A ${mandateWords} portfolio.`;

    // "Concentrated bet" is a claim, not a template — a fund whose top cluster
    // is under half and whose top 10 is modest gets the plain reading instead.
    const economicallyConcentrated =
      (clusterPct != null && clusterPct >= 60) || (top10Pct != null && top10Pct >= 35);
    if (!economicallyConcentrated && clauses.length > 0) {
      headline = `A ${mandateWords} portfolio, spread broadly: ${andList(clauses)}.`;
    }
  }

  /* ── Implicit bets ───────────────────────────────────────────────────────── */
  const bets: Claim[] = [];

  if (clusterPct != null && clusterSectors.length > 0 && clusterSectors.length <= 3 && clusterPct >= 55) {
    bets.push({
      basis: "read",
      text: `Owning this is mostly owning ${andList(clusterSectors).toLowerCase()} — ${pct0(clusterPct)} of assets sit in ${clusterSectors.length === 1 ? "that sector" : `those ${clusterSectors.length} sectors`}. A 10% drawdown across ${clusterSectors.length === 1 ? "it" : "them"} costs the fund roughly ${concentration.clusterShockPct!.toFixed(1)}pp before any correlation effects.`,
    });
  }

  if (largest && largest.weightPercent >= 6) {
    bets.push({
      basis: "read",
      text: `Single-name risk is real: ${largest.symbol || largest.name} alone is ${pct1(largest.weightPercent)} of the fund, so a 20% fall in that one holding takes about ${concentration.largestNameShockPct!.toFixed(1)}pp off the fund.`,
    });
  }

  if (top10Pct != null && top10Pct >= 40) {
    bets.push({
      basis: "read",
      text: `Headline breadth overstates real diversification — the ten largest positions carry ${pct0(top10Pct)} of assets, so the long tail of remaining holdings moves the fund very little.`,
    });
  }

  const stock = fund.assetAllocation.stock;
  const bond = fund.assetAllocation.bond;
  const cash = fund.assetAllocation.cash;
  if (stock != null && stock >= 95 && (bond ?? 0) < 2) {
    bets.push({
      basis: "read",
      text: `Fully invested in equities (${pct0(stock)} stock${cash != null && cash >= 0.5 ? `, ${pct1(cash)} cash` : ", no meaningful cash buffer"}) — there is no bond or cash ballast to soften an equity drawdown.`,
    });
  } else if (bond != null && bond >= 60) {
    bets.push({
      basis: "read",
      text: `Primarily a rates instrument (${pct0(bond)} bonds) — its dominant risk is interest rates and credit, not company earnings.`,
    });
  }

  if (mandate.style === "growth") {
    bets.push({
      basis: "read",
      text: `A growth mandate is a duration bet: the value of these holdings sits in distant earnings, which is what makes them sensitive to the discount rate as well as to their own results.`,
    });
  }

  if (fund.turnoverPercent != null && fund.turnoverPercent >= 0.75) {
    bets.push({
      basis: "read",
      text: `Turnover runs at ${pct0(fund.turnoverPercent * 100)} a year — the portfolio is largely rebuilt annually, so realised holdings can drift a long way from the disclosure above.`,
    });
  }

  /* ── Scannable chips ─────────────────────────────────────────────────────── */
  const chips: FundExposure["chips"] = [];
  if (mandateWords) chips.push({ label: "Mandate", value: mandateWords, basis: "calc" });
  if (clusterPct != null && clusterSectors.length > 0 && clusterSectors.length <= 3) {
    chips.push({ label: "Rests on", value: `${andList(clusterSectors)} · ${pct0(clusterPct)}`, basis: "calc" });
  }
  if (top10Pct != null) chips.push({ label: "Top 10", value: pct0(top10Pct), basis: "calc" });
  if (largest) chips.push({ label: "Largest", value: `${largest.symbol || largest.name} ${pct1(largest.weightPercent)}`, basis: "source" });
  if (stock != null) {
    const mix = [
      stock >= 1 ? `${pct0(stock)} stock` : null,
      bond != null && bond >= 1 ? `${pct0(bond)} bond` : null,
      cash != null && cash >= 1 ? `${pct0(cash)} cash` : null,
    ].filter(Boolean).join(" / ");
    if (mix) chips.push({ label: "Asset mix", value: mix, basis: "source" });
  }

  return { mandate, concentration, headline, bets, chips };
}
