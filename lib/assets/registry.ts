/**
 * The Asset Registry — the single source of truth for every supported asset
 * class across UAA.
 *
 * Adding an eighth asset class should be: write one definition file, add one
 * line to DEFINITIONS below, implement its universe provider
 * (lib/screener/universes/) and its research engine
 * (lib/research-engines/). No page, no API route, and no other asset class's
 * code should need to change — that's the property this file exists to buy,
 * and the reason the screener UI/API below it are written against
 * `getAssetClass(id)` rather than against any concrete class.
 *
 * Deliberately NOT a place for per-class *behavior* (fetching, scoring): those
 * live in the universe providers and research engines respectively. This holds
 * only *configuration* — what a class is, what you can filter it by, how it
 * ranks, how it renders.
 */

import type {
  AssetClassDefinition,
  AssetClassId,
  Capability,
  FilterDef,
  MetricDef,
  RankFactor,
} from "./types";
import { ASSET_CLASS_IDS } from "./types";
import { equityClass } from "./equity";
import { etfClass } from "./etf";
import { reitClass } from "./reit";
import { cryptoClass } from "./crypto";
import { commodityClass } from "./commodity";
import { bondClass } from "./bond";
import { forexClass } from "./forex";

const DEFINITIONS: Record<AssetClassId, AssetClassDefinition> = {
  equity: equityClass,
  etf: etfClass,
  reit: reitClass,
  crypto: cryptoClass,
  commodity: commodityClass,
  bond: bondClass,
  forex: forexClass,
};

export function getAssetClass(id: AssetClassId): AssetClassDefinition {
  const def = DEFINITIONS[id];
  if (!def) throw new Error(`Unknown asset class: ${id}`);
  return def;
}

/** Narrowing gate for untrusted input (query params, request bodies, saved rows). */
export function isAssetClassId(v: unknown): v is AssetClassId {
  return typeof v === "string" && (ASSET_CLASS_IDS as string[]).includes(v);
}

export function listAssetClasses(): AssetClassDefinition[] {
  return ASSET_CLASS_IDS.map((id) => DEFINITIONS[id]);
}

/** Classes that support a given capability — e.g. everything Portfolio can hold. */
export function assetClassesWith(capability: Capability): AssetClassDefinition[] {
  return listAssetClasses().filter((d) => d.capabilities.includes(capability));
}

export function can(id: AssetClassId, capability: Capability): boolean {
  return DEFINITIONS[id]?.capabilities.includes(capability) ?? false;
}

/* -------------------------------------------------------------------------- */
/* Metric lookup                                                               */
/* -------------------------------------------------------------------------- */

export function getMetric(id: AssetClassId, key: string): MetricDef | null {
  return getAssetClass(id).metrics.find((m) => m.key === key) ?? null;
}

/** Metrics with a real source behind them — i.e. everything except `unavailable`. */
export function availableMetrics(id: AssetClassId): MetricDef[] {
  return getAssetClass(id).metrics.filter((m) => m.availability !== "unavailable");
}

/**
 * Metrics this asset class *should* have but that no wired provider can supply.
 * Surfaced in the UI as an explicit "not screenable yet, and here's why"
 * section rather than being quietly dropped: a user who came looking for TVL
 * deserves to be told we don't have a TVL feed, not to be shown a filter that
 * silently matches nothing.
 */
export function unavailableMetrics(id: AssetClassId): MetricDef[] {
  return getAssetClass(id).metrics.filter((m) => m.availability === "unavailable");
}

/* -------------------------------------------------------------------------- */
/* Filter registry — derived from the metric registry, never hand-maintained   */
/* -------------------------------------------------------------------------- */

/**
 * The filter registry is a *projection* of the metric registry: a filter is
 * simply a renderable view of an available metric. Keeping it derived rather
 * than as a second hand-written list is what guarantees the two can't drift —
 * you cannot add a filter for a metric that has no data source, and you cannot
 * wire up a new data source without its filter appearing.
 */
export function getFilters(id: AssetClassId): FilterDef[] {
  const def = getAssetClass(id);
  const order = new Map(def.filterGroups.map((g, i) => [g, i]));

  return availableMetrics(id)
    .map((m): FilterDef => ({
      key: m.key,
      label: m.label,
      description: m.description,
      // Categorical metrics render as multiselect — a single choice is just a
      // one-element selection, and the filter engine accepts both shapes, so
      // there's no reason to make the user pick one sector at a time.
      kind: m.options ? "multiselect" : "range",
      unit: m.unit,
      group: m.group,
      options: m.options,
      step: m.step,
      scale: m.scale,
    }))
    .sort((a, b) => (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99));
}

/** Filters bucketed into the class's declared group order, for section rendering. */
export function getFilterGroups(id: AssetClassId): { group: string; filters: FilterDef[] }[] {
  const filters = getFilters(id);
  return getAssetClass(id)
    .filterGroups.map((group) => ({
      group,
      filters: filters.filter((f) => f.group === group),
    }))
    .filter((g) => g.filters.length > 0);
}

export function getTemplate(id: AssetClassId, templateId: string) {
  return getAssetClass(id).templates.find((t) => t.id === templateId) ?? null;
}

/** The ranking a run should use: the template's override, else the class default. */
export function getRanking(id: AssetClassId, templateId: string | null): RankFactor[] {
  const tpl = templateId ? getTemplate(id, templateId) : null;
  return tpl?.rank ?? getAssetClass(id).rank;
}
