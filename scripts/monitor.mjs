#!/usr/bin/env node
/**
 * Background alert monitor.
 *
 * The server now runs this same monitor itself on a timer (instrumentation.ts
 * -> lib/monitor.ts, every UAA_MONITOR_INTERVAL_MS — default 5 min, 0 disables),
 * so this script is optional. It's still useful for native OS notifications
 * (the built-in scheduler only logs and persists — it doesn't toast) and for
 * headless setups that prefer an external driver. It hits the same
 * server-side monitor (/api/monitor/run) on a schedule, so watchlist/portfolio
 * alerts keep firing and persisting even with no tab open — and raises a
 * native OS notification for genuinely-new ones (24h-deduped by the server,
 * so it never re-notifies the same condition).
 *
 * Run it from cron or launchd; see scripts/README.md. Requires the UAA server to
 * be running (npm run dev / npm start). Configure the base URL with UAA_URL.
 *
 *   node scripts/monitor.mjs
 */

import { execFile } from "node:child_process";

const BASE = process.env.UAA_URL ?? "http://localhost:3000";

/** Fire a native notification (macOS today; no-op elsewhere). */
function osNotify(title, body) {
  if (process.platform !== "darwin") return;
  const escape = (s) => String(s).replace(/["\\]/g, "\\$&");
  const script = `display notification "${escape(body)}" with title "${escape(title)}"`;
  execFile("osascript", ["-e", script], () => {});
}

async function main() {
  let run;
  try {
    const res = await fetch(`${BASE}/api/monitor/run`, { method: "POST" });
    run = await res.json();
  } catch (err) {
    console.error(`[monitor] server unreachable at ${BASE} — is UAA running?`, err.message);
    process.exit(1);
  }

  const created = run?.created ?? 0;
  console.log(`[monitor] checked ${run?.checked ?? 0} symbols · ${created} new alert(s) · ${run?.unread ?? 0} unread`);
  if (created === 0) return;

  // Surface the new alerts as OS notifications.
  try {
    const res = await fetch(`${BASE}/api/notifications`);
    const { items = [] } = await res.json();
    for (const n of items.filter((n) => !n.read).slice(0, created)) {
      osNotify(n.title, n.body);
      console.log(`[monitor] → ${n.title}`);
    }
  } catch {
    /* notification surfacing is best-effort */
  }
}

main();
