import Link from "next/link";
import { DailyPulse } from "./_components/daily-pulse";
import { MarketDashboard } from "./_components/market-dashboard";

function Icon({ path, className = "" }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 ${className}`}
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  research:  "M11 4a7 7 0 11-4.9 12.0L3 19m8-15a7 7 0 100 14A7 7 0 0011 4zm3.5 3.5l2 2",
  screener:  "M3 4h14M6 8h8M9 12h2M10 16h0",
  compare:   "M4 4h5v12H4zm7 0h5v12h-5z",
  thematic:  "M10 3a2 2 0 100 4 2 2 0 000-4zm-6 9a2 2 0 100 4 2 2 0 000-4zm12 0a2 2 0 100 4 2 2 0 000-4zM10 7v3M4.5 13.5l3-2M15.5 13.5l-3-2",
  watchlist: "M5 3a2 2 0 012-2h6a2 2 0 012 2v14l-5-3-5 3V3z",
  portfolio: "M10 3v14M3 10h14M6 5l8 10M14 5L6 15",
  dcf:       "M4 17V7m4 10V3m4 14V9m4 8V5",
  icreport:  "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  engine:    "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM10 13a3 3 0 100-6 3 3 0 000 6z",
  scanner:   "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v10m0 0H5m4 0h10m0-10v10M3 9h18",
  calendar:  "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  intelligence: "M4 10a6 6 0 1112 0 6 6 0 01-12 0zm6-9v3m0 12v3m9-9h-3M4 10H1m14.5-5.5l-2 2m-9 9l-2 2m0-13l2 2m9 9l2 2",
};

/* Tag color variants for module badges */
const TAG_STYLE: Record<string, string> = {
  "Live data":      "border-blue-500/30 bg-blue-500/10 text-blue-400",
  "AI-powered":     "border-accent/30 bg-accent/10 text-accent",
  "Quantitative":   "border-purple-500/30 bg-purple-500/10 text-purple-400",
  "India markets":  "border-orange-400/30 bg-orange-400/10 text-orange-400",
  "Multi-agent":    "border-accent/30 bg-accent/10 text-accent",
  "Modeling":       "border-warning/30 bg-warning/10 text-warning",
  "Systematic":     "border-purple-500/30 bg-purple-500/10 text-purple-400",
  "Monitoring":     "border-blue-500/30 bg-blue-500/10 text-blue-400",
  "Risk":           "border-negative/30 bg-negative/10 text-negative",
  "Calendar":       "border-muted/30 bg-muted/10 text-muted",
  "AI Portfolio":   "border-positive/30 bg-positive/10 text-positive",
  "Patterns":       "border-warning/30 bg-warning/10 text-warning",
};

function Tag({ label }: { label: string }) {
  const cls = TAG_STYLE[label] ?? "border-border bg-surface-3 text-muted";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

const WORKFLOW_GROUPS = [
  {
    id: "discover",
    label: "Discover & Screen",
    description: "Surface opportunities across markets before the crowd",
    modules: [
      {
        href: "/scanner",
        title: "Market Scanner",
        icon: "scanner" as keyof typeof ICONS,
        tag: "AI-powered",
        desc: "Scan live news and events across Indian and global markets. Surface bullish/bearish signals with confidence scores and underlying catalysts.",
        highlight: false,
      },
      {
        href: "/screener",
        title: "Screener",
        icon: "screener" as keyof typeof ICONS,
        tag: "Quantitative",
        desc: "Filter S&P 500 equities by 50+ fundamental metrics, composite scores, and natural-language AI criteria. One-click starter screens included.",
        highlight: false,
      },
      {
        href: "/thematic",
        title: "Thematic Research",
        icon: "thematic" as keyof typeof ICONS,
        tag: "AI-powered",
        desc: "10-stage industry framework. Map dependency chains, score bottlenecks, and surface non-obvious tier 2–4 companies across any macro theme — with a Global Structural Advantage stage comparing regions from the US to Southeast Asia.",
        highlight: false,
      },
      {
        href: "/intelligence",
        title: "Intelligence",
        icon: "intelligence" as keyof typeof ICONS,
        tag: "AI-powered",
        desc: "One investment model, three synchronized views: Graph (relationships between companies, sectors, events, and your portfolio), Opportunity Map (where conviction is highest), and Timeline (how the thesis evolved). Select an entity in any view — it follows you to the other two.",
        highlight: true,
      },
    ],
  },
  {
    id: "research",
    label: "Research",
    description: "Deep-dive single names across US and Indian markets",
    modules: [
      {
        href: "/research",
        title: "Stock Research",
        icon: "research" as keyof typeof ICONS,
        tag: "Live data",
        desc: "Live quote, 5-year chart vs SPY, candlestick mode with 19 pattern detectors, SEC filings, AI composite score, insider activity, earnings history, and an AI research copilot. Auto-detects NSE/BSE tickers and renders India-specific ownership, financials, and peer modules.",
        highlight: true,
      },
      {
        href: "/compare",
        title: "Side-by-Side Compare",
        icon: "compare" as keyof typeof ICONS,
        tag: "Quantitative",
        desc: "Compare up to 5 stocks across valuation, quality, growth, momentum, and composite scoring. Radar chart and heatmap included.",
        highlight: false,
      },
    ],
  },
  {
    id: "analysis",
    label: "Deep Analysis",
    description: "IC-grade valuation and quantitative research tools",
    modules: [
      {
        href: "/ic-report",
        title: "IC Deep Research",
        icon: "icreport" as keyof typeof ICONS,
        tag: "Multi-agent",
        desc: "Full IC-grade pipeline: 9 parallel AI agents, bull/bear/base thesis, SOTP/DCF/relative valuation, FX sensitivity, and exportable committee report.",
        highlight: true,
      },
      {
        href: "/dcf",
        title: "DCF Valuation",
        icon: "dcf" as keyof typeof ICONS,
        tag: "Modeling",
        desc: "Build a discounted cash flow model for any ticker. Customise growth rates, WACC, and discount rates. Sensitivity table auto-generated.",
        highlight: false,
      },
      {
        href: "/engine",
        title: "Quant Engine",
        icon: "engine" as keyof typeof ICONS,
        tag: "Systematic",
        desc: "10-factor systematic scorecard: HMM regime detection, Monte Carlo DCF, quantile forecasts, factor history, and Kelly-optimal sizing.",
        highlight: false,
      },
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio & Tracking",
    description: "AI-managed portfolio, live monitoring, and earnings calendar",
    modules: [
      {
        href: "/watchlist",
        title: "Watchlist",
        icon: "watchlist" as keyof typeof ICONS,
        tag: "Monitoring",
        desc: "Track symbols with live prices, target-price and drop alerts, thesis notes, and quick access to research and valuation tools. Watchlist Intelligence surfaces structured, per-asset alerts automatically.",
        highlight: false,
      },
      {
        href: "/portfolio",
        title: "Portfolio",
        icon: "portfolio" as keyof typeof ICONS,
        tag: "AI Portfolio",
        desc: "AI Portfolio Management System — objective-driven recommendations, a Decision Queue (Buy More/Hold/Reduce/Exit/Monitor/Replace), stress testing, and an AI CIO memo that reviews your analytics and writes an institutional-grade brief.",
        highlight: true,
      },
      {
        href: "/calendar",
        title: "Earnings Calendar",
        icon: "calendar" as keyof typeof ICONS,
        tag: "Calendar",
        desc: "Upcoming earnings dates, ex-dividend dates, and macro events for your watchlist universe and S&P 500 coverage.",
        highlight: false,
      },
    ],
  },
];

const STATS = [
  { value: "12", label: "Research modules" },
  { value: "19", label: "Candlestick patterns" },
  { value: "9", label: "AI agents per IC report" },
  { value: "7", label: "Portfolio objectives" },
  { value: "100%", label: "Local inference" },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-16 px-6 py-16">

      {/* ── Hero ── */}
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4 max-w-3xl">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-0.5 text-xs font-medium text-accent">
              Local AI · No API Keys
            </span>
            <span className="rounded-full border border-border px-3 py-0.5 text-xs text-muted">
              US & Indian Markets
            </span>
            <span className="rounded-full border border-positive/30 bg-positive/10 px-3 py-0.5 text-xs font-medium text-positive">
              AI Portfolio Management
            </span>
          </div>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Institutional-grade equity research,{" "}
            <span className="text-muted">in your browser.</span>
          </h1>
          <p className="text-base leading-7 text-muted max-w-2xl">
            Live quotes, candlestick pattern detection, SEC filings, fundamental scoring, peer comparison,
            AI portfolio management with objective-driven recommendations, and a full investment committee
            pipeline — powered entirely by local Ollama. Zero cloud costs, zero data leakage.
          </p>
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap gap-6 border-t border-border pt-6">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className="font-mono text-xl font-semibold text-foreground">{s.value}</span>
              <span className="text-xs text-muted">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Primary CTAs */}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/research"
            className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Start with Research →
          </Link>
          <Link
            href="/portfolio"
            className="rounded-lg border border-positive/40 bg-positive/8 px-5 py-2.5 text-sm font-medium text-positive transition-colors hover:bg-positive/15"
          >
            AI Portfolio Management
          </Link>
          <Link
            href="/scanner"
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            Scan the market
          </Link>
          <Link
            href="/ic-report"
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            Run IC Report
          </Link>
        </div>
      </div>

      {/* ── Market Dashboard — regime, sector leadership, alerts, opportunities, calendar ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted/60">Market Dashboard</p>
          <div className="h-px flex-1 bg-border" />
        </div>
        <MarketDashboard />
      </div>

      {/* ── Today's Pulse — live portfolio/watchlist/calendar intelligence ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted/60">Today&apos;s Pulse</p>
          <div className="h-px flex-1 bg-border" />
        </div>
        <DailyPulse />
      </div>

      {/* ── Workflow groups ── */}
      <div className="flex flex-col gap-14">
        {WORKFLOW_GROUPS.map((group) => (
          <section key={group.id} className="flex flex-col gap-5">
            {/* Group header */}
            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted/60">
                  {group.label}
                </h2>
                <p className="text-sm text-muted">{group.description}</p>
              </div>
              <div className="mb-1 h-px flex-1 bg-border" />
            </div>

            {/* Module cards */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.modules.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  className={`group relative flex flex-col gap-4 overflow-hidden rounded-xl border bg-surface p-5 transition-all duration-200 hover:bg-surface-2 ${
                    m.highlight
                      ? "border-accent/30 hover:border-accent/50"
                      : "border-border hover:border-border/80"
                  }`}
                >
                  {/* Glow on highlighted cards */}
                  {m.highlight && (
                    <div
                      className="pointer-events-none absolute inset-0 opacity-30"
                      style={{ background: "radial-gradient(160px at top left, rgba(74,222,128,0.08), transparent)" }}
                    />
                  )}
                  {/* Hover glow on all cards */}
                  <div
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: "radial-gradient(120px at top left, rgba(74,222,128,0.05), transparent)" }}
                  />

                  <div className="flex items-start justify-between gap-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                      m.highlight
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "border-border bg-surface-2 text-muted group-hover:border-accent/30 group-hover:text-accent"
                    }`}>
                      <Icon path={ICONS[m.icon]} />
                    </div>
                    <Tag label={m.tag} />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-semibold text-foreground">{m.title}</h3>
                    <p className="text-xs leading-5 text-muted">{m.desc}</p>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-muted transition-colors group-hover:text-accent">
                    <span>Open</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6h8M6 2l4 4-4 4" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
