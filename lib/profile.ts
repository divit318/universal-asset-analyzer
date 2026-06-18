import { getQuoteSummary } from "./yahoo";
import type { CompanyProfile } from "./ai/types";

/**
 * Company profile: the long business description, sector/industry, headcount,
 * ownership structure, and key officers. These power "explain the business
 * model" / "management quality" / "ownership" questions that the screener's
 * numeric fundamentals don't cover.
 */

const MODULES = [
  "assetProfile",
  "summaryProfile",
  "defaultKeyStatistics",
  "majorHoldersBreakdown",
];

interface RawOfficer {
  name?: string;
  title?: string;
}
interface RawProfileSummary {
  assetProfile?: {
    longBusinessSummary?: string;
    sector?: string;
    industry?: string;
    country?: string;
    website?: string;
    fullTimeEmployees?: number;
    companyOfficers?: RawOfficer[];
  };
  summaryProfile?: { longBusinessSummary?: string; sector?: string; industry?: string };
  defaultKeyStatistics?: { enterpriseValue?: number };
  majorHoldersBreakdown?: {
    insidersPercentHeld?: number;
    institutionsPercentHeld?: number;
  };
}

const pct = (v: number | undefined): number | null =>
  v == null || Number.isNaN(v) ? null : v * 100;

export function mapProfile(symbol: string, raw: RawProfileSummary): CompanyProfile {
  const ap = raw.assetProfile ?? {};
  const sp = raw.summaryProfile ?? {};
  const ks = raw.defaultKeyStatistics ?? {};
  const mh = raw.majorHoldersBreakdown ?? {};

  const officers = (ap.companyOfficers ?? [])
    .filter((o): o is { name: string; title: string } => Boolean(o.name && o.title))
    .slice(0, 6)
    .map((o) => ({ name: o.name, title: o.title }));

  return {
    symbol,
    description: ap.longBusinessSummary ?? sp.longBusinessSummary ?? null,
    sector: ap.sector ?? sp.sector ?? null,
    industry: ap.industry ?? sp.industry ?? null,
    country: ap.country ?? null,
    website: ap.website ?? null,
    employees: ap.fullTimeEmployees ?? null,
    enterpriseValue: ks.enterpriseValue ?? null,
    institutionalOwnership: pct(mh.institutionsPercentHeld),
    insiderOwnership: pct(mh.insidersPercentHeld),
    officers,
  };
}

/** Fetch + map a company's profile. Throws only on a hard Yahoo failure. */
export async function getCompanyProfile(symbol: string): Promise<CompanyProfile> {
  const raw = (await getQuoteSummary(symbol, MODULES)) as RawProfileSummary;
  return mapProfile(symbol, raw);
}
