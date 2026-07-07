import { describe, it, expect } from "vitest";
import { freshness, relativeAge, DATA_SOURCES } from "@/lib/provenance";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-07-07T12:00:00Z");

describe("relativeAge", () => {
  it("formats across the time bands", () => {
    expect(relativeAge(20_000)).toBe("just now");
    expect(relativeAge(5 * 60_000)).toBe("5m ago");
    expect(relativeAge(3 * HOUR)).toBe("3h ago");
    expect(relativeAge(2 * 24 * HOUR)).toBe("2d ago");
    expect(relativeAge(60 * 24 * HOUR)).toBe("2mo ago");
  });
});

describe("freshness", () => {
  it("is fresh within the TTL", () => {
    const f = freshness(new Date(NOW - 2 * HOUR).toISOString(), 24, NOW);
    expect(f.level).toBe("fresh");
    expect(f.label).toBe("2h ago");
    expect(f.ageMs).toBe(2 * HOUR);
  });

  it("is aging between 1× and 2× the TTL", () => {
    const f = freshness(NOW - 30 * HOUR, 24, NOW); // accepts epoch ms too
    expect(f.level).toBe("aging");
  });

  it("is stale beyond 2× the TTL", () => {
    const f = freshness(new Date(NOW - 72 * HOUR).toISOString(), 24, NOW);
    expect(f.level).toBe("stale");
  });

  it("treats a missing or unparseable timestamp as stale/unknown", () => {
    expect(freshness(null, 24, NOW)).toEqual({ level: "stale", ageMs: null, label: "unknown" });
    expect(freshness("not-a-date", 24, NOW).label).toBe("unknown");
  });

  it("marks exactly-at-TTL as still fresh (inclusive boundary)", () => {
    expect(freshness(NOW - 24 * HOUR, 24, NOW).level).toBe("fresh");
    expect(freshness(NOW - (24 * HOUR + 1), 24, NOW).level).toBe("aging");
  });

  it("never reports a negative age for a future timestamp", () => {
    expect(freshness(NOW + HOUR, 24, NOW).ageMs).toBe(0);
  });
});

describe("DATA_SOURCES registry", () => {
  it("has a name and short label for every source", () => {
    for (const meta of Object.values(DATA_SOURCES)) {
      expect(meta.name).toBeTruthy();
      expect(meta.short).toBeTruthy();
    }
  });
});
