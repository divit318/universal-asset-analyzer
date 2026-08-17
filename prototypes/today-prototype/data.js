/* UAA Today — Level 10 prototype. Sample data only; nothing here touches the app. */
"use strict";

const UAA = {
  meta: {
    dateLine: "Saturday · August 15, 2026",
    session: "Markets closed · last session Fri Aug 14",
    briefAt: "07:04",
  },

  book: {
    value: 2847392,
    dayPnl: 11824,
    dayPct: 0.42,
    weekPct: 1.9,
    weekVsSpxPp: 0.8,
    ytdPct: 18.6,
    cashPct: 4.2,
    state: "AT HIGH",
    risk: { label: "STRETCHED", position: 0.72 },
  },

  /* 30 sessions ending Fri Aug 14 — portfolio value ($) and SPX rebased to the
     same start, both plotted by the filament. */
  curve: {
    portfolio: [
      2712100, 2718400, 2704900, 2731200, 2742800, 2756400, 2749100, 2768300,
      2771600, 2790200, 2801400, 2823100, 2839500, 2818200, 2792600, 2771300,
      2751800, 2769400, 2788100, 2806500, 2815800, 2827200, 2836400, 2830100,
      2839800, 2843600, 2836900, 2841200, 2835500, 2847392,
    ],
    spx: [
      2712100, 2716200, 2709800, 2721400, 2728900, 2735600, 2731800, 2740200,
      2743900, 2752600, 2758400, 2767100, 2774800, 2765200, 2754900, 2748600,
      2741300, 2749800, 2757400, 2764100, 2769800, 2776400, 2781900, 2778600,
      2784200, 2788900, 2785600, 2790300, 2787100, 2798842,
    ],
    endLabel: "FRI AUG 14",
  },

  verdict: {
    lede: ["A good week, ", "carried by a narrow spine."],
    body:
      "The book gained 1.9% against 1.1% for the S&P and closed Friday at a new high. Nearly a third of that work was done by NVIDIA alone, which reports Wednesday with an implied move of ±7.8%. The next five sessions are about deciding — in advance — how much of this concentration you intend to keep.",
    source: "Generated locally · 07:04 · from Friday's close, your policy, and this week's calendar",
  },

  signals: [
    {
      rank: "01",
      kind: "action",
      score: 92,
      headline: "Equity exposure is stretched",
      rationale:
        "84.3% of the book is in equities with no duration hedge — protection is thin if the regime turns.",
      why: [
        { label: "Equity weight", value: "84.3%", note: "policy ceiling 75%" },
        { label: "Duration hedge", value: "0.0%", note: "no Treasuries or TIPS held" },
        { label: "Inflation sensitivity", value: "−5.0%", note: "per +1pp CPI surprise" },
        { label: "−10% equity shock", value: "−8.4%", note: "estimated portfolio drawdown" },
      ],
      recommended: {
        action: "Shift 8–10% into intermediate Treasuries — IEF, or a 5–7Y ladder.",
        alt: "Alternative: collar NVDA through earnings instead — see signal 02.",
        cta: "Simulate in Portfolio",
      },
      impact: {
        bars: [
          { label: "Equity exposure", from: 84.3, to: 72.1, unit: "%", max: 100 },
          { label: "Shock drawdown (−10%)", from: 8.4, to: 6.9, unit: "%", max: 10, invert: true },
        ],
        lines: [
          "Exposure alignment theme 57 → 74 against your policy.",
          "≈ +$9,870/yr carried on the Treasury sleeve at 4.28%.",
        ],
      },
      audit: { impact: 0.94, urgency: 0.88, confidence: 0.94 },
      source: "Portfolio Alignment · exposure theme · computed Fri 16:32",
    },
    {
      rank: "02",
      kind: "threat",
      score: 87,
      headline: "NVDA is doing the work of conviction",
      rationale:
        "One name is 31.2% of the book, and its correlation cluster takes effective AI exposure to 51.8%.",
      why: [
        { label: "Single-name weight", value: "31.2%", note: "policy cap 20%" },
        { label: "Cluster NVDA · TSM · MSFT", value: "51.8%", note: "effective, ρ ≈ 0.81" },
        { label: "Wednesday implied move", value: "±7.8%", note: "options, Aug 21 expiry" },
        { label: "Share of Friday's P&L", value: "71%", note: "$8,412 of $11,824" },
      ],
      recommended: {
        action: "Trim toward 25% into strength, or collar (Sep 5% OTM) through the print.",
        alt: "Doing nothing is a position: it sizes Wednesday at ±$69k.",
        cta: "Open NVDA in Research",
      },
      impact: {
        bars: [
          { label: "Single-name weight", from: 31.2, to: 25.0, unit: "%", max: 40 },
          { label: "Effective AI cluster", from: 51.8, to: 44.6, unit: "%", max: 60 },
        ],
        lines: [
          "Earnings-night VaR (95%) $71k → $48k.",
          "Concentration alignment theme 41 → 58.",
        ],
      },
      audit: { impact: 0.92, urgency: 0.82, confidence: 0.88 },
      source: "Portfolio Alignment · concentration theme · correlation window 90d",
    },
    {
      rank: "03",
      kind: "event",
      score: 74,
      headline: "42% of the book reports within 48 hours",
      rationale:
        "NVDA Wednesday, COST and CRM Thursday — this week's risk is event-shaped, not market-shaped.",
      why: [
        { label: "NVDA · Wed AMC", value: "±7.8%", note: "implied · 31.2% of book" },
        { label: "COST · Thu AMC", value: "±3.1%", note: "implied · 8.9% of book" },
        { label: "CRM · Thu AMC", value: "±6.4%", note: "watchlist · entry candidate" },
        { label: "Reporting weight", value: "42.3%", note: "of portfolio, within 48h" },
      ],
      recommended: {
        action: "Write your NVDA trim / hold levels before Wednesday — not during the call.",
        alt: "A pre-committed plan is the only defence against a ±8% print at 16:05.",
        cta: "Open the Calendar",
      },
      impact: {
        bars: [
          { label: "If both surprise −1σ", from: 0, to: 3.4, unit: "%", max: 5, invert: true, static: true },
        ],
        lines: [
          "Estimated −$96k (−3.4%) if NVDA and COST both miss by one implied move.",
          "Decision deadline: Wednesday 16:00 ET.",
        ],
      },
      audit: { impact: 0.78, urgency: 0.79, confidence: 0.66 },
      source: "Calendar × holdings · implied moves are option-derived estimates",
    },
  ],

  ledger: [
    { kind: "alert", symbol: "UNH", text: "Closed 2.4% below your $610 alert level", when: "Fri" },
    { kind: "signal", symbol: "TSM", text: "50-day crossed above 200-day (golden cross)", when: "Fri" },
    { kind: "event", symbol: "FED", text: "FOMC minutes — Wednesday 14:00 ET", when: "Wed" },
    { kind: "event", symbol: "US", text: "Jobless claims — Thursday 08:30 ET", when: "Thu" },
    { kind: "alert", symbol: "AAPL", text: "Within 3% of your $245 target", when: "Fri" },
    { kind: "signal", symbol: "OXY", text: "Cluster of insider buys — 3 filings this week", when: "Wk" },
    { kind: "event", symbol: "MSFT", text: "Ex-dividend Wednesday ($0.83)", when: "Wed" },
    { kind: "event", symbol: "OPEX", text: "August options expiry — Friday", when: "Fri" },
    { kind: "signal", symbol: "XLE", text: "Energy at a 6-month relative low vs SPX", when: "Fri" },
    { kind: "event", symbol: "ASML", text: "Reports next Wednesday — watchlist", when: "Aug 26" },
    { kind: "signal", symbol: "NYSE", text: "Advance/decline line made a new high Friday", when: "Fri" },
    { kind: "alert", symbol: "CASH", text: "Sweep rate dropped to 4.10% (−15bp)", when: "Fri" },
    { kind: "event", symbol: "JXN", text: "Jackson Hole — Aug 27–29, on the horizon", when: "Aug 27" },
  ],

  week: [
    {
      zone: "NOW",
      note: "Sat 07:04",
      items: [
        { t: "Equity markets closed", d: "Reopen Monday 09:30 ET. Futures reopen Sunday 18:00 ET.", tone: "quiet" },
        { t: "Crypto is live", d: "BTC +1.24% over 24h — the only tape moving this morning.", tone: "live" },
      ],
    },
    {
      zone: "TODAY",
      note: "Saturday",
      items: [
        { t: "Weekly review", d: "20 minutes. Unfinished from last week — signals 01 and 02 are its agenda.", tone: "action" },
        { t: "Brief generated 07:04", d: "From Friday's close, your policy, and this week's calendar.", tone: "quiet" },
      ],
    },
    {
      zone: "THIS WEEK",
      note: "Aug 17 – 21",
      items: [
        { t: "Wed — NVDA reports AMC", d: "Implied ±7.8%. FOMC minutes 14:00. MSFT ex-div.", tone: "hot" },
        { t: "Thu — COST · CRM report", d: "Jobless claims 08:30 ET. 11.5% of book reports.", tone: "warm" },
        { t: "Fri — August OPEX", d: "Pin risk around NVDA $180 line if the print lands near it.", tone: "quiet" },
      ],
    },
    {
      zone: "HORIZON",
      note: "Beyond Friday",
      items: [
        { t: "Jackson Hole · Aug 27–29", d: "Policy-path repricing risk for the duration decision in signal 01.", tone: "quiet" },
        { t: "Policy review due Sep 1", d: "Your own cadence — concentration cap is the open question.", tone: "action" },
      ],
    },
  ],

  alignment: {
    overall: 68,
    note: "2 themes breach policy — both trace to one decision (signals 01 · 02).",
    themes: [
      { name: "Liquidity", score: 88 },
      { name: "Structure", score: 74 },
      { name: "Income", score: 63 },
      { name: "Exposure", score: 57, breach: true },
      { name: "Resilience", score: 52 },
      { name: "Inflation", score: 44, watch: true },
      { name: "Concentration", score: 41, breach: true },
    ],
  },

  attribution: [
    { symbol: "NVDA", value: 8412 },
    { symbol: "MSFT", value: 2105 },
    { symbol: "TSM", value: 1241 },
    { symbol: "OTHER", value: 760 },
    { symbol: "COST", value: 684 },
    { symbol: "AAPL", value: 512 },
    { symbol: "UNH", value: -1890 },
  ],

  composition: {
    sleeves: [
      { name: "Equities", pct: 84.3 },
      { name: "REITs", pct: 5.8 },
      { name: "Cash", pct: 4.2 },
      { name: "Gold", pct: 3.1 },
      { name: "Crypto", pct: 2.6 },
    ],
    top: [
      { symbol: "NVDA", pct: 31.2, day: 1.86 },
      { symbol: "MSFT", pct: 14.8, day: 0.61 },
      { symbol: "AAPL", pct: 11.4, day: 0.19 },
      { symbol: "COST", pct: 8.9, day: 0.33 },
      { symbol: "UNH", pct: 6.2, day: -1.32 },
      { symbol: "TSM", pct: 5.8, day: 0.94 },
    ],
    rest: "+ 4 more · 5.9%",
  },

  radar: [
    { symbol: "ASML", fit: 84, line: "Quality 91 · value 62 — reports Wed Aug 26. Watching for a post-print entry." },
    { symbol: "OXY", fit: 78, line: "Insider cluster (3 buys) into an energy sector at a 6-month relative low." },
    { symbol: "VRTX", fit: 76, line: "Quality screen entrant. 6% off its high with an unchanged thesis." },
  ],

  markets: {
    groups: [
      {
        name: "INDICES",
        rows: [
          { label: "S&P 500", value: "6,481.20", chg: 0.11 },
          { label: "NASDAQ 100", value: "23,714.65", chg: 0.24 },
          { label: "RUSSELL 2000", value: "2,289.40", chg: -0.32 },
          { label: "VIX", value: "14.21", chg: -3.6 },
        ],
      },
      {
        name: "RATES & FX",
        rows: [
          { label: "US 10Y", value: "4.281%", chg: 2.4, unit: "bp" },
          { label: "US 2Y", value: "4.062%", chg: 1.1, unit: "bp" },
          { label: "DXY", value: "102.38", chg: -0.21 },
          { label: "EUR / USD", value: "1.1042", chg: 0.24 },
        ],
      },
      {
        name: "COMMODITIES",
        rows: [
          { label: "GOLD", value: "2,489.10", chg: 0.42 },
          { label: "WTI CRUDE", value: "78.42", chg: -1.1 },
          { label: "COPPER", value: "4.612", chg: 0.31 },
          { label: "NAT GAS", value: "2.814", chg: 2.2 },
        ],
      },
      {
        name: "CRYPTO · LIVE",
        live: true,
        rows: [
          { label: "BTC", value: 118243, chg: 1.24, live: true, decimals: 0 },
          { label: "ETH", value: 4562.1, chg: 2.05, live: true, decimals: 1 },
          { label: "SOL", value: 216.44, chg: -0.87, live: true, decimals: 2 },
        ],
      },
    ],
    sectors: [
      { s: "XLK", v: 1.6 }, { s: "XLC", v: 0.9 }, { s: "XLY", v: 0.4 },
      { s: "XLF", v: 0.3 }, { s: "XLB", v: 0.2 }, { s: "XLI", v: 0.1 },
      { s: "XLV", v: -0.2 }, { s: "XLP", v: -0.4 }, { s: "XLU", v: -0.6 },
      { s: "XLRE", v: -0.8 }, { s: "XLE", v: -1.1 },
    ],
  },

  palette: [
    { k: "Go", label: "Open Portfolio", hint: "/portfolio" },
    { k: "Go", label: "Open NVDA in Research", hint: "/research?s=NVDA" },
    { k: "Go", label: "Open the Calendar", hint: "/calendar" },
    { k: "Run", label: "Simulate: +8% intermediate Treasuries", hint: "signal 01" },
    { k: "Run", label: "Re-run the morning brief", hint: "task · daily-briefing" },
    { k: "Go", label: "Compare NVDA vs AMD", hint: "/compare" },
    { k: "Go", label: "Open the Screener", hint: "/screener" },
    { k: "Go", label: "Watchlist", hint: "/watchlist" },
  ],
};

const KIND_LABEL = { action: "ACTION", threat: "THREAT", alert: "ALERT", event: "EVENT", signal: "SIGNAL" };
