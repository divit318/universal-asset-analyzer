/**
 * Proactive Insights — the assistant's quiet, unprompted observations,
 * surfaced above the composer (never a popup). Deliberately reuses fully
 * computed engines rather than inventing new detection logic:
 *   - lib/ios/server.ts's getPortfolioForIOS() → already severity-ranked
 *     PortfolioAlert[] (concentration/risk/momentum/diversification/rebalance)
 *   - lib/calendar.ts's getCalendarEvents() → earnings already joined to the
 *     user's actual watchlist/portfolio symbols
 *
 * No LLM call — this is deterministic composition over already-cached data
 * (getPortfolioForIOS carries its own 5-minute in-memory cache), so it's
 * fast, free, and works even with Ollama offline. Returns at most one
 * insight: "a senior analyst quietly mentions the one most useful thing",
 * not a dashboard of everything that could be said.
 */

import { getPortfolioForIOS } from "./ios/server";
import { buildThreats } from "./home/threats";
import { getCalendarEvents } from "./calendar";

export interface ProactiveInsight {
  id: string;
  text: string;
  href: string;
  linkLabel: string;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

async function portfolioAlertInsight(): Promise<ProactiveInsight | null> {
  const { report } = await getPortfolioForIOS().catch(() => ({ report: null }));
  // The universal report's own threat list, already ranked highest-severity first —
  // the same list the Home digest and the Portfolio page read. This used to come
  // from a second engine's `alerts[]`, which ranked a different set of problems
  // computed from a different (and by then stale) ledger.
  const top = buildThreats(report).threats[0];
  if (!top) return null;
  return {
    id: top.id,
    text: top.title,
    href: top.href,
    linkLabel: "Open Portfolio",
  };
}

async function upcomingEarningsInsight(): Promise<ProactiveInsight | null> {
  const calendar = await getCalendarEvents().catch(() => null);
  if (!calendar) return null;

  const soon = calendar.events.filter((e) => {
    if (e.type !== "earnings" || (e.source !== "watchlist" && e.source !== "portfolio")) return false;
    const d = daysUntil(e.date);
    return d >= 0 && d <= 7;
  });
  if (soon.length === 0) return null;

  const symbols = [...new Set(soon.map((e) => e.symbol).filter((s): s is string => Boolean(s)))];
  const text =
    symbols.length === 1
      ? `${symbols[0]} reports earnings this week.`
      : `${symbols.length} of your tracked stocks report earnings this week: ${symbols.slice(0, 4).join(", ")}${symbols.length > 4 ? "…" : ""}.`;

  return { id: "earnings-week", text, href: "/calendar", linkLabel: "Open Calendar" };
}

/**
 * At most one insight: a structural portfolio issue (concentration, risk,
 * drift) outranks a routine calendar date, so alerts are checked first and
 * upcoming earnings is the fallback. An empty array — nothing to say right
 * now — is the common and correct case, not a failure.
 */
export async function buildProactiveInsights(): Promise<ProactiveInsight[]> {
  const alert = await portfolioAlertInsight();
  if (alert) return [alert];
  const earnings = await upcomingEarningsInsight();
  if (earnings) return [earnings];
  return [];
}
