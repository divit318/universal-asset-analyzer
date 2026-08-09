# Background alert monitoring

The server now runs this monitor itself every `UAA_MONITOR_INTERVAL_MS`
(default 5 min; `0` disables) via `instrumentation.ts` -> `lib/monitor.ts` — no
external scheduling required. `scripts/monitor.mjs` remains useful for native
OS notifications (the built-in scheduler only logs and persists — it doesn't
toast) and for headless setups that prefer an external driver.

`scripts/monitor.mjs` drives the server-side alert monitor on a schedule so
watchlist/portfolio alerts fire even when no browser tab is open, raising a
native macOS notification for each genuinely-new alert (the server 24h-dedupes,
so the same condition never notifies twice).

**Requires** the UAA server to be running (`npm run dev` or `npm start`).

Run once:

```bash
npm run monitor            # or: node scripts/monitor.mjs
UAA_URL=http://localhost:3000 node scripts/monitor.mjs   # custom host/port
```

## Schedule it — launchd (recommended on macOS)

Runs every 5 minutes. Edit the `WorkingDirectory` path, then:

```bash
cp scripts/com.uaa.monitor.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.uaa.monitor.plist
# stop: launchctl unload ~/Library/LaunchAgents/com.uaa.monitor.plist
```

## Schedule it — cron (portable)

```cron
*/5 * * * * cd /ABSOLUTE/PATH/TO/universal-asset-analyzer && /usr/bin/env node scripts/monitor.mjs >> /tmp/uaa-monitor.log 2>&1
```

Notes
- 5 minutes is a sensible default; live quotes update continuously but alerts
  aren't time-critical. Tighten if you want faster delivery.
- Non-macOS platforms: the script still evaluates and persists alerts (they show
  in the header bell); only the OS-toast step is macOS-only for now.

# Demo portfolio seed (YC demo)

`scripts/demo-seed.ts` rebuilds the entire demo state as a 3-month investing
journey (2026-05-04 → 2026-08-06): the lot ledger, 37 pre/post-execution
portfolio snapshots (Trajectory), decision journal, pipeline/watchlist,
research sessions + notes, notifications, one simulation, two valuation cases
and the cached AI portfolio summary. It is idempotent and backs up
`data/app.db` first.

```bash
npx tsx scripts/demo-seed.ts
```

How it stays honest:
- Every lot is priced at the real close of its trade date
  (`scripts/demo-closes.ts` dumps the closes; `scripts/demo-survey.ts` is the
  window survey used to pick actual winners/losers).
- Every snapshot summary is computed by the real engines (`normalizeHoldings` →
  `evaluate` → `summaryOf`) against as-of prices and as-of-truncated history —
  no hand-typed health scores.
- Nothing references RGA: the book is engineered (underweight financials, 0.3%
  income yield, 13% cash sleeve) so that researching RGA live scores well on
  the same fit engine every other symbol goes through.

Before a live demo: load `/portfolio` once to warm the platform caches, and
note the AI portfolio summary cache lives in `scanner_cache` with a 15-minute
TTL — re-run the seed (or just let the AI regenerate) within that window.
