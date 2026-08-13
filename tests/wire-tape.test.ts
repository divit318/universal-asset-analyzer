import { describe, it, expect } from "vitest";
import type { NewsItem } from "@/lib/types";
import {
  buildTape,
  classifyNoise,
  normalizeTitle,
  titleSimilarity,
  sourceTier,
  bucketFor,
  NOISE_THRESHOLD,
  TITLE_SIMILARITY_MIN,
} from "@/lib/wire/tape";

/**
 * Fixtures are real coverage of the two events named in the restructure brief,
 * captured 2026-07-31 (the day both broke): the Equinox Gold / Orla Mining
 * business-combination close (4 outlets) and Chevron's Q2 2026 results
 * (5 outlets). Headlines and sources match the live articles; the flat feed
 * rendered each variant as its own row.
 */

function item(
  headline: string,
  source: string,
  publishedAt: string,
  tickers: string[] = [],
  // Unique per headline+source — a 24-char slug collided for real fixture
  // pairs and tripped buildTape's exact-URL dedupe, which real articles
  // (distinct URLs) never would.
  url = `https://example.com/${headline.replace(/\W+/g, "-")}-${source.replace(/\W+/g, "-")}`,
): NewsItem {
  return { headline, source, url, publishedAt, tickers, summary: null };
}

/** Fixed "now" so bucket/staleness assertions are deterministic. */
const NOW = new Date("2026-07-31T15:00:00Z").getTime();

const EQUINOX_ORLA: NewsItem[] = [
  item(
    "Equinox Gold and Orla Mining Complete Business Combination, Creating North America's New Senior Gold Producer",
    "PR Newswire",
    "2026-07-31T11:00:00Z",
    ["EQX"],
  ),
  item(
    "Equinox Gold and Orla Mining Complete Business Combination",
    "Yahoo Finance",
    "2026-07-31T11:24:00Z",
    ["EQX", "ORLA"],
  ),
  item(
    "Equinox-Orla merger closes, creating Canada's No. 2 gold miner - MINING.COM",
    "MINING.COM",
    "2026-07-31T12:05:00Z",
  ),
  item(
    "Equinox Gold Completes Orla Mining Takeover to Form New Senior Gold Producer (NYSE: EQX)",
    "MarketScreener",
    "2026-07-31T13:10:00Z",
    ["EQX"],
  ),
];

const CHEVRON_Q2: NewsItem[] = [
  item("Chevron reports second quarter 2026 results", "Business Wire", "2026-07-31T10:45:00Z", ["CVX"]),
  item(
    "Chevron records highest quarterly profit in six years, beating analyst estimates",
    "Reuters",
    "2026-07-31T11:02:00Z",
    ["CVX"],
  ),
  item(
    "Chevron records highest quarterly profit in six years, beating estimates - The Globe and Mail",
    "The Globe and Mail",
    "2026-07-31T11:40:00Z",
  ),
  item("Chevron Reports Second Quarter 2026 Results", "MarketScreener", "2026-07-31T11:55:00Z", ["CVX"]),
  item(
    "Chevron (CVX) Q2 Earnings Beat: $6.06 EPS as Production Hits Record",
    "Zacks",
    "2026-07-31T13:30:00Z",
    ["CVX"],
  ),
];

/** Unrelated same-day stories that must NOT be absorbed into either cluster. */
const BYSTANDERS: NewsItem[] = [
  item("Fed holds rates steady, signals patience on further cuts", "Reuters", "2026-07-31T14:10:00Z"),
  item(
    "Big Tech is spending trillions on AI. Investors want proof it'll pay off.",
    "CBS News",
    "2026-07-31T09:32:00Z",
    ["^IXIC"],
  ),
  // Real live-captured items from the same feed (stale by weeks on a LIVE tape):
  item(
    "This Stock Market Is Full of Bargains, Our Roundtable Pros Say. 45 Picks for the Second Half.",
    "Barrons.com",
    "2026-07-10T21:13:00Z",
    ["^GSPC"],
  ),
  item(
    "Stocks are rallying despite the Iran war and stubborn inflation. Here's why.",
    "CBS News",
    "2026-05-28T11:32:14Z",
    ["^GSPC"],
  ),
];

const NOISE: NewsItem[] = [
  item("NFL preseason: quarterback battle heats up as training camp opens", "Yahoo Sports", "2026-07-31T12:00:00Z"),
  item("10 Best Dividend Stocks to Buy Now", "Motley Fool", "2026-07-31T08:00:00Z"),
];

const FEED = [...EQUINOX_ORLA, ...CHEVRON_Q2, ...BYSTANDERS, ...NOISE];

