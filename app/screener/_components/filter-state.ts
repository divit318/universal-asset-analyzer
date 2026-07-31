/**
 * The client-side filter draft, and its conversion to/from the registry's
 * FilterValues.
 *
 * Ranges are held as *strings* while the user types (an empty box is "", not 0,
 * and "1." is a legitimate intermediate state that Number() would mangle).
 * Conversion to real FilterValues — including the ×1e9 scaling for market cap
 * and AUM, which the registry declares per metric rather than the UI guessing —
 * happens once, at submit.
 */

import { getAssetClass, getMetric } from "@/lib/assets/registry";
import type { AssetClassId, FilterFrame, FilterValues, SoftPreferences } from "@/lib/assets/types";

export type DraftValue =
  | {
      kind: "range";
      min: string;
      max: string;
      /**
       * What the numbers mean: raw values, or a percentile against the class or
       * the asset's peer group. Absent = "absolute", so every existing draft and
       * saved screen reads back unchanged.
       */
      frame?: FilterFrame;
      /** Whether a name with no value for this metric survives the filter. */
      missing?: "exclude" | "include";
    }
  | { kind: "multiselect"; values: string[] };
export type Draft = Record<string, DraftValue>;

/** Metric key → weight. Ranked toward, never filtered on. */
export type PreferenceDraft = SoftPreferences;

export function emptyDraft(): Draft {
  return {};
}

/** Does this draft actually constrain anything? */
export function isActiveDraft(v: DraftValue | undefined): boolean {
  if (!v) return false;
  if (v.kind === "range") return v.min.trim() !== "" || v.max.trim() !== "";
  return v.values.length > 0;
}

export function countActive(draft: Draft): number {
  return Object.values(draft).filter(isActiveDraft).length;
}

const parse = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Draft → the FilterValues the API expects, applying each metric's scale. */
export function toFilterValues(assetClass: AssetClassId, draft: Draft): FilterValues {
  const out: FilterValues = {};

  for (const [key, value] of Object.entries(draft)) {
    if (!isActiveDraft(value)) continue;
    const metric = getMetric(assetClass, key);
    if (!metric) continue;

    if (value.kind === "multiselect") {
      out[key] = { kind: "multiselect", values: value.values };
      continue;
    }

    const frame = value.frame ?? "absolute";
    /*
     * Scale applies to absolute values only. A framed filter's numbers are
     * percentiles, so multiplying "top 25%" by the AUM metric's 1e9 scale would
     * ask for the 25-billionth percentile and match nothing — the kind of bug
     * that looks like an empty screen rather than a unit error.
     */
    const scale = frame === "absolute" ? (metric.scale ?? 1) : 1;
    const min = parse(value.min);
    const max = parse(value.max);
    if (min == null && max == null) continue;
    out[key] = {
      kind: "range",
      min: min == null ? null : min * scale,
      max: max == null ? null : max * scale,
      ...(frame !== "absolute" ? { frame } : {}),
      ...(value.missing === "include" ? { missing: "include" as const } : {}),
    };
  }

  return out;
}

/** FilterValues (from a template or a saved screen) → the draft the inputs render. */
export function fromFilterValues(assetClass: AssetClassId, filters: FilterValues): Draft {
  const draft: Draft = {};

  for (const [key, value] of Object.entries(filters)) {
    const metric = getMetric(assetClass, key);
    if (!metric) continue;

    // Templates may express a categorical filter as a single `select`; the UI
    // renders every categorical metric as a multiselect, so normalize here.
    // The filter engine accepts both shapes, so this is purely presentational.
    if (value.kind === "select") {
      draft[key] = { kind: "multiselect", values: value.value ? [value.value] : [] };
      continue;
    }
    if (value.kind === "multiselect") {
      draft[key] = { kind: "multiselect", values: value.values };
      continue;
    }
    if (value.kind === "range") {
      const frame = value.frame ?? "absolute";
      const scale = frame === "absolute" ? (metric.scale ?? 1) : 1;
      draft[key] = {
        kind: "range",
        min: value.min == null ? "" : String(value.min / scale),
        max: value.max == null ? "" : String(value.max / scale),
        ...(frame !== "absolute" ? { frame } : {}),
        ...(value.missing === "include" ? { missing: "include" as const } : {}),
      };
    }
  }

  return draft;
}

/** The draft a template produces when picked. */
export function draftFromTemplate(assetClass: AssetClassId, templateId: string): Draft {
  const template = getAssetClass(assetClass).templates.find((t) => t.id === templateId);
  return template ? fromFilterValues(assetClass, template.filters) : emptyDraft();
}
