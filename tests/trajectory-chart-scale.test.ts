import { describe, expect, it } from "vitest";
import { relativeScale } from "@/app/portfolio/_components/universal/trajectory-chart";

/**
 * The Trajectory concentration chart autoscales, and the whole risk of doing so
 * is that a meaningless wobble is stretched to fill the box and reads as a
 * collapse. These lock the padding floor that prevents it.
 */
describe("relativeScale", () => {
  it("keeps a real drift legible without wasting the box", () => {
    // The live ledger: the largest asset class fell from ~54.9% to 45.2%.
    const { domain } = relativeScale([54.9, 52.1, 48.6, 45.2]);
    const span = domain[1] - domain[0];

    expect(domain[0]).toBeLessThan(45.2);
    expect(domain[1]).toBeGreaterThan(54.9);
    // The 9.7pp move must occupy a substantial share of the height — the bug
    // being fixed was a fixed 0-100 domain, where it occupied 9.7%.
    expect(9.7 / span).toBeGreaterThan(0.4);
  });

  it("refuses to dramatise a wobble", () => {
    const { domain } = relativeScale([45.2, 45.3, 45.1, 45.2]);
    const span = domain[1] - domain[0];

    // 0.2pp of movement must stay visually negligible. Pure min/max autoscaling
    // would render it as the full height of the chart.
    expect(span).toBeGreaterThanOrEqual(6);
    expect(0.2 / span).toBeLessThan(0.05);
  });

  it("gives a dead-flat series a window rather than a zero-height domain", () => {
    const { domain, ticks } = relativeScale([45.2, 45.2, 45.2]);

    expect(domain[1]).toBeGreaterThan(domain[0]);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("never invents weight outside 0-100", () => {
    expect(relativeScale([0, 1.2]).domain[0]).toBe(0);
    expect(relativeScale([98.5, 100]).domain[1]).toBe(100);
  });

  it("labels round numbers, not the padded endpoints", () => {
    // Recharts' own default labelled the raw domain edge, producing "61%".
    const { domain, ticks } = relativeScale([54.9, 45.2, 33.4]);

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (const t of ticks) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(domain[0]);
      expect(t).toBeLessThanOrEqual(domain[1]);
    }
  });
});
