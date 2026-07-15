import { beforeEach, describe, expect, it } from "vitest";
import {
  readLineStyle,
  readRectStyle,
  readTextStyle,
  toOverlayStyle,
  withOpacity,
} from "@/app/research/_components/chart-workspace/overlays/style-utils";
import { TOOL_TO_OVERLAY_NAME } from "@/app/research/_components/chart-workspace/drawing-categories";
import { DEFAULT_DRAWING_STYLE, type DrawingStyle, type DrawingToolId } from "@/app/research/_components/chart-workspace/types";
import { getPreferredDrawingStyle, setPreferredDrawingStyle } from "@/app/research/_components/chart-workspace/style-preferences";

/* -------------------------------------------------------------------------- */
/* Minimal localStorage stub — vitest runs this suite under the "node"        */
/* environment (see vitest.config.ts), which has no localStorage global.      */
/* -------------------------------------------------------------------------- */

function installLocalStorageStub() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

/* -------------------------------------------------------------------------- */
/* withOpacity                                                                 */
/* -------------------------------------------------------------------------- */

describe("withOpacity", () => {
  it("converts a hex color + opacity into an rgba string", () => {
    expect(withOpacity("#60a5fa", 0.5)).toBe("rgba(96, 165, 250, 0.5)");
  });

  it("passes through non-hex colors unchanged", () => {
    expect(withOpacity("rgba(1,2,3,0.4)", 0.9)).toBe("rgba(1,2,3,0.4)");
    expect(withOpacity("red", 0.9)).toBe("red");
  });
});

/* -------------------------------------------------------------------------- */
/* toOverlayStyle                                                             */
/* -------------------------------------------------------------------------- */

describe("toOverlayStyle", () => {
  const style: DrawingStyle = { color: "#4ade80", opacity: 0.8, thickness: 2, lineStyle: "solid", textSize: 14 };

  it("maps thickness and color into the line style", () => {
    const overlayStyle = toOverlayStyle(style);
    expect(overlayStyle.line?.size).toBe(2);
    expect(overlayStyle.line?.color).toBe("rgba(74, 222, 128, 0.8)");
    expect(overlayStyle.line?.style).toBe("solid");
  });

  it("maps 'dashed' and 'dotted' to klinecharts' dashed style with different dash patterns", () => {
    const dashed = toOverlayStyle({ ...style, lineStyle: "dashed" });
    const dotted = toOverlayStyle({ ...style, lineStyle: "dotted" });
    expect(dashed.line?.style).toBe("dashed");
    expect(dotted.line?.style).toBe("dashed");
    expect(dashed.line?.dashedValue).not.toEqual(dotted.line?.dashedValue);
  });

  it("carries textSize into the text style", () => {
    expect(toOverlayStyle(style).text?.size).toBe(14);
  });
});

/* -------------------------------------------------------------------------- */
/* Defensive style readers                                                    */
/* -------------------------------------------------------------------------- */

describe("readLineStyle / readRectStyle / readTextStyle", () => {
  it("fall back to sane defaults when overlay styles are null/undefined", () => {
    expect(readLineStyle(null).color).toBeTruthy();
    expect(readLineStyle(undefined).size).toBeGreaterThan(0);
    expect(readRectStyle(null).color).toBeTruthy();
    expect(readTextStyle(undefined).size).toBeGreaterThan(0);
  });

  it("pass through explicit overrides", () => {
    const style = toOverlayStyle({ color: "#f87171", opacity: 1, thickness: 3, lineStyle: "solid", textSize: 16 });
    expect(readLineStyle(style).size).toBe(3);
    expect(readTextStyle(style).size).toBe(16);
  });
});

/* -------------------------------------------------------------------------- */
/* TOOL_TO_OVERLAY_NAME                                                       */
/* -------------------------------------------------------------------------- */

describe("TOOL_TO_OVERLAY_NAME", () => {
  it("maps cursor and crosshair to null (interaction modes, not overlays)", () => {
    expect(TOOL_TO_OVERLAY_NAME.cursor).toBeNull();
    expect(TOOL_TO_OVERLAY_NAME.crosshair).toBeNull();
  });

  it("maps every other tool to a real overlay name", () => {
    const drawableTools = (Object.keys(TOOL_TO_OVERLAY_NAME) as DrawingToolId[]).filter(
      (id) => id !== "cursor" && id !== "crosshair",
    );
    expect(drawableTools.length).toBeGreaterThan(0);
    for (const id of drawableTools) {
      expect(typeof TOOL_TO_OVERLAY_NAME[id]).toBe("string");
      expect(TOOL_TO_OVERLAY_NAME[id]!.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Preferred drawing style (localStorage-backed)                             */
/* -------------------------------------------------------------------------- */

describe("getPreferredDrawingStyle / setPreferredDrawingStyle", () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  it("returns the default style when nothing has been saved", () => {
    expect(getPreferredDrawingStyle()).toEqual(DEFAULT_DRAWING_STYLE);
  });

  it("round-trips a saved style", () => {
    const custom: DrawingStyle = { color: "#a78bfa", opacity: 0.6, thickness: 3, lineStyle: "dotted", textSize: 18 };
    setPreferredDrawingStyle(custom);
    expect(getPreferredDrawingStyle()).toEqual(custom);
  });

  it("falls back to defaults if the stored value is corrupt", () => {
    localStorage.setItem("uaa_chart_drawing_defaults", "{not json");
    expect(getPreferredDrawingStyle()).toEqual(DEFAULT_DRAWING_STYLE);
  });
});
