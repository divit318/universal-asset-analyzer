import { describe, expect, it } from "vitest";
import { firstSentence, shortCompanyName } from "@/lib/company-text";

describe("firstSentence", () => {
  it("returns the first sentence of a plain description", () => {
    expect(
      firstSentence("Apple designs and sells consumer electronics. It also runs services."),
    ).toBe("Apple designs and sells consumer electronics.");
  });

  it("does not split after corporate abbreviations", () => {
    const text =
      "Zeta Global Holdings Corp. operates an omnichannel data-driven cloud platform in the United States. The company was founded in 2007.";
    expect(firstSentence(text)).toBe(
      "Zeta Global Holdings Corp. operates an omnichannel data-driven cloud platform in the United States.",
    );
  });

  it("truncates an unbroken description at a word boundary", () => {
    const long = `${"word ".repeat(120)}end`;
    const result = firstSentence(long, 200);
    expect(result!.length).toBeLessThanOrEqual(201);
    expect(result!.endsWith("…")).toBe(true);
  });

  it("returns null for missing or empty text", () => {
    expect(firstSentence(null)).toBeNull();
    expect(firstSentence("   ")).toBeNull();
    expect(firstSentence(undefined)).toBeNull();
  });
});

describe("shortCompanyName", () => {
  it("strips legal suffixes and share classes", () => {
    expect(shortCompanyName("Zeta Global Holdings Corp. Class A", "ZETA")).toBe("Zeta Global Holdings");
    expect(shortCompanyName("Apple Inc.", "AAPL")).toBe("Apple");
    expect(shortCompanyName("The Coca-Cola Company", "KO")).toBe("Coca-Cola");
    expect(shortCompanyName("Coca-Cola Company (The)", "KO")).toBe("Coca-Cola");
  });

  it("never strips the distinctive part of a name", () => {
    expect(shortCompanyName("Microsoft Corporation", "MSFT")).toBe("Microsoft");
    expect(shortCompanyName("Exxon Mobil Corporation", "XOM")).toBe("Exxon Mobil");
  });

  it("falls back to the symbol when there is no name", () => {
    expect(shortCompanyName(null, "ZETA")).toBe("ZETA");
    expect(shortCompanyName("  ", "ZETA")).toBe("ZETA");
  });
});
