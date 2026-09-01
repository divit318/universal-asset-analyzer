import { getQuoteSummary } from "./yahoo";
import { SP500, constituentsForSector } from "./sp500";
import { canonicalizeSector } from "./gics-sectors";
import type { PeerComparison, PeerMetricSet } from "./types";

const EMPTY: PeerMetricSet = { pe: null, roe: null, revenueGrowth: null, debtToEquity: null };

/** Median of a list, ignoring null/NaN. Pure / testable. */
export function median(nums: (number | null | undefined)[]): number | null {
  const xs = nums
    .filter((x): x is number => x != null && !Number.isNaN(x))
    .sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

interface RawPeer {
  financialData?: { returnOnEquity?: number; revenueGrowth?: number; debtToEquity?: number };
  summaryDetail?: { trailingPE?: number };
}

export function extractPeer(raw: RawPeer): PeerMetricSet {
  const fd = raw.financialData ?? {};
  return {
    pe: raw.summaryDetail?.trailingPE ?? null,
    roe: fd.returnOnEquity ?? null,
    revenueGrowth: fd.revenueGrowth ?? null,
    debtToEquity: fd.debtToEquity != null ? fd.debtToEquity / 100 : null,
  };
}

export function medianOf(peers: PeerMetricSet[]): PeerMetricSet {
  return {
    pe: median(peers.map((p) => p.pe)),
    roe: median(peers.map((p) => p.roe)),
    revenueGrowth: median(peers.map((p) => p.revenueGrowth)),
    debtToEquity: median(peers.map((p) => p.debtToEquity)),
  };
}

/** Canonical GICS-11 name → the label lib/sp500.ts's curated universe uses. */
const SP500_SECTOR_LABEL: Record<string, string> = {
  Technology: "Information Technology",
  Healthcare: "Health Care",
  "Consumer Cyclical": "Consumer Discretionary",
};

function sp500SectorLabel(canonical: string): string {
  return SP500_SECTOR_LABEL[canonical] ?? canonical;
}

function curatedSectorOf(symbol: string): string | null {
  return SP500.find((c) => c.symbol === symbol.toUpperCase())?.sector ?? null;
}

/**
 * Sector for ANY US-listed symbol: the curated map when the symbol is in it,
 * otherwise Yahoo's assetProfile sector canonicalized onto the curated
 * universe's labels. Peer comparison used to return empty for every symbol
 * outside the 84 curated names (observed: SYF), which rendered as a permanent
 * "Peer data unavailable" box and a "Missing: Peer comparison" claim.
 */
async function sectorOf(symbol: string): Promise<string | null> {
  const curated = curatedSectorOf(symbol);
  if (curated) return curated;
  try {
    const raw = (await getQuoteSummary(symbol, ["assetProfile"])) as {
      assetProfile?: { sector?: string };
    };
    const canonical = raw.assetProfile?.sector ? canonicalizeSector(raw.assetProfile.sector) : null;
    return canonical ? sp500SectorLabel(canonical) : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, { at: number; map: Record<string, PeerMetricSet> }>();
const TTL = 10 * 60 * 1000;

async function loadSectorMetrics(
  sector: string,
): Promise<Record<string, PeerMetricSet>> {
  const cached = cache.get(sector);
  if (cached && Date.now() - cached.at < TTL) return cached.map;

  const entries = await Promise.all(
    constituentsForSector(sector).map(async (c) => {
      try {
        const raw = (await getQuoteSummary(c.symbol, [
          "financialData",
          "summaryDetail",
        ])) as RawPeer;
        return [c.symbol, extractPeer(raw)] as const;
      } catch {
        return [c.symbol, EMPTY] as const;
      }
    }),
  );

  const map = Object.fromEntries(entries);
  cache.set(sector, { at: Date.now(), map });
  return map;
}

/**
 * NSE/BSE listings. The peer set below is the S&P 500, so an Indian name gets
 * benchmarked against US companies: TCS.NS resolved to "Information
 * Technology" and was compared with AAPL/MSFT/NVDA/…, reporting a peer median
 * P/E of 28x for an Indian IT company. Unlabelled and simply wrong.
 *
 * lib/research-bundle.ts already skipped this step for India, but that guard
 * only protected the Research page — lib/ai/context.ts (the AI's evidence),
 * lib/intel/engine.ts, and the /api/report export all called straight through
 * and got the US medians. The check belongs here, at the one place that can
 * guarantee it. India's real peer set comes from screener.in (RankedPeers).
 */
function isIndianListing(symbol: string): boolean {
  return /\.(NS|BO)$/i.test(symbol.trim());
}

/** Compare a symbol against the median of its S&P 500 sector peers. */
export async function getPeerComparison(symbol: string): Promise<PeerComparison> {
  if (isIndianListing(symbol)) {
    return { sector: "", peerCount: 0, target: EMPTY, median: EMPTY };
  }
  const sector = await sectorOf(symbol);
  if (!sector) return { sector: "", peerCount: 0, target: EMPTY, median: EMPTY };

  const sym = symbol.toUpperCase();
  const map = await loadSectorMetrics(sector);
  // A symbol outside the curated universe still compares against its
  // sector's curated peers — its own metrics are fetched directly.
  let target = map[sym] ?? EMPTY;
  if (!(sym in map)) {
    try {
      target = extractPeer(
        (await getQuoteSummary(sym, ["financialData", "summaryDetail"])) as RawPeer,
      );
    } catch {
      /* keep EMPTY — the peer medians still render */
    }
  }
  const peers = Object.entries(map)
    .filter(([s]) => s !== sym)
    .map(([, m]) => m);

  return { sector, peerCount: peers.length, target, median: medianOf(peers) };
}
