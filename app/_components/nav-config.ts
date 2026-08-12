import type { ComponentType, SVGProps } from "react";
import { LayoutDashboard, Compass, Microscope, Briefcase } from "lucide-react";
import {
  ScreenerIcon,
  WireIcon,
  ThematicIcon,
  QuantEngineIcon,
  ResearchIcon,
  CompareIcon,
  DcfIcon,
  IcReportIcon,
  KnowledgeGraphIcon,
  PortfolioIcon,
  WatchlistIcon,
  JournalIcon,
  CalendarIcon,
} from "./icons";

/** Any nav icon — a Terminus Mark icon (app/_components/icons.tsx) or, for
 * the 4 objective-level icons below (currently unused in the UI — see the
 * icon system exploration for why the header only ever renders tool icons),
 * a plain Lucide icon. Deliberately looser than Lucide's own `LucideIcon`
 * type so a hand-drawn icon component satisfies it too. */
export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

/* ============================================================================
   Information architecture — single source of truth for the header nav AND
   the ⌘K command palette. Top level is organized by USER OBJECTIVE (what you
   are trying to do), not by tool. Every tool is reachable in ≤2 clicks from the
   nav, or instantly from ⌘K.
   ========================================================================== */

export interface NavTool {
  href: string;
  label: string;
  desc: string;
  icon: NavIcon;
  /** Whether this tool takes a ?symbol= deep-link (used by the palette). */
  symbolParam?: "symbol" | "symbols";
  /** Extra search terms for the command palette. */
  keywords?: string[];
}

export interface NavObjective {
  id: string;
  label: string;
  href: string;
  tagline: string;
  icon: NavIcon;
  tools: NavTool[];
}

export const NAV: NavObjective[] = [
  {
    id: "today",
    label: "Today",
    href: "/",
    tagline: "Your market & portfolio at a glance",
    icon: LayoutDashboard,
    tools: [],
  },
  {
    id: "discover",
    label: "Discover",
    // Lands on the first tool below: the Wire is the daily stop after Today,
    // so it is also where a bare click on "Discover" should take you.
    href: "/wire",
    tagline: "Find your next idea",
    icon: Compass,
    tools: [
      // Ordered by session cadence, most-frequent first: the Wire is checked
      // daily (what's moving, which events are tradable), the Screener is the
      // deliberate search you run when you go looking, the Engine is the
      // systematic desk you consult, and Thematic is project-scale top-down
      // work you sit down for.
      { href: "/wire", label: "The Wire", desc: "Headlines clustered into events, traced to sectors, companies & your holdings", icon: WireIcon, keywords: ["news", "events", "signals", "catalysts", "scanner", "wire"] },
      { href: "/screener", label: "Screener", desc: "Filter by fundamentals, scores & AI criteria", icon: ScreenerIcon, keywords: ["filter", "screen", "quant", "fundamental"] },
      // The Engine generates ideas system-wide — a Discover job, not a
      // single-company Research one (§4.3). Signal Backtest used to sit beside it
      // as its own tool; it is now the Engine's own "Model validation" section,
      // because "do these signals work" is not a separate workflow from the desk
      // that produces them. Its palette keywords moved here with it.
      { href: "/engine", label: "Quant Engine", desc: "Systematic desk — regime, conviction book & model validation", icon: QuantEngineIcon, keywords: ["quant", "factor", "scorecard", "systematic", "kelly", "regime", "backtest", "validation", "edge", "hit rate", "probability", "conviction"] },
      { href: "/thematic", label: "Thematic", desc: "Map a macro theme's supply chain", icon: ThematicIcon, keywords: ["theme", "supply chain", "macro", "industry"] },
    ],
  },
  {
    id: "research",
    label: "Research",
    href: "/research",
    tagline: "Analyze any company, end to end",
    icon: Microscope,
    tools: [
      // A light→heavy diligence funnel: quick look, benchmark against peers,
      // price it, then commission the full committee dive. The Knowledge Graph
      // is the supplementary lens over all of it, so it closes the menu.
      { href: "/research", label: "Research Hub", desc: "Quote, charts, filings & AI copilot", icon: ResearchIcon, symbolParam: "symbol", keywords: ["quote", "chart", "filings", "copilot", "stock", "fund", "etf"] },
      { href: "/compare", label: "Compare", desc: "Up to 5 names side by side", icon: CompareIcon, symbolParam: "symbols", keywords: ["versus", "vs", "side by side"] },
      // Not a calculator: the workspace over one persisted ValuationCase per
      // company, which every other surface reads rather than computing its own
      // intrinsic value. Its counterpart — the Valuation Register, the book of
      // cases — belongs under Portfolio, because "which of my cases are broken"
      // is a portfolio job rather than a research one.
      { href: "/valuation", label: "Valuation", desc: "Your living valuation case per company", icon: DcfIcon, symbolParam: "symbol", keywords: ["valuation", "intrinsic", "cash flow", "wacc", "dcf", "reverse dcf", "fair value", "margin of safety", "case"] },
      { href: "/ic-report", label: "IC Report", desc: "9-agent institutional deep dive", icon: IcReportIcon, symbolParam: "symbol", keywords: ["committee", "thesis", "bull", "bear", "deep dive"] },
      // Promoted from two levels deep inside the dissolved /intelligence (§4.3).
      // Its deep-link is scope+id, not a plain ?symbol=, so no symbolParam here.
      { href: "/knowledge-graph", label: "Knowledge Graph", desc: "Explore how your names connect", icon: KnowledgeGraphIcon, keywords: ["graph", "network", "relationships", "connections", "map"] },
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    href: "/portfolio",
    tagline: "Manage what you own & watch",
    icon: Briefcase,
    tools: [
      // Monitoring first, review last: what you own, what you're watching, and
      // what's coming up for those names form the daily monitoring cluster;
      // the two judgment-grading surfaces close the menu — and the session.
      { href: "/portfolio", label: "Portfolio", desc: "Holdings, P&L & AI CIO memo", icon: PortfolioIcon, keywords: ["holdings", "pnl", "cio", "positions", "decisions"] },
      { href: "/watchlist", label: "Watchlist", desc: "Track names, alerts & notes", icon: WatchlistIcon, keywords: ["watch", "alerts", "notes", "targets"] },
      { href: "/calendar", label: "Calendar", desc: "Earnings & ex-dividend dates", icon: CalendarIcon, keywords: ["earnings", "dividend", "dates", "events"] },
      // The book of cases. A portfolio job, not a research one: "which of my
      // valuations have broken?" is asked while reviewing what you own, and it
      // sits beside the Decision Journal because both grade past judgment.
      { href: "/valuation/register", label: "Valuation Register", desc: "Every valuation case, and which need attention", icon: DcfIcon, keywords: ["valuation", "register", "cases", "margin of safety", "stale", "book of cases"] },
      { href: "/journal", label: "Decision Journal", desc: "Log calls, measure your track record", icon: JournalIcon, keywords: ["journal", "decisions", "track record", "conviction", "calibration", "hit rate"] },
    ],
  },
];

/** Flattened list of every navigable tool (for the command palette). */
export const ALL_TOOLS: (NavTool & { objective: string })[] = NAV.flatMap((o) =>
  o.tools.map((t) => ({ ...t, objective: o.label })),
);

/** Which objective owns a given pathname (for active-state highlighting). */
export function activeObjective(pathname: string): string | null {
  if (pathname === "/") return "today";
  for (const o of NAV) {
    if (o.tools.some((t) => pathname === t.href || pathname.startsWith(t.href + "/"))) {
      return o.id;
    }
  }
  return null;
}
