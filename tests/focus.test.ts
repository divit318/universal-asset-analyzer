/**
 * The focus-symbol spine's list mechanics (§4.4): ordering (most-recent first),
 * dedupe, normalization, the cap at 5, and defensive parsing of stored blobs.
 */

import { describe, it, expect } from "vitest";
import { pushFocusSymbol, sanitizeFocusList, FOCUS_CAP } from "@/lib/focus";

describe("pushFocusSymbol", () => {
  it("puts the newest symbol first", () => {
    expect(pushFocusSymbol(["AAPL"], "MSFT")).toEqual(["MSFT", "AAPL"]);
  });

  it("de-duplicates and moves a repeated symbol to the front", () => {
    expect(pushFocusSymbol(["AAPL", "MSFT", "NVDA"], "MSFT")).toEqual(["MSFT", "AAPL", "NVDA"]);
  });

  it("normalizes case and whitespace", () => {
    expect(pushFocusSymbol(["AAPL"], "  msft ")).toEqual(["MSFT", "AAPL"]);
    // Case-insensitive dedupe.
    expect(pushFocusSymbol(["AAPL"], "aapl")).toEqual(["AAPL"]);
  });

  it("caps the list at FOCUS_CAP, dropping the oldest", () => {
    expect(FOCUS_CAP).toBe(5);
    let list: string[] = [];
    for (const s of ["A", "B", "C", "D", "E", "F"]) list = pushFocusSymbol(list, s);
    expect(list).toEqual(["F", "E", "D", "C", "B"]); // A fell off
    expect(list).toHaveLength(5);
  });

  it("treats a blank symbol as a no-op (still capped)", () => {
    expect(pushFocusSymbol(["A", "B"], "   ")).toEqual(["A", "B"]);
  });

  it("honours a custom cap", () => {
    expect(pushFocusSymbol(["A", "B"], "C", 2)).toEqual(["C", "A"]);
  });
});

describe("sanitizeFocusList", () => {
  it("keeps normalized, de-duplicated strings up to the cap", () => {
    expect(sanitizeFocusList(["aapl", "MSFT", "aapl", " nvda "])).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("drops non-strings and caps the result", () => {
    expect(sanitizeFocusList(["A", 1, null, "B", "C", "D", "E", "F"])).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("returns [] for anything that isn't an array", () => {
    expect(sanitizeFocusList(null)).toEqual([]);
    expect(sanitizeFocusList("AAPL")).toEqual([]);
    expect(sanitizeFocusList({ 0: "AAPL" })).toEqual([]);
  });
});