describe("normalizeTitle", () => {
  it("strips ticker mentions and trailing source suffixes", () => {
    const tokens = normalizeTitle(
      "Equinox-Orla merger closes, creating Canada's No. 2 gold miner - MINING.COM",
    );
    expect(tokens).not.toContain("com");
    expect(tokens).toContain("equinox");
    expect(tokens).toContain("orla");
    expect(normalizeTitle("Chevron (CVX) Q2 Earnings Beat: $6.06 EPS as Production Hits Record")).not.toContain("cvx");
  });
});

describe("buildTape — clustering the flat feed into stories", () => {
  const view = buildTape(FEED, { now: NOW });

  it("collapses the four Equinox/Orla rows into one story with a 4-source expander", () => {
    const equinox = view.stories.filter((s) => /equinox/i.test(s.canonical.headline));
    expect(equinox).toHaveLength(1);
    expect(equinox[0].sourceCount).toBe(4);
  });

  it("collapses the five Chevron Q2 rows into one story with a 5-source expander", () => {
    const chevron = view.stories.filter((s) => /chevron/i.test(s.canonical.headline));
    expect(chevron).toHaveLength(1);
    expect(chevron[0].sourceCount).toBe(5);
  });

  it("picks the canonical headline by source priority — wires over aggregators", () => {
    const equinox = view.stories.find((s) => /equinox/i.test(s.canonical.headline))!;
    expect(equinox.canonical.source).toBe("PR Newswire"); // not MarketScreener/MINING.COM
    const chevron = view.stories.find((s) => /chevron/i.test(s.canonical.headline))!;
    expect(chevron.canonical.source).toBe("Business Wire"); // earliest tier-0 source
  });

  it("does not absorb unrelated same-day stories into either cluster", () => {
    const fed = view.stories.find((s) => /fed holds rates/i.test(s.canonical.headline));
    expect(fed).toBeDefined();
    expect(fed!.sourceCount).toBe(1);
  });

  it("keeps similar headlines apart when they fall outside the 48h window", () => {
    // Real pair: Chevron's Q1 release (May 1) is nearly identical in wording
    // to the Q2 one (July 31) — the window, not the words, must separate them.
    const q1 = item("Chevron reports first quarter 2026 results", "Business Wire", "2026-05-01T10:45:00Z", ["CVX"]);
    const v = buildTape([...CHEVRON_Q2, q1], { now: NOW });
    const chevronStories = v.stories.filter((s) => /chevron/i.test(s.canonical.headline));
    expect(chevronStories).toHaveLength(2);
    expect(titleSimilarity(
      normalizeTitle(q1.headline),
      normalizeTitle(CHEVRON_Q2[0].headline),
    )).toBeGreaterThanOrEqual(TITLE_SIMILARITY_MIN); // proves the window did the work
  });

  it("reports honest totals for the badge: articles in, rows out", () => {
    expect(view.totalArticles).toBe(FEED.length);
    // 4 Equinox + 5 Chevron collapse to 2 rows → 7 articles absorbed.
    expect(view.clusteredArticles).toBe(7);
  });

  it("story ids are stable across rebuilds of the same articles", () => {
    const again = buildTape(FEED, { now: NOW });
    expect(again.stories.map((s) => s.id)).toEqual(view.stories.map((s) => s.id));
  });
});

describe("buildTape — noise is flagged, never deleted", () => {
  const view = buildTape(FEED, { now: NOW });

  it("moves sports and screener listicles behind the filter, preserving them", () => {
    expect(view.filtered.map((s) => s.canonical.headline)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/NFL preseason/),
        expect.stringMatching(/10 Best Dividend Stocks/),
      ]),
    );
    // Nothing vanished: visible rows + filtered rows account for every article.
    const accounted = [...view.stories, ...view.filtered].reduce((n, s) => n + s.sourceCount, 0);
    expect(accounted).toBe(FEED.length);
  });

  it("does not filter legitimate market news", () => {
    for (const s of view.stories) {
      expect(s.noise.filtered).toBe(false);
    }
    expect(classifyNoise(item("Fed holds rates steady, signals patience", "Reuters", "2026-07-31T14:10:00Z")).score).toBe(0);
  });

  it("classifyNoise scores against the exported threshold", () => {
    const sports = classifyNoise(NOISE[0]);
    expect(sports.filtered).toBe(true);
    expect(sports.score).toBeGreaterThanOrEqual(NOISE_THRESHOLD);
    expect(sports.matched).toContain("sports");
  });
});

