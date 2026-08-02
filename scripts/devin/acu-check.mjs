#!/usr/bin/env node
/**
 * ACU accounting check (Phase 5 amendment 5): reads the org's daily
 * consumption and the per-session acus_consumed for every uaa-tagged session,
 * and appends a timestamped line to ai-migration/acu-log.jsonl so the delta
 * against known sessions is auditable over time.
 *
 * Usage: node --env-file=.env.local scripts/devin/acu-check.mjs
 */

import { appendFileSync } from "node:fs";

const apiKey = process.env.DEVIN_API_KEY;
const orgId = process.env.DEVIN_ORG_ID;
if (!apiKey || !orgId) {
  console.error("[acu] missing DEVIN_API_KEY / DEVIN_ORG_ID (try: node --env-file=.env.local …)");
  process.exit(1);
}
const BASE = `https://api.devin.ai/v3/organizations/${orgId}`;
const HEADERS = { Authorization: `Bearer ${apiKey}` };

async function get(pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${pathname} → ${res.status}`);
  return res.json();
}

const daily = await get("/consumption/daily");

const sessions = [];
let after = "";
do {
  const page = await get(`/sessions?first=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
  sessions.push(...(page.items ?? []));
  after = page.has_next_page ? page.end_cursor : "";
} while (after);

const uaa = sessions.filter((s) => (s.tags ?? []).some((t) => t === "uaa" || t === "spike"));
const perSessionTotal = uaa.reduce((a, s) => a + (s.acus_consumed ?? 0), 0);
const nonZero = uaa.filter((s) => (s.acus_consumed ?? 0) > 0).length;

const record = {
  at: new Date().toISOString(),
  org_daily_total_acus: daily.total_acus ?? null,
  consumption_by_date: daily.consumption_by_date ?? [],
  uaa_sessions: uaa.length,
  uaa_sessions_with_nonzero_acus: nonZero,
  uaa_per_session_acu_sum: perSessionTotal,
};

console.log(JSON.stringify(record, null, 2));
appendFileSync("ai-migration/acu-log.jsonl", JSON.stringify(record) + "\n");
console.log("[acu] appended to ai-migration/acu-log.jsonl — re-run tomorrow to log the 24h delta");
