"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Command } from "lucide-react";
import { DailyPulse } from "./_components/daily-pulse";
import { GettingStarted } from "./_components/getting-started";
import { MarketDashboard } from "./_components/market-dashboard";
import { SymbolSearch } from "./_components/symbol-search";
import { PageShell, SectionHeader, Badge } from "./_components/ui";
import { NAV, type NavObjective } from "./_components/nav-config";

const STATS = [
  { value: "12", label: "Research modules" },
  { value: "19", label: "Candlestick patterns" },
  { value: "9", label: "AI agents per IC report" },
  { value: "7", label: "Portfolio objectives" },
  { value: "100%", label: "Local inference" },
];

/** Hero ticker search — the primary action on the landing. Deep-links to research. */
function HomeSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <SymbolSearch
        value={q}
        onChange={setQ}
        onSelect={(s) => s.trim() && router.push(`/research?symbol=${encodeURIComponent(s.trim().toUpperCase())}`)}
      />
      <p className="flex items-center gap-1.5 text-xs text-muted">
        Search any global ticker, or press
        <kbd className="inline-flex items-center gap-0.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-micro font-medium text-faint">
          <Command className="h-2.5 w-2.5" /> K
        </kbd>
        anywhere.
      </p>
    </div>
  );
}

/** One objective (Discover / Research / Portfolio) with its tools as quick links. */
function ObjectiveCard({ objective, index = 0 }: { objective: NavObjective; index?: number }) {
  const Icon = objective.icon;
  return (
    <div
      style={{ animationDelay: `${index * 70}ms` }}
      className="animate-fade-rise flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
    >
      <Link href={objective.href} className="group flex items-center gap-3 outline-none">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-brand transition-colors group-hover:border-brand/40">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-foreground transition-colors group-hover:text-brand">{objective.label}</span>
          <span className="text-xs text-muted">{objective.tagline}</span>
        </span>
      </Link>
      <div className="-mx-2 flex flex-col">
        {objective.tools.map((tool) => {
          const ToolIcon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className="group flex items-center gap-2.5 rounded-control px-2 py-1.5 text-sm text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:bg-surface-2"
            >
              <ToolIcon className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-brand" strokeWidth={1.75} />
              <span className="flex-1 truncate">{tool.label}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" strokeWidth={2} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const objectives = NAV.filter((o) => o.tools.length > 0);

  return (
    <PageShell gap="gap-14" py="py-12">
      {/* ── Hero ── */}
      <div className="animate-fade-rise flex flex-col gap-7">
        <div className="flex max-w-3xl flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand">Local AI · No API Keys</Badge>
            <Badge variant="neutral">Global Markets</Badge>
            <Badge variant="positive">AI Portfolio Management</Badge>
          </div>
          <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Institutional-grade equity research,{" "}
            <span className="text-muted">in your browser.</span>
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted">
            Live quotes, candlestick pattern detection, SEC filings, fundamental scoring, peer comparison,
            AI portfolio management, and a full investment-committee pipeline — powered entirely by local
            Ollama. Zero cloud costs, zero data leakage.
          </p>
        </div>

        <HomeSearch />

        {/* Compact credibility strip */}
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-6">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className="font-mono text-lg font-semibold tabular-nums text-foreground">{s.value}</span>
              <span className="text-xs text-muted">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Getting started (self-hides once set up) ── */}
      <GettingStarted />

      {/* ── Market Dashboard ── */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="Market Dashboard" description="Regime, sector leadership, alerts & opportunities" />
        <MarketDashboard />
      </section>

      {/* ── Today's Pulse ── */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="Today's Pulse" description="Your portfolio, watchlist & calendar at a glance" />
        <DailyPulse />
      </section>

      {/* ── Jump in — objective launcher ── */}
      <section className="flex flex-col gap-4">
        <SectionHeader label="Jump in" description="Everything you can do, one click away" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {objectives.map((o, i) => (
            <ObjectiveCard key={o.id} objective={o} index={i} />
          ))}
        </div>
      </section>
    </PageShell>
  );
}
