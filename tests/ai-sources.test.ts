import { describe, expect, it } from "vitest";
import { mapNews } from "@/lib/news";
import { mapProfile } from "@/lib/profile";

describe("mapNews", () => {
  it("maps a raw hit and converts the unix publish time", () => {
    const item = mapNews({
      title: "Apple beats estimates",
      publisher: "Reuters",
      link: "https://news/1",
      providerPublishTime: 1_700_000_000,
    });
    expect(item?.title).toBe("Apple beats estimates");
    expect(item?.publishedAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
  it("drops rows without a link or title", () => {
    expect(mapNews({ title: "x" })).toBeNull();
    expect(mapNews({ link: "https://x" })).toBeNull();
  });
});

describe("mapProfile", () => {
  it("normalizes ownership percentages and pulls the business summary", () => {
    const p = mapProfile("AAPL", {
      assetProfile: {
        longBusinessSummary: "Apple designs phones.",
        sector: "Technology",
        industry: "Consumer Electronics",
        fullTimeEmployees: 161000,
        companyOfficers: [{ name: "Tim Cook", title: "CEO" }, { name: "", title: "x" }],
      },
      defaultKeyStatistics: { enterpriseValue: 3.1e12 },
      majorHoldersBreakdown: { insidersPercentHeld: 0.0007, institutionsPercentHeld: 0.61 },
    });
    expect(p.description).toBe("Apple designs phones.");
    expect(p.institutionalOwnership).toBeCloseTo(61);
    expect(p.insiderOwnership).toBeCloseTo(0.07);
    expect(p.officers).toHaveLength(1); // the nameless officer is dropped
  });
});
