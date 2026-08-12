import { describe, expect, it } from "vitest";
import { listBaseAssetClasses } from "@/lib/assets";
import { LANDING_CONTENT } from "@/app/compare/_components/landing-content";
import { classSections } from "@/app/compare/_components/class-sections";
import { GET as classCompareGet } from "@/app/api/compare/class/route";
import { GET as classStatusGet } from "@/app/api/compare/class/status/route";
import { POST as classExportPost } from "@/app/api/export/compare-class/route";

/**
 * Compare's information architecture: its top-level taxonomy is *base* asset
 * classes only. Geography is a discovery dimension inside a class — India is
 * a market of equities, not an eighth asset class — so market variants
 * (indiaEquity) must never appear as a Compare tab nor be accepted by the
 * generic class-comparison APIs, while Indian equities stay fully
 * discoverable and comparable through the Equities experience.
 */

describe("compare taxonomy", () => {
  it("keys landing content by exactly the base asset classes", () => {
    expect(Object.keys(LANDING_CONTENT).sort()).toEqual(
      listBaseAssetClasses().map((d) => d.id).sort(),
    );
  });

  it("keeps India discoverable inside the Equities landing experience", () => {
    const labels = LANDING_CONTENT.equity.groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Indian Banking");
    const allItems = LANDING_CONTENT.equity.groups.flatMap((g) => g.items);
    expect(allItems.find((i) => i.label === "Nifty 50")).toBeDefined();

    const india = LANDING_CONTENT.equity.groups.find((g) => g.title === "India");
    expect(india, "Equities must carry an India discovery group").toBeDefined();
    expect(india!.items.length).toBeGreaterThanOrEqual(3);
    for (const item of india!.items) {
      for (const symbol of item.symbols) {
        expect(symbol, `${item.label}: ${symbol} must be an NSE listing`).toMatch(/\.NS$/);
      }
    }
  });

  it("has a real metric-table framework for every non-equity base class", () => {
    // The inverse of the indiaEquity bug: any class Compare offers as a tab
    // must actually render sections, never a hollow comparison.
    for (const def of listBaseAssetClasses().filter((d) => d.id !== "equity")) {
      expect(classSections(def.id).length, `${def.id} has no compare sections`).toBeGreaterThan(0);
    }
  });

  it("rejects market variants and equity on the class-compare API", async () => {
    for (const assetClass of ["indiaEquity", "equity"]) {
      const res = await classCompareGet(
        new Request(`http://localhost/api/compare/class?assetClass=${assetClass}&symbols=TCS.NS,INFY.NS`),
      );
      expect(res.status, assetClass).toBe(400);
    }
  });

  it("rejects market variants and equity on the class-compare status API", async () => {
    for (const assetClass of ["indiaEquity", "equity"]) {
      const res = await classStatusGet(
        new Request(`http://localhost/api/compare/class/status?assetClass=${assetClass}`),
      );
      expect(res.status, assetClass).toBe(400);
    }
  });

  it("rejects market variants and equity on the class-compare export API", async () => {
    for (const assetClass of ["indiaEquity", "equity"]) {
      const res = await classExportPost(
        new Request("http://localhost/api/export/compare-class", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetClass, entries: [] }),
        }),
      );
      expect(res.status, assetClass).toBe(400);
    }
  });
});
