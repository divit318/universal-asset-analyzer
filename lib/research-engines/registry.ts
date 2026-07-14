/**
 * Asset class → research engine. This is the whole "routing" step: the
 * Research Hub page calls detectAssetClass(quote) then looks the result up
 * here. Adding class 13 means adding one entry, not touching the page.
 *
 * Equity is intentionally absent (see lib/research-engines/types.ts) — its
 * behavior isn't routed through this registry yet, it's still the page's
 * default/fallback path. Every entry added here is a real, working engine;
 * this registry is not a place to pre-declare stubs for classes that don't
 * have one, so callers can safely treat "not in the map" as "use the
 * existing equity-shaped rendering" rather than crashing on an empty engine.
 */

import type { AssetClass } from "../asset-class";
import type { ResearchEngine } from "./types";
import { fundEngine } from "./fund";
import { cryptoEngine } from "./crypto";
import { commodityEngine } from "./commodity";
import { forexEngine } from "./forex";

// TS has no clean existential type for "ResearchEngine<T> for some T", so the
// map is typed with `unknown` and each engine is cast once, here, at the
// single point it enters the type-erased registry — callers that already
// know the asset class (e.g. the fund tab renderer) re-narrow with a type
// guard on `assetClass` rather than trusting this cast blindly.
const REGISTRY: Partial<Record<AssetClass, ResearchEngine<unknown>>> = {
  fund: fundEngine as unknown as ResearchEngine<unknown>,
  crypto: cryptoEngine as unknown as ResearchEngine<unknown>,
  commodity: commodityEngine as unknown as ResearchEngine<unknown>,
  forex: forexEngine as unknown as ResearchEngine<unknown>,
};

export function getResearchEngine(assetClass: AssetClass): ResearchEngine<unknown> | null {
  return REGISTRY[assetClass] ?? null;
}
