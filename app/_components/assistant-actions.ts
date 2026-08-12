/**
 * Client-side execution of the App Assistant's resolved mutations — the
 * "verify, then claim" half of the contract documented in
 * lib/ai-app-assistant.ts.
 *
 * The server RESOLVES a mutation (verified symbol + name); this module
 * EXECUTES it and reports what actually happened. Every write is awaited and
 * its response checked; the user-facing result line is derived from the API
 * outcome, never from intent. This replaced a fire-and-forget `void fetch(…)`
 * that navigated immediately — which both raced the watchlist page's own
 * fetch (the write takes longer than the page load, so the "added" row wasn't
 * there on arrival) and made failures invisible (during a dev-server SQLite
 * outage the assistant kept claiming successful adds indefinitely).
 *
 * Kept free of imports from lib/ — ai-assistant.tsx imports only TYPES from
 * lib/ai-app-assistant.ts, and a runtime import would pull the AI platform's
 * server-only dependency tree into the client bundle.
 */

export interface MutationItemResult {
  symbol: string;
  name: string;
  ok: boolean;
  /** API-reported reason, when the write failed and gave one. */
  error?: string;
}

/**
 * Execute watchlist adds one at a time, awaiting and verifying each write.
 * Passing the server-resolved `name` through matters beyond display:
 * `resolveDisplayName` in the POST route short-circuits on a provided name,
 * so the write path performs no second symbol lookup.
 */
export async function executeWatchlistAdds(
  items: { symbol: string; name: string }[],
  fetchImpl: typeof fetch = fetch,
): Promise<MutationItemResult[]> {
  const results: MutationItemResult[] = [];
  for (const { symbol, name } of items) {
    try {
      const res = await fetchImpl("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name }),
      });
      if (res.ok) {
        results.push({ symbol, name, ok: true });
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        results.push({ symbol, name, ok: false, error: body?.error });
      }
    } catch {
      results.push({ symbol, name, ok: false, error: "the request didn't reach the app" });
    }
  }
  return results;
}

/**
 * The verified outcome, as the user reads it. One line per requested asset —
 * a partial failure must never be summarized as a success. Pure / testable.
 */
export function describeMutationResults(results: MutationItemResult[]): {
  text: string;
  /** No write landed — the caller must not navigate as if one did. */
  allFailed: boolean;
} {
  const label = (r: MutationItemResult) => `${r.name} (${r.symbol})`;
  const lines = results.map((r) =>
    r.ok
      ? `✓ Added ${label(r)} to your Watchlist.`
      : `✗ Couldn't add ${label(r)}${r.error ? ` — ${r.error}` : ""}. Please try again.`,
  );
  return { text: lines.join("\n"), allFailed: results.every((r) => !r.ok) };
}
