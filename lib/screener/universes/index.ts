/**
 * Asset class → universe provider. The other half of the "add a class = add a
 * file" property: the registry (lib/assets/) says what a class *is*, this says
 * where its rows come from. Nothing else in the screener needs to change.
 */

import type { AssetClassId } from "../../assets/types";
import type { UniverseProvider } from "../universe-cache";
import { equityUniverse } from "./equity";
import { indiaEquityUniverse } from "./india-equity";
import { etfUniverse } from "./etf";
import { reitUniverse } from "./reit";
import { cryptoUniverse } from "./crypto";
import { commodityUniverse } from "./commodity";
import { bondUniverse } from "./bond";
import { forexUniverse } from "./forex";

const PROVIDERS: Record<AssetClassId, UniverseProvider> = {
  equity: equityUniverse,
  indiaEquity: indiaEquityUniverse,
  etf: etfUniverse,
  reit: reitUniverse,
  crypto: cryptoUniverse,
  commodity: commodityUniverse,
  bond: bondUniverse,
  forex: forexUniverse,
};

export function getUniverseProvider(id: AssetClassId): UniverseProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`No universe provider registered for asset class: ${id}`);
  return provider;
}
