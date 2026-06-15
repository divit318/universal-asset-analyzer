import Link from "next/link";

const MODULES = [
  {
    href: "/research",
    title: "Research",
    desc: "Look up any ticker for a live Yahoo Finance quote, price history, recent SEC/EDGAR filings, and a local-AI analysis.",
    icon: "🔎",
  },
  {
    href: "/watchlist",
    title: "Watchlist",
    desc: "Save symbols to a local SQLite-backed watchlist and track live prices at a glance.",
    icon: "⭐",
  },
  {
    href: "/screener",
    title: "Screener",
    desc: "Filter the S&P 500 universe by sector, price, daily move, and market cap to surface ideas.",
    icon: "📊",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        <p className="font-mono text-sm text-accent">Universal Asset Analyzer</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-balance sm:text-5xl">
          Research equities with live data and local AI.
        </h1>
        <p className="text-lg leading-8 text-muted">
          Quotes from Yahoo Finance, filings from SEC EDGAR, and analysis from a
          model running on your own machine via Ollama — no API keys required.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {MODULES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/50 hover:bg-surface-2"
          >
            <span className="text-2xl">{m.icon}</span>
            <h2 className="text-lg font-medium">
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
