/**
 * RentCast API client — free-tier (50 calls/month) address search that backs
 * the Real Estate manual asset's "search instead of type it all in" flow.
 * Only called on-demand when a user searches an address in the Add Manual
 * Asset form (never on an auto-refresh path), and every result is cached
 * (lib/db.ts's real_estate_lookup_cache) so repeat lookups of the same
 * address don't spend budget.
 *
 * Requires RENTCAST_API_KEY (see .env.local) — when unset, every function
 * here returns null immediately so the caller falls back to manual entry.
 * Same non-fatal convention as lib/yahoo.ts/lib/edgar.ts: peripheral data
 * that isn't available is a null, never a thrown error.
 */

const RENTCAST_BASE = "https://api.rentcast.io/v1";

function apiKey(): string | null {
  const key = process.env.RENTCAST_API_KEY?.trim();
  return key ? key : null;
}

async function rentcastGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  const url = new URL(`${RENTCAST_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-Api-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** First present numeric field, tolerant of exact RentCast field-naming (their docs aren't machine-readable, so this hedges against a guessed name being slightly off rather than silently returning nothing). */
function firstNumber(obj: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function firstString(obj: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export type RealEstateSearchReason = "not_configured" | "not_found" | "error";

export interface RealEstateLookupResult {
  address: string;
  propertyType: string | null;
  squareFootage: number | null;
  yearBuilt: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Automated value estimate (AVM) — directional, not appraisal-grade. */
  estimatedValue: number | null;
  estimatedMonthlyRent: number | null;
  lastSalePrice: number | null;
  lastSaleDate: string | null;
}

/**
 * Searches one address across RentCast's property-records and AVM (value +
 * rent estimate) endpoints, normalizing all three into one result. Returns
 * null when the key is missing, the address doesn't resolve on any
 * endpoint, or every call fails — the API route treats that as "fall back
 * to manual entry", never as an error to surface to the user.
 */
export async function searchRealEstate(address: string): Promise<RealEstateLookupResult | null> {
  if (!apiKey()) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;

  const [records, value, rent] = await Promise.all([
    rentcastGet<unknown[]>("/properties", { address: trimmed }),
    rentcastGet<Record<string, unknown>>("/avm/value", { address: trimmed }),
    rentcastGet<Record<string, unknown>>("/avm/rent/long-term", { address: trimmed }),
  ]);

  const record = Array.isArray(records) && records.length > 0 ? (records[0] as Record<string, unknown>) : null;
  if (!record && !value && !rent) return null;

  return {
    address: firstString(record, ["formattedAddress", "address"]) ?? trimmed,
    propertyType: firstString(record, ["propertyType"]),
    squareFootage: firstNumber(record, ["squareFootage"]),
    yearBuilt: firstNumber(record, ["yearBuilt"]),
    bedrooms: firstNumber(record, ["bedrooms"]),
    bathrooms: firstNumber(record, ["bathrooms"]),
    estimatedValue: firstNumber(value, ["price", "value", "priceEstimate"]),
    estimatedMonthlyRent: firstNumber(rent, ["rent", "rentEstimate", "price"]),
    lastSalePrice: firstNumber(record, ["lastSalePrice"]),
    lastSaleDate: firstString(record, ["lastSaleDate"]),
  };
}
