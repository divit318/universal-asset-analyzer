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
