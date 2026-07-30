import { describe, expect, it } from "vitest";
import { cleanFeedText } from "@/lib/news";

/**
 * Regression tests for feed text leaking raw markup into the UI.
 *
 * Observed live: a Knowledge Graph node was labelled with the literal string
 * `<![CDATA[US Stoc…`. The CDATA-aware regexes in the RSS parser only match
 * well-formed `<title><![CDATA[…]]></title>`; when they miss, the permissive
 * fallback captures the wrapper itself. Sanitizing every extracted node at the
 * boundary makes that structurally impossible rather than feed-dependent.
 */

describe("cleanFeedText", () => {
  it("unwraps a complete CDATA section", () => {
    expect(cleanFeedText("<![CDATA[US Stocks Rally on Fed Pivot]]>")).toBe(
      "US Stocks Rally on Fed Pivot",
    );
  });

  it("strips a truncated or unbalanced CDATA opener — the observed bug", () => {
    expect(cleanFeedText("<![CDATA[US Stocks Close Higher")).toBe("US Stocks Close Higher");
    expect(cleanFeedText("US Stocks Close Higher]]>")).toBe("US Stocks Close Higher");
  });

  it("never leaves CDATA punctuation in the output", () => {
    const out = cleanFeedText("<![CDATA[Nvidia beats]]> and <![CDATA[AMD follows");
    expect(out).not.toContain("CDATA");
    expect(out).not.toContain("]]>");
    expect(out).not.toContain("<!");
  });

  it("strips HTML tags", () => {
    expect(cleanFeedText("<b>Apple</b> beats on <i>services</i>")).toBe(
      "Apple beats on services",
    );
  });

  it("decodes named entities", () => {
    expect(cleanFeedText("Profit &amp; loss")).toBe("Profit & loss");
    expect(cleanFeedText("Q3 &mdash; strong")).toBe("Q3 — strong");
    expect(cleanFeedText("Apple&rsquo;s margin")).toBe("Apple\u2019s margin");
  });

  it("decodes numeric entities, decimal and hex", () => {
    expect(cleanFeedText("Apple&#39;s guidance")).toBe("Apple's guidance");
    expect(cleanFeedText("Q3&#x2014;strong")).toBe("Q3—strong");
  });

  it("leaves unknown entities visible rather than mangling them", () => {
    expect(cleanFeedText("Weird &notarealentity; here")).toContain("&notarealentity;");
  });

  it("does not let a double-encoded tag survive as markup", () => {
    // Decoding before stripping would turn this into a real <b> tag.
    const out = cleanFeedText("&lt;b&gt;bold&lt;/b&gt;");
    expect(out).toBe("<b>bold</b>");
  });

  it("collapses whitespace and newlines from pretty-printed feeds", () => {
    expect(cleanFeedText("  US   Stocks\n\tRally  ")).toBe("US Stocks Rally");
  });

  it("returns an empty string for markup-only input, so the item is dropped", () => {
    expect(cleanFeedText("<![CDATA[]]>")).toBe("");
    expect(cleanFeedText("   ")).toBe("");
    expect(cleanFeedText("<div></div>")).toBe("");
  });

  it("leaves ordinary headlines untouched", () => {
    const plain = "Nvidia Deepens South Korea AI Push With $1 Billion NAVER Investment";
    expect(cleanFeedText(plain)).toBe(plain);
  });
});
