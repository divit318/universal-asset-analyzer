import { describe, it, expect } from "vitest";
import {
  computePopoverPosition,
  popoverMaxWidth,
  POPOVER_GAP,
  POPOVER_VIEWPORT_MARGIN,
  type Rect,
} from "@/app/_home/_atmosphere/popover-position";

const VIEWPORT = { width: 1440, height: 900 };
const PANEL = { width: 300, height: 220 };

function rect(top: number, left: number, width: number, height: number): Rect {
  return { top, left, right: left + width, bottom: top + height };
}

describe("computePopoverPosition", () => {
  it("opens below the trigger, aligned to its left edge, when there's room", () => {
    const trigger = rect(200, 100, 60, 24);
    const pos = computePopoverPosition(trigger, PANEL, VIEWPORT, "start");
    expect(pos.placement).toBe("bottom");
    expect(pos.top).toBe(trigger.bottom + POPOVER_GAP);
    expect(pos.left).toBe(trigger.left);
  });

  it("aligns to the trigger's right edge when align is 'end'", () => {
    const trigger = rect(200, 700, 60, 24);
    const pos = computePopoverPosition(trigger, PANEL, VIEWPORT, "end");
    expect(pos.left).toBe(trigger.right - PANEL.width);
  });

  it("clamps left so the panel never overflows the right edge of the viewport", () => {
    // trigger near the right edge — a start-aligned panel would run off-screen
    const trigger = rect(200, VIEWPORT.width - 40, 30, 24);
    const pos = computePopoverPosition(trigger, PANEL, VIEWPORT, "start");
    expect(pos.left + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width - POPOVER_VIEWPORT_MARGIN);
    expect(pos.left).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
  });

  it("clamps left so the panel never overflows the left edge of the viewport", () => {
    // end-aligned trigger near the left edge — right-anchoring would push it negative
    const trigger = rect(200, 20, 30, 24);
    const pos = computePopoverPosition(trigger, PANEL, VIEWPORT, "end");
    expect(pos.left).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
  });

  it("flips above the trigger when there isn't room below but there is above", () => {
    // trigger near the bottom of the viewport — a tall panel below would be clipped
    const trigger = rect(VIEWPORT.height - 60, 100, 60, 24);
    const pos = computePopoverPosition(trigger, PANEL, VIEWPORT, "start");
    expect(pos.placement).toBe("top");
    expect(pos.top).toBe(trigger.top - POPOVER_GAP - PANEL.height);
  });

  it("stays below when neither direction fully fits but below has more room", () => {
    // a viewport too short for the panel either way — below has more space, so it stays below
    const shortViewport = { width: 1440, height: 260 };
    const trigger = rect(80, 100, 60, 24); // ~156px below, ~72px above
    const pos = computePopoverPosition(trigger, PANEL, shortViewport, "start");
    expect(pos.placement).toBe("bottom");
  });

  it("keeps a flipped-above panel from crossing the top viewport margin", () => {
    // trigger very close to the top, but still more room above than below by construction
    const trigger = rect(5, 100, 60, 24);
    const tinyBelowViewport = { width: 1440, height: 15 }; // forces "flip" branch pathologically
    const pos = computePopoverPosition(trigger, PANEL, tinyBelowViewport, "start");
    expect(pos.top).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
  });

  it("clamps a panel taller than the viewport within the margins rather than overflowing", () => {
    const trigger = rect(400, 100, 60, 24);
    const shortViewport = { width: 1440, height: 500 };
    const tallPanel = { width: 300, height: 1000 };
    const pos = computePopoverPosition(trigger, tallPanel, shortViewport, "start");
    expect(pos.top).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
    expect(pos.top).toBeLessThanOrEqual(shortViewport.height - POPOVER_VIEWPORT_MARGIN);
  });

  it("never returns a left coordinate that overflows a viewport narrower than the panel", () => {
    // a 300px panel on a 320px mobile viewport minus margins is only 304px wide
    const narrowViewport = { width: 320, height: 800 };
    const trigger = rect(200, 250, 40, 24);
    const pos = computePopoverPosition(trigger, PANEL, narrowViewport, "start");
    expect(pos.left).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
    expect(pos.left).toBeLessThanOrEqual(narrowViewport.width - POPOVER_VIEWPORT_MARGIN);
  });
});

describe("popoverMaxWidth", () => {
  it("returns the preferred width when the viewport is wide enough", () => {
    expect(popoverMaxWidth(VIEWPORT, 300)).toBe(300);
  });

  it("shrinks to fit a narrow (mobile) viewport, minus margins on both sides", () => {
    const mobile = { width: 280, height: 700 };
    expect(popoverMaxWidth(mobile, 300)).toBe(280 - POPOVER_VIEWPORT_MARGIN * 2);
  });

  it("never returns a negative width on a pathologically tiny viewport", () => {
    expect(popoverMaxWidth({ width: 4, height: 700 }, 300)).toBe(0);
  });
});
