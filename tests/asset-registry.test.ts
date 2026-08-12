import { describe, expect, it } from "vitest";
import {
  ASSET_CLASS_IDS,
  availableMetrics,
  getAssetClass,
  getFilterGroups,
  getFilters,
  getMetric,
  getRanking,
  isAssetClassId,
  isMarketVariant,
  listAssetClasses,
  listBaseAssetClasses,
  unavailableMetrics,
  universeLabel,
  type AssetClassId,
} from "@/lib/assets";

/**
 * These are the registry's *invariants* — the properties every asset class must
 * hold for the screener framework to work at all. They're what makes "add a
 * class = add a file" safe: a new class that violates one of these fails here
 * rather than producing a subtly broken screen in production.
 */

describe("asset registry", () => {
  it("registers exactly the eight supported asset classes", () => {
    expect(ASSET_CLASS_IDS).toEqual([
      "equity",
      "indiaEquity",
      "etf",
      "reit",
      "crypto",
      "commodity",
      "bond",
      "forex",
    ]);
    expect(listAssetClasses()).toHaveLength(8);
  });

  it("gates unknown asset class ids", () => {
    expect(isAssetClassId("equity")).toBe(true);
    expect(isAssetClassId("options")).toBe(false);
    expect(isAssetClassId(null)).toBe(false);
    expect(isAssetClassId(42)).toBe(false);
  });

  describe.each(ASSET_CLASS_IDS)("%s", (id: AssetClassId) => {
    const def = getAssetClass(id);

    it("has unique metric keys", () => {
      const keys = def.metrics.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("declares every metric's group in filterGroups", () => {
      for (const m of def.metrics) {
        expect(def.filterGroups, `${id}.${m.key} group "${m.group}"`).toContain(m.group);
      }
    });

    it("gives every metric a source unless it is unavailable", () => {
      for (const m of def.metrics) {
        if (m.availability === "unavailable") {
          expect(m.source, `${id}.${m.key}`).toBeNull();
          // An unavailable metric must say what it would take to make it real —
          // otherwise it's just a hole with a label on it.
          expect(m.requires, `${id}.${m.key} must explain what it needs`).toBeTruthy();
        } else {
          expect(m.source, `${id}.${m.key}`).not.toBeNull();
        }
      }
    });

    it("documents the formula for every derived metric", () => {
      for (const m of def.metrics.filter((x) => x.availability === "derived")) {
        expect(m.formula, `${id}.${m.key}`).toBeTruthy();
      }
    });

    it("dates every reference metric", () => {
      for (const m of def.metrics.filter((x) => x.availability === "reference")) {
        expect(m.asOf, `${id}.${m.key} must carry an as-of date`).toMatch(/^\d{4}-\d{2}/);
      }
    });

    it("never builds a filter for an unavailable metric", () => {
      const filterKeys = new Set(getFilters(id).map((f) => f.key));
      for (const m of unavailableMetrics(id)) {
        expect(filterKeys.has(m.key), `${id}.${m.key} must not be filterable`).toBe(false);
      }
      expect(getFilters(id).length).toBe(availableMetrics(id).length);
    });

    it("ranks only on metrics that exist and have data", () => {
      for (const factor of def.rank) {
        const metric = getMetric(id, factor.metric);
        expect(metric, `${id} ranks on unknown metric "${factor.metric}"`).not.toBeNull();
        expect(metric!.availability, `${id} ranks on unavailable "${factor.metric}"`).not.toBe(
          "unavailable",
        );
        expect(factor.weight).toBeGreaterThan(0);
      }
    });

    it("gives every ranked metric a direction", () => {
      // A percentile is meaningless without knowing which end is good.
      for (const factor of def.rank) {
        const metric = getMetric(id, factor.metric)!;
        expect(
          factor.direction ?? metric.better,
          `${id}.${factor.metric} has no better/direction`,
        ).not.toBeNull();
      }
    });

    it("has templates that reference only real, available metrics", () => {
      expect(def.templates.length).toBeGreaterThan(0);
      for (const template of def.templates) {
        for (const key of Object.keys(template.filters)) {
          const metric = getMetric(id, key);
          expect(metric, `${id}/${template.id} filters on unknown "${key}"`).not.toBeNull();
          expect(
            metric!.availability,
            `${id}/${template.id} filters on unavailable "${key}" — this would match nothing`,
          ).not.toBe("unavailable");
        }

        for (const factor of template.rank ?? []) {
          const metric = getMetric(id, factor.metric);
          expect(metric, `${id}/${template.id} ranks on unknown "${factor.metric}"`).not.toBeNull();
          expect(metric!.availability).not.toBe("unavailable");
        }
      }
    });

    it("only puts categorical values in categorical template filters", () => {
      for (const template of def.templates) {
        for (const [key, value] of Object.entries(template.filters)) {
          const metric = getMetric(id, key)!;
          if (value.kind === "select" && value.value) {
            expect(metric.options, `${id}/${template.id}: "${key}" is not categorical`).toBeDefined();
            expect(metric.options).toContain(value.value);
          }
          if (value.kind === "multiselect") {
            expect(metric.options, `${id}/${template.id}: "${key}" is not categorical`).toBeDefined();
            for (const v of value.values) expect(metric.options).toContain(v);
          }
          if (value.kind === "range") {
            expect(
              metric.options,
              `${id}/${template.id}: "${key}" is categorical but filtered as a range`,
            ).toBeUndefined();
          }
        }
      }
    });

    it("has unique template ids", () => {
      const ids = def.templates.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("has result columns that resolve to metrics or built-ins", () => {
      const builtins = new Set(["rankScore", "price", "changePercent", "symbol", "name"]);
      for (const col of def.columns) {
        if (builtins.has(col.key)) continue;
        const metric = getMetric(id, col.key);
        expect(metric, `${id} column "${col.key}" is not a metric`).not.toBeNull();
        expect(
          metric!.availability,
          `${id} column "${col.key}" would always render as "—"`,
        ).not.toBe("unavailable");
      }
    });

    it("has a sortable default sort key", () => {
      const builtins = new Set(["rankScore", "price", "changePercent", "symbol", "name"]);
      const key = def.defaultSort.key;
      expect(builtins.has(key) || getMetric(id, key) != null).toBe(true);
    });

    it("groups every filter under a declared group", () => {
      const groups = getFilterGroups(id);
      const total = groups.reduce((n, g) => n + g.filters.length, 0);
      expect(total).toBe(getFilters(id).length);
    });
  });

  it("falls back to the class ranking when no template is active", () => {
    expect(getRanking("equity", null)).toEqual(getAssetClass("equity").rank);
  });

  it("uses the template's ranking when one is active", () => {
    const value = getAssetClass("equity").templates.find((t) => t.id === "value")!;
    expect(getRanking("equity", "value")).toEqual(value.rank);
  });

  it("covers every asset class the brief requires, and nothing else", () => {
    const labels = listAssetClasses().map((d) => d.label);
    expect(labels).toEqual([
      "Equities",
      "India",
      "ETFs",
      "REITs",
      "Crypto",
      "Commodities",
      "Bonds",
      "Forex",
    ]);
  });

  // ── Base classes vs. market variants ─────────────────────────────────────
  // A geography is not an asset class: indiaEquity stays in the registry as
  // the Screener's dedicated NSE universe, but every asset-class *taxonomy*
  // (Compare's tabs, the generic class-compare APIs) must exclude it.

  describe("market variants", () => {
    it("keeps indiaEquity in the raw registry — the Screener genuinely needs it", () => {
      expect(ASSET_CLASS_IDS).toContain("indiaEquity");
      expect(getAssetClass("indiaEquity").capabilities).toContain("screen");
    });

    it("marks indiaEquity as a market variant of equity, and nothing else as one", () => {
      expect(getAssetClass("indiaEquity").marketVariantOf).toBe("equity");
      expect(isMarketVariant("indiaEquity")).toBe(true);
      for (const id of ASSET_CLASS_IDS.filter((x) => x !== "indiaEquity")) {
        expect(isMarketVariant(id), `${id} must be a base class`).toBe(false);
      }
    });

    it("points every market variant at a real base class", () => {
      for (const def of listAssetClasses()) {
        if (!def.marketVariantOf) continue;
        const base = getAssetClass(def.marketVariantOf);
        expect(base.marketVariantOf, `${def.id}'s base ${base.id} must itself be a base class`).toBeUndefined();
        expect(def.assetClass, `${def.id} must share its base's detection class`).toBe(base.assetClass);
      }
    });

    it("names universes so a market variant can never read as a bare geography", () => {
      // The Screener's navigation is a universe picker; its labels come from
      // universeLabel() so "India" renders as "India Equities" — market +
      // class — instead of sitting alongside "Bonds" looking like one.
      expect(universeLabel("indiaEquity")).toBe("India Equities");
      for (const def of listBaseAssetClasses()) {
        expect(universeLabel(def.id), `${def.id}'s universe is just the class`).toBe(def.label);
      }
    });

    it("lists exactly the seven genuine asset classes as base classes", () => {
      expect(listBaseAssetClasses().map((d) => d.id)).toEqual([
        "equity",
        "etf",
        "reit",
        "crypto",
        "commodity",
        "bond",
        "forex",
      ]);
      expect(listBaseAssetClasses().map((d) => d.label)).toEqual([
        "Equities",
        "ETFs",
        "REITs",
        "Crypto",
        "Commodities",
        "Bonds",
        "Forex",
      ]);
    });
  });
});
