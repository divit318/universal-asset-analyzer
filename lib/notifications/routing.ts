/**
 * Notification routing registry — the single place that decides where a
 * notification takes the user when clicked.
 *
 * Server-only (reads the live watchlist/portfolio to catch a stale
 * destination before the client navigates to a page that no longer has
 * anything to show). Called from app/api/notifications/resolve/route.ts,
 * never imported into a client component.
 *
 * Every notification MUST resolve to a destination — there is no
 * "informational only" notification in this app. Unknown kinds fall through
 * to a generic symbol-scoped destination rather than a dead end.
 *
 * To add a destination for a new AlertKind, add one entry to ROUTES below —
 * a function from Notification -> path. Nothing else in the click/read/
 * highlight pipeline needs to change. The query string convention every
 * destination page understands:
 *   - `highlight=<id>`  — scrolls to and pulses `[data-arrival-target="<id>"]`
 *   - `tab=<tab>`       — for pages with client-side tabs (e.g. Portfolio)
 *
 * Spec mapping for kinds that don't exist as real alert producers yet
 * (portfolio recommendations, risk alerts, earnings, filings, dividends,
 * news, calendar events, scanner/screener signals) is deliberately not
 * stubbed here with fabricated routes — add the entry when the generator
 * that actually produces that kind of Notification ships, following the
 * pattern below.
 */
import { listWatchlist } from "../db";
import { listRawHoldings } from "../portfolio/store";
import type { Notification } from "../types";

export interface ResolvedDestination {
  href: string;
  /** True if the notification's original target no longer exists and this is a graceful fallback. */
  fallbackUsed: boolean;
  /** Human-readable reason, only set when fallbackUsed. */
  message: string | null;
}

function ok(href: string): ResolvedDestination {
  return { href, fallbackUsed: false, message: null };
}

function fallback(href: string, message: string): ResolvedDestination {
  return { href, fallbackUsed: true, message };
}

/** Watchlist-sourced price alerts: the Research page works for any valid
 *  ticker regardless of watchlist membership, so this destination never
 *  actually goes stale — but note if the item was since removed, so the
 *  user understands why it's no longer flagged on /watchlist. */
function routeResearchPrice(n: Notification): ResolvedDestination {
  if (!n.symbol) return fallback("/watchlist", "This alert has no associated symbol.");
  const href = `/research?symbol=${encodeURIComponent(n.symbol)}&highlight=price`;
  const stillWatched = listWatchlist().some((w) => w.symbol === n.symbol);
  if (!stillWatched) {
    return { href, fallbackUsed: false, message: `${n.symbol} is no longer on your watchlist — showing its live research page.` };
  }
  return ok(href);
}

/** Portfolio big-move alerts: the holding might have been sold since the alert fired. */
function routePortfolioHolding(n: Notification): ResolvedDestination {
  if (!n.symbol) return fallback("/portfolio", "This alert has no associated symbol.");
  const stillHeld = listRawHoldings().some((h) => h.symbol === n.symbol);
  if (!stillHeld) {
    return fallback("/portfolio", `You no longer hold ${n.symbol} — showing your current portfolio instead.`);
  }
  return ok(`/portfolio?tab=holdings&highlight=${encodeURIComponent(n.symbol)}`);
}

/** Generic default for any kind without a specific route — a symbol always resolves to Research. */
function routeDefault(n: Notification): ResolvedDestination {
  if (n.symbol) return ok(`/research?symbol=${encodeURIComponent(n.symbol)}`);
  return fallback("/", "This notification has no specific destination.");
}

const ROUTES: Record<string, (n: Notification) => ResolvedDestination> = {
  price_target: routeResearchPrice,
  drop_alert: routeResearchPrice,
  big_move: routePortfolioHolding,
};

export function resolveDestination(n: Notification): ResolvedDestination {
  const route = ROUTES[n.kind] ?? routeDefault;
  return route(n);
}
