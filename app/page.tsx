import Link from "next/link";

const MODULES = [
  {
    href: "/research",
    title: "Stock Research",
    desc: "Search any ticker — US or India — for a live quote, price chart, SEC filings, scoring, insider activity, earnings, ownership, and AI analysis.",
  },
  {
    href: "/discover",
    title: "Discover",
    desc: "Two ways to find ideas: AI-powered news signals across Indian and global markets, or a deep fundamental screener across 500+ metrics.",
  },
  {
    href: "/thematic",
    title: "Thematic Research",
    desc: "10-stage Industries & Commodities Discovery Framework. Map dependency chains, score bottlenecks, analyse supply/demand cycles, policy tailwinds, and surface non-obvious tier 2–4 companies.",
  },
  {
    href: "/compare",
    title: "Side-by-Side Compare",
    desc: "Head-to-head comparison of up to 5 stocks across valuation, quality, growth, momentum, and a structured AI verdict.",
  },
  {
    href: "/watchlist",
    title: "Watchlist",
    desc: "Track saved symbols with live prices, target-price and drop alerts, and an AI portfolio digest with scores and action items.",
  },
  {
    href: "/portfolio",
    title: "Portfolio",
    desc: "Track your holdings with live P&L, cost basis, allocation breakdown, and performance analytics over time.",
  },
  {
    href: "/screener",
    title: "Screener",
    desc: "Filter S&P 500 and global equities by sector, fundamentals, composite scores, and natural-language AI criteria.",
  },
  {
    href: "/dcf",
    title: "DCF Valuation",
    desc: "Build a discounted cash flow model for any ticker — customize growth rates, margins, and discount rates to estimate intrinsic value.",
  },
  {
    href: "/ic-report",
    title: "Deep Research",
    desc: "Full IC-grade pipeline — signal detection, 9-agent investigation, bull/bear/base thesis, SOTP/DCF/relative valuation, FX sensitivity, and a committee report.",
  },
  {
    href: "/engine",
    title: "Quant Engine",
    desc: "Systematic 10-factor scorecard: HMM regime detection, factor scoring, Monte Carlo DCF, quantile forecasts, and Kelly-optimal position sizing.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        <p className="font-mono text-sm text-accent">Universal Asset Analyzer</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-balance sm:text-5xl">
          Institutional-grade equity research, in your browser.
        </h1>
        <p className="text-lg leading-8 text-muted">
          Live quotes, SEC filings, fundamental scoring, peer comparison, AI analysis, and a
          full investment committee pipeline — for US and Indian markets. Runs entirely on local
          Ollama — no API keys required.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/50 hover:bg-surface-2"
          >
            <h2 className="text-base font-semibold">
              {m.title}
              <span className="ml-1 text-muted transition-transform group-hover:translate-x-0.5 inline-block">
                →
              </span>
            </h2>
            <p className="text-sm leading-6 text-muted">{m.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
