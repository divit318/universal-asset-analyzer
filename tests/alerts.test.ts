import { describe, it, expect } from "vitest";
import {
  evaluateWatchlistAlerts,
  evaluatePortfolioAlerts,
  evaluateAlerts,
  type PriceObservation,
  type QuoteLite,
} from "@/lib/alerts";

const q = (price: number, changePercent: number, currency = "USD"): QuoteLite => ({
  price,
  changePercent,
  currency,
});

/** Previously-observed state for one symbol. */
const seen = (
  symbol: string,
  lastPrice: number | null,
  lastChangePercent: number | null = null,
): Map<string, PriceObservation> => new Map([[symbol, { lastPrice, lastChangePercent }]]);

const AAPL = (
  targetPrice: number | null,
  targetDirection: "above" | "below" | null = null,
  alertPctDrop: number | null = null,
) => [{ symbol: "AAPL", name: "Apple", targetPrice, targetDirection, alertPctDrop }];

describe("evaluateWatchlistAlerts — price targets fire on a crossing, not a state", () => {
  /**
   * The behaviour this replaces: the evaluator tested "is the price past the
   * target?", which is true continuously once satisfied. The only throttle was a
   * 24h dedup window, so a target reached in January re-announced itself every
   * day — while a genuine second crossing on the same day was suppressed.
   */
  it("does not fire on the first observation — there is nothing to cross from", () => {
    const { events } = evaluateWatchlistAlerts(AAPL(200, "above"), new Map([["AAPL", q(205, 1)]]));
    expect(events).toEqual([]);
  });

  it("arms on the first observation so the next tick can compare", () => {
    const { observations } = evaluateWatchlistAlerts(AAPL(200, "above"), new Map([["AAPL", q(205, 1)]]));
    expect(observations).toEqual([{ symbol: "AAPL", price: 205, changePercent: 1 }]);
  });

  it("fires when the price crosses UP through an 'above' target", () => {
    const { events } = evaluateWatchlistAlerts(
      AAPL(200, "above"),
      new Map([["AAPL", q(201, 1)]]),
      seen("AAPL", 195),
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("price_target");
    expect(events[0].facts.targetPrice).toBe(200);
    expect(events[0].facts.fromPrice).toBe(195);
    expect(events[0].facts.toPrice).toBe(201);
  });

  it("fires when the price crosses DOWN through a 'below' target", () => {
    const { events } = evaluateWatchlistAlerts(
      AAPL(200, "below"),
      new Map([["AAPL", q(199, -1)]]),
      seen("AAPL", 205),
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("price_target");
  });

  it("stays silent while the price sits past the target — the headline fix", () => {
    // Both observations satisfied: the level was crossed at some earlier point,
    // and re-reporting it is describing the weather rather than an event.
    const { events } = evaluateWatchlistAlerts(
      AAPL(200, "above"),
      new Map([["AAPL", q(240, 1)]]),
      seen("AAPL", 230),
    );
    expect(events).toEqual([]);
  });

  it("stays silent while the price is still short of the target", () => {
    const { events } = evaluateWatchlistAlerts(
      AAPL(200, "above"),
      new Map([["AAPL", q(198, 1)]]),
      seen("AAPL", 195),
    );
    expect(events).toEqual([]);
  });

  it("re-fires after the price retreats and crosses again", () => {
    const items = AAPL(200, "above");
    // Up through the level.
    expect(evaluateWatchlistAlerts(items, new Map([["AAPL", q(201, 1)]]), seen("AAPL", 199)).events).toHaveLength(1);
    // Back below — not an event in this direction.
    expect(evaluateWatchlistAlerts(items, new Map([["AAPL", q(197, -2)]]), seen("AAPL", 201)).events).toEqual([]);
    // And up through it again: a real second crossing, which the old 24h dedup
    // window would have swallowed.
    expect(evaluateWatchlistAlerts(items, new Map([["AAPL", q(202, 2)]]), seen("AAPL", 197)).events).toHaveLength(1);
  });

  it("treats exactly-at-the-target as crossed once, then not again", () => {
    expect(
      evaluateWatchlistAlerts(AAPL(200, "above"), new Map([["AAPL", q(200, 0)]]), seen("AAPL", 199)).events,
    ).toHaveLength(1);
    // Sitting at the level is not a new crossing.
    expect(
      evaluateWatchlistAlerts(AAPL(200, "above"), new Map([["AAPL", q(200, 0)]]), seen("AAPL", 200)).events,
    ).toEqual([]);
  });

  it("detects a crossing that happened across a monitoring gap", () => {
    // The previous observation is days old (the process was down). A net crossing
    // is still detected, because the baseline is persisted rather than in-memory.
    const { events } = evaluateWatchlistAlerts(
      AAPL(200, "above"),
      new Map([["AAPL", q(260, 0.4)]]),
      seen("AAPL", 150),
    );
    expect(events).toHaveLength(1);
  });

  it("never fires on a zero, negative or absent target", () => {
    for (const target of [0, -5, null]) {
      const { events } = evaluateWatchlistAlerts(
        AAPL(target, "above"),
        new Map([["AAPL", q(205, 1)]]),
        seen("AAPL", 100),
      );
      expect(events).toEqual([]);
    }
  });

  it("ignores a symbol with no quote and records no observation for it", () => {
    const { events, observations } = evaluateWatchlistAlerts(
      [{ symbol: "NONE", name: "No Quote", targetPrice: 10, targetDirection: "above", alertPctDrop: 5 }],
      new Map(),
      new Map(),
    );
    expect(events).toEqual([]);
    expect(observations).toEqual([]);
  });

  it("resolves a legacy null direction against the PREVIOUS price, not today's", () => {
    // Inferring from today's price would flip an already-crossed target's
    // direction and silently stop it firing — the failure the direction column
    // exists to prevent.
    const legacy = [{ symbol: "AAPL", name: "Apple", targetPrice: 200, targetDirection: null, alertPctDrop: null }];
    const { events } = evaluateWatchlistAlerts(legacy, new Map([["AAPL", q(201, 1)]]), seen("AAPL", 190));
    expect(events).toHaveLength(1);
  });

  it("dedup keys distinguish the level, the direction and the day", () => {
    const at = Date.parse("2026-07-28T12:00:00Z");
    const a = evaluateWatchlistAlerts(AAPL(200, "above"), new Map([["AAPL", q(201, 1)]]), seen("AAPL", 199), at)
      .events[0].dedupKey;
    // A different target is a different alert, not a duplicate of the old one.
    const b = evaluateWatchlistAlerts(AAPL(220, "above"), new Map([["AAPL", q(221, 1)]]), seen("AAPL", 219), at)
      .events[0].dedupKey;
    // The same crossing on the next day is reportable again.
    const c = evaluateWatchlistAlerts(
      AAPL(200, "above"),
      new Map([["AAPL", q(201, 1)]]),
      seen("AAPL", 199),
      at + 86_400_000,
    ).events[0].dedupKey;
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("above");
    expect(a).toContain("2026-07-28");
  });
});

describe("evaluateWatchlistAlerts — drop alerts", () => {
  it("fires when today's decline breaches the threshold", () => {
    const { events } = evaluateWatchlistAlerts(
      [{ symbol: "TSLA", name: "Tesla", targetPrice: null, alertPctDrop: 10 }],
      new Map([["TSLA", q(180, -12)]]),
      seen("TSLA", 200, -3),
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("drop_alert");
    expect(events[0].severity).toBe("warning");
  });

  it("does not fire twice as the same decline deepens", () => {
    const { events } = evaluateWatchlistAlerts(
      [{ symbol: "TSLA", name: "Tesla", targetPrice: null, alertPctDrop: 10 }],
      new Map([["TSLA", q(175, -14)]]),
      seen("TSLA", 180, -12), // already past the threshold last tick
    );
    expect(events).toEqual([]);
  });

  it("fires on the first observation of an already-breached day", () => {
    // A restart must not swallow the day's worst move; unlike a price level, a
    // -8% day demonstrably happened today.
    const { events } = evaluateWatchlistAlerts(
      [{ symbol: "TSLA", name: "Tesla", targetPrice: null, alertPctDrop: 5 }],
      new Map([["TSLA", q(180, -8)]]),
      new Map(),
    );
    expect(events).toHaveLength(1);
  });

  it("does not fire for a smaller decline, or on an up day", () => {
    for (const chg of [-8, 0, 3]) {
      const { events } = evaluateWatchlistAlerts(
        [{ symbol: "TSLA", name: "Tesla", targetPrice: null, alertPctDrop: 10 }],
        new Map([["TSLA", q(180, chg)]]),
        seen("TSLA", 200, 0),
      );
      expect(events).toEqual([]);
    }
  });

  it("keys the drop alert by day, so consecutive down days both report", () => {
    const day1 = Date.parse("2026-07-28T14:00:00Z");
    const items = [{ symbol: "TSLA", name: "Tesla", targetPrice: null, alertPctDrop: 5 }];
    const a = evaluateWatchlistAlerts(items, new Map([["TSLA", q(180, -6)]]), seen("TSLA", 190, 0), day1)
      .events[0].dedupKey;
    const b = evaluateWatchlistAlerts(
      items,
      new Map([["TSLA", q(170, -6)]]),
      seen("TSLA", 180, 0),
      day1 + 86_400_000,
    ).events[0].dedupKey;
    // A 24h ROLLING window straddles two sessions and announced only the first.
    expect(a).not.toBe(b);
  });

  it("can fire both a target crossing and a drop for the same symbol", () => {
    const { events } = evaluateWatchlistAlerts(
      AAPL(200, "below", 5),
      new Map([["AAPL", q(190, -6)]]),
      seen("AAPL", 205, 0),
    );
    expect(events.map((a) => a.kind).sort()).toEqual(["drop_alert", "price_target"]);
  });
});

describe("evaluatePortfolioAlerts", () => {
  it("fires a big-move alert past the default 7% threshold, up or down", () => {
    const positions = [
      { symbol: "NVDA", name: "Nvidia" },
      { symbol: "MSFT", name: "Microsoft" },
    ];
    const quotes = new Map([
      ["NVDA", q(200, 9)], // up big
      ["MSFT", q(400, -8)], // down big
    ]);
    const alerts = evaluatePortfolioAlerts(positions, quotes);
    expect(alerts).toHaveLength(2);
    expect(alerts.find((a) => a.symbol === "NVDA")!.severity).toBe("info");
    expect(alerts.find((a) => a.symbol === "MSFT")!.severity).toBe("warning");
  });

  it("respects a custom threshold and ignores small moves", () => {
    const positions = [{ symbol: "AAPL", name: "Apple" }];
    expect(evaluatePortfolioAlerts(positions, new Map([["AAPL", q(200, 4)]]))).toEqual([]);
    expect(evaluatePortfolioAlerts(positions, new Map([["AAPL", q(200, 4)]]), { bigMovePct: 3 })).toHaveLength(1);
  });
});

describe("session gating — audit F-22e (the weekend re-alert bug)", () => {
  const positions = [{ symbol: "AAPL", name: "Apple" }];
  const staleQ: QuoteLite = {
    price: 308.91,
    changePercent: -7.4,
    currency: "USD",
    sessionDate: "2026-07-31",
    observedAt: "2026-07-31T20:00:00.000Z",
    isCurrentSession: false, // a Saturday run seeing Friday's close
  };

  it("a big move from a finished session is not news", () => {
    expect(evaluatePortfolioAlerts(positions, new Map([["AAPL", staleQ]]))).toEqual([]);
  });

  it("the same move IS news during its own session", () => {
    const live = { ...staleQ, isCurrentSession: true };
    expect(evaluatePortfolioAlerts(positions, new Map([["AAPL", live]]))).toHaveLength(1);
  });

  it("missing session metadata does not silence alerts (legacy callers)", () => {
    expect(evaluatePortfolioAlerts(positions, new Map([["AAPL", q(200, -9)]]))).toHaveLength(1);
  });

  it("drop alerts are gated the same way", () => {
    const items = [{ symbol: "AAPL", name: "Apple", targetPrice: null, alertPctDrop: 5 }];
    const { events } = evaluateWatchlistAlerts(items, new Map([["AAPL", staleQ]]), new Map());
    expect(events).toEqual([]);
  });

  it("target crossings still fire regardless of session (a level was crossed)", () => {
    const items = AAPL(305, "below");
    const { events } = evaluateWatchlistAlerts(items, new Map([["AAPL", { ...staleQ, price: 304 }]]), seen("AAPL", 310));
    expect(events).toHaveLength(1);
  });
});

describe("renderAlertText — prose is tensed at read time (audit F-22c)", () => {
  const facts = {
    kind: "big_move" as const,
    symbol: "AAPL",
    name: "Apple Inc.",
    pct: -8.7,
    price: 304.34,
    currency: "USD",
    observedAt: "2026-07-31T13:31:00.000Z",
    sessionDate: "2026-07-31",
  };

  it("says 'today' only while the session is today", async () => {
    const { renderAlertText } = await import("@/lib/alerts");
    const during = renderAlertText(facts, Date.parse("2026-07-31T15:00:00"));
    expect(during.body).toContain("today");
    expect(during.body).not.toContain("Jul 31");
  });

  it("dates itself once the session has passed — the -8.7% row can never lie again", async () => {
    const { renderAlertText } = await import("@/lib/alerts");
    const later = renderAlertText(facts, Date.parse("2026-08-05T12:00:00"));
    expect(later.body).not.toContain("today");
    expect(later.body).toContain("Jul 31");
    expect(later.body).toContain("$304.34");
  });

  it("titles state magnitude, not a double-signed 'down -8.7%'", async () => {
    const { renderAlertText } = await import("@/lib/alerts");
    expect(renderAlertText(facts).title).toBe("AAPL down 8.7%");
  });

  it("an unknown session renders 'as of last close', never 'today'", async () => {
    const { renderAlertText } = await import("@/lib/alerts");
    const t = renderAlertText({ ...facts, sessionDate: null });
    expect(t.body).toContain("as of last close");
    expect(t.body).not.toContain("today");
  });
});

describe("evaluateAlerts", () => {
  it("combines watchlist and portfolio sources and reports observations once", () => {
    const { events, observations } = evaluateAlerts({
      watchlist: AAPL(200, "below"),
      positions: [{ symbol: "NVDA", name: "Nvidia" }],
      quotes: new Map([
        ["AAPL", q(199, -1)],
        ["NVDA", q(200, 9)],
      ]),
      previous: seen("AAPL", 205),
    });
    expect(events.map((a) => a.kind).sort()).toEqual(["big_move", "price_target"]);
    // Only watchlist symbols are armed — portfolio big-move alerts are same-day
    // state and need no baseline.
    expect(observations.map((o) => o.symbol)).toEqual(["AAPL"]);
  });
});
