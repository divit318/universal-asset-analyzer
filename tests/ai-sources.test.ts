import { describe, expect, it } from "vitest";
import { mapProfile } from "@/lib/profile";

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
