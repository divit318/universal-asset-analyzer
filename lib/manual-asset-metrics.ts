/**
 * Async orchestration wrapper around lib/manual-asset-analysis.ts's pure
 * compute*Metrics functions: fetches live underlying quotes for structured
 * products (the one category whose metrics need a live feed) and dispatches
 * by category. Kept separate from manual-asset-analysis.ts so that file can
 * stay pure/testable with no dependency on lib/yahoo.ts.
 */

import { getQuotes } from "./yahoo";
import type { ManualAsset } from "./types";
import {
  computeAlternativeMetrics,
  computePrivateMarketMetrics,
  computeRealEstateMetrics,
  computeStructuredProductMetrics,
  type AlternativeMetrics,
  type PrivateMarketMetrics,
  type RealEstateMetrics,
  type StructuredProductMetrics,
} from "./manual-asset-analysis";

export type ManualAssetMetrics = RealEstateMetrics | PrivateMarketMetrics | AlternativeMetrics | StructuredProductMetrics;

export async function computeManualAssetMetrics(asset: ManualAsset): Promise<ManualAssetMetrics> {
  switch (asset.category) {
    case "real_estate":
      return computeRealEstateMetrics(asset);
    case "private_market":
      return computePrivateMarketMetrics(asset);
    case "alternative":
      return computeAlternativeMetrics(asset);
    case "structured_product": {
      const quotes = await getQuotes(asset.details.underlyingSymbols).catch(() => []);
      const currentPrices: Record<string, number | null> = {};
      for (const symbol of asset.details.underlyingSymbols) {
        currentPrices[symbol] = quotes.find((q) => q.symbol === symbol)?.price ?? null;
      }
      return computeStructuredProductMetrics(asset, currentPrices);
    }
  }
}
