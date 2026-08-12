/**
 * The Asset Registry — platform-wide shared infrastructure.
 *
 * Import from here, not from the individual class files. Any module that needs
 * to know something about an asset class (what you can filter it by, how it
 * ranks, what it's called, whether Portfolio can hold it) should ask the
 * registry rather than carrying its own switch statement.
 */

export type {
  AssetClassId,
  AssetClassDefinition,
  BaseAssetClassId,
  MarketVariantAssetClassId,
  Capability,
  FilterDef,
  FilterKind,
  FilterValue,
  FilterValues,
  MetricAvailability,
  MetricDef,
  RankFactor,
  ResultColumnDef,
  TemplateDef,
} from "./types";
export { ASSET_CLASS_IDS } from "./types";

export {
  assetClassesWith,
  availableMetrics,
  can,
  getAssetClass,
  getFilterGroups,
  getFilters,
  getMetric,
  getRanking,
  getTemplate,
  isAssetClassId,
  isMarketVariant,
  listAssetClasses,
  listBaseAssetClasses,
  unavailableMetrics,
  universeLabel,
} from "./registry";