describe("buildTape — recency", () => {
  const view = buildTape(FEED, { now: NOW });

  it("marks items older than 72h stale — a LIVE tape must not pass off May as news", () => {
    const may = view.stories.find((s) => /iran war and stubborn inflation/i.test(s.canonical.headline))!;
    expect(may.stale).toBe(true);
    expect(may.bucket).toBe("earlier");
    const fresh = view.stories.find((s) => /chevron/i.test(s.canonical.headline))!;
    expect(fresh.stale).toBe(false);
  });

  it("buckets by age: last hour / today / yesterday / earlier", () => {
    expect(bucketFor("2026-07-31T14:30:00Z", NOW)).toBe("hour");
    expect(bucketFor("2026-07-31T05:00:00Z", NOW)).toBe("today");
    expect(bucketFor("2026-07-30T05:00:00Z", NOW)).toBe("yesterday"); // 34h old
    expect(bucketFor("2026-07-10T05:00:00Z", NOW)).toBe("earlier");
  });

  it("orders visible stories newest bucket first", () => {
    const buckets = view.stories.map((s) => s.bucket);
    const order = ["hour", "today", "yesterday", "earlier"];
    const indices = buckets.map((b) => order.indexOf(b));
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });
});

describe("buildTape — exact-duplicate articles collapse before clustering", () => {
  it("merges same-URL items into one article, unioning tickers", () => {
    // Live capture 2026-08-06: the same GuruFocus article arrived twice via
    // two holdings' feeds and rendered as two identical rows.
    const url = "https://example.com/micron-memory-cycle";
    const dupes = [
      item("Micron Drops Stunning Clue About Next Memory Cycle", "GuruFocus.com", "2026-07-31T13:00:00Z", ["MU"], url),
      item("Micron Drops Stunning Clue About Next Memory Cycle", "GuruFocus.com", "2026-07-31T13:00:00Z", ["WDC"], url),
    ];
    const view = buildTape(dupes, { now: NOW });
    expect(view.totalArticles).toBe(1);
    expect(view.stories).toHaveLength(1);
    expect(view.stories[0].sourceCount).toBe(1);
    expect(view.stories[0].tickers.sort()).toEqual(["MU", "WDC"]);
  });

  it("does not merge distinct url-less items that share a headline prefix", () => {
    const a = { ...item("Fed holds rates steady, signals patience", "Reuters", "2026-07-31T14:10:00Z"), url: "" };
    const b = { ...item("Tesla misses Q2 delivery estimates", "Reuters", "2026-07-31T14:20:00Z"), url: "" };
    const view = buildTape([a, b], { now: NOW });
    expect(view.totalArticles).toBe(2);
  });
});

describe("noise rules — content-mill genres captured from the live holdings feed", () => {
  // Every fixture below is a real headline observed on the Wire 2026-08-06
  // that leaked past the old rules into Holdings News.
  const shouldFilter: [string, string][] = [
    ["The IRS Now Lets 60-Year-Olds Stash $35,750 in a 401(k) a Year. These 3 ETFs Make Maxing It Worth It", "24/7 Wall St."],
    ["The Cheapest ETFs for Building a Core Portfolio", "Zacks"],
    ["4 Things All Dividend Investors Need to Know About Building Passive Income Right Now", "Motley Fool"],
    ["2 Unstoppable Growth ETFs Worth Buying and Holding Through Every Market Cycle", "Motley Fool"],
    ["Trump Accounts Are Open: 500,000 Signed Up in Days. Here's What the 0.10% Fee Cap Actually Lets You Buy", "24/7 Wall St."],
    ["VOO's 0.03% Fee Hides the Real Cost: 28.7% of Your Money in Seven Stocks", "24/7 Wall St."],
  ];
  it.each(shouldFilter)("filters %j", (headline, source) => {
    expect(classifyNoise(item(headline, source, "2026-08-05T12:00:00Z")).filtered).toBe(true);
  });

  const shouldPass: [string, string][] = [
    ["Microsoft (MSFT) Deepens AI Partnerships As $500 Billion Chip Funding Wave Builds", "Simply Wall St."],
    ["SNDK Stock Dips After-Hours As Sandisk's Q1 FY27 Outlook Misses Expectations", "Stocktwits"],
    ["Tigress Financial Raises Microsoft Price Target to $690 From $680, Buy Rating Kept", "MT Newswires"],
    ["Best Buy shares fall after earnings miss", "Reuters"],
    ["Fed holds rates steady, signals patience on further cuts", "Reuters"],
  ];
  it.each(shouldPass)("keeps %j visible", (headline, source) => {
    expect(classifyNoise(item(headline, source, "2026-08-05T12:00:00Z")).filtered).toBe(false);
  });
});

describe("sourceTier", () => {
  it("ranks wires and filings above mainstream press above content mills", () => {
    expect(sourceTier("Reuters")).toBeLessThan(sourceTier("Barrons.com"));
    expect(sourceTier("Barrons.com")).toBeLessThan(sourceTier("Motley Fool"));
    expect(sourceTier("PR Newswire")).toBe(0);
    expect(sourceTier("Some Unknown Blog")).toBe(2);
  });
});
