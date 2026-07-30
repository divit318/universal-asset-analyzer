"use client";

import { useSyncExternalStore } from "react";

/**
 * When these numbers were priced.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * The report has always carried `generatedAt`, and nothing rendered it. So a page
 * showing $9.28M of live-priced positions gave no indication of how old those
 * prices were. Leave the tab open overnight, or return to a laptop after a
 * weekend, and every figure on screen — total value, today's move, VaR, the whole
 * attribution panel — is stale, presented with exactly the same authority as a
 * quote from ten seconds ago.
 *
 * That is the single most consequential omission a financial page can have, and it
 * costs one line. An investor who acts on an overnight-stale "Today +0.42%" has
 * been actively misled by the interface, not by the data.
 *
 * The age is recomputed on a timer rather than at render, because this page does
 * not re-render on its own: without the tick, a stamp reading "2 min ago" would
 * itself go stale and become the very thing it exists to prevent.
 */

/** Ages beyond this are called out rather than stated flatly. */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** How often the displayed age is refreshed. */
const TICK_MS = 30_000;

/**
 * "Now", as an external store rather than state written from an effect.
 *
 * Three constraints have to hold at once, and `useState` + `useEffect` cannot meet
 * all of them: the value must differ between server and client (so it cannot be
 * computed during render without a hydration mismatch), it must update on a timer
 * (so it cannot be computed once), and it must not be written from inside an effect
 * (`react-hooks/set-state-in-effect`). `useSyncExternalStore` is the primitive for
 * exactly this shape.
 *
 * The client snapshot is QUANTIZED to the tick interval so repeated reads within
 * one tick return an identical value — an unquantized `Date.now()` changes on every
 * call, which React treats as an infinitely-mutating store.
 */
function subscribeToTick(onChange: () => void): () => void {
  const t = setInterval(onChange, TICK_MS);
  return () => clearInterval(t);
}

const clientNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
/** The server has no meaningful "now" for this purpose; the age fills in on hydration. */
const serverNow = () => null;

function describeAge(ms: number): string {
  if (ms < 60_000) return "seconds ago";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = ms / 3_600_000;
  if (hours < 24) return `${hours < 2 ? "1 hour" : `${Math.round(hours)} hours`} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function AsOfStamp({ generatedAt }: { generatedAt: string }) {
  const at = Date.parse(generatedAt);
  // All three arguments are module-level constants, so they are already referentially
  // stable — wrapping them in useCallback/useMemo would add nothing.
  const now = useSyncExternalStore(subscribeToTick, clientNow, serverNow);

  if (!Number.isFinite(at)) return null;

  const ageMs = now == null ? 0 : Math.max(0, now - at);
  const stale = now != null && ageMs > STALE_AFTER_MS;
  const clock = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] ${stale ? "text-warning" : "text-muted/70"}`}
      title={`Every figure on this page was priced at ${new Date(at).toLocaleString()}. Reload to re-price.`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-warning" : "bg-positive"}`}
      />
      {/* Suppressed for the first paint only: the age is time-dependent and cannot
          match between server and client. The absolute clock time can, so it is
          rendered immediately and the relative age fills in on mount. */}
      <span suppressHydrationWarning>
        Priced {clock}
        {now != null && ` · ${describeAge(ageMs)}`}
        {stale && " · reload to re-price"}
      </span>
    </span>
  );
}
