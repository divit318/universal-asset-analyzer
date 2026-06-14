import { getQuoteSummary } from "./yahoo";
import { SP500, constituentsForSector } from "./sp500";
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

function sectorOf(symbol: string): string | null {
  return SP500.find((c) => c.symbol === symbol.toUpperCase())?.sector ?? null;
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

/** Compare a symbol against the median of its S&P 500 sector peers. */
export async function getPeerComparison(symbol: string): Promise<PeerComparison> {
  const sector = sectorOf(symbol);
  if (!sector) return { sector: "", peerCount: 0, target: EMPTY, median: EMPTY };

  const sym = symbol.toUpperCase();
  const map = await loadSectorMetrics(sector);
  const target = map[sym] ?? EMPTY;
  const peers = Object.entries(map)
    .filter(([s]) => s !== sym)
    .map(([, m]) => m);

  return { sector, peerCount: peers.length, target, median: medianOf(peers) };
}
