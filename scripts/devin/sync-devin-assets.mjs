#!/usr/bin/env node
/**
 * Sync the UAA analyst playbook (scripts/devin/prompts/analyst-playbook.md)
 * to the Devin org via the v3 playbooks API. Idempotent: updates the existing
 * playbook when one with the same title exists, creates it otherwise.
 *
 * Prints the playbook_id — put it in .env.local as DEVIN_PLAYBOOK_ID so
 * lib/ai/providers/devin/provider.ts attaches it to every analysis session.
 *
 * Auth (never hardcode): DEVIN_API_KEY (cog_…), DEVIN_ORG_ID (org-…).
 * Usage: node --env-file=.env.local scripts/devin/sync-devin-assets.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.DEVIN_API_KEY ?? process.env.COGNITION_API_KEY;
const orgId = process.env.DEVIN_ORG_ID;
if (!apiKey || !orgId) {
  console.error("[devin-assets] missing DEVIN_API_KEY and/or DEVIN_ORG_ID (try: node --env-file=.env.local …)");
  process.exit(1);
}

const BASE = `https://api.devin.ai/v3/organizations/${orgId}`;
const HEADERS = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const TITLE = "UAA Analyst";

const dir = path.dirname(fileURLToPath(import.meta.url));
const body = readFileSync(path.join(dir, "prompts", "analyst-playbook.md"), "utf8");

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers: HEADERS });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname} → ${res.status}: ${data.detail ?? data.title ?? "unknown error"}`);
  }
  return data;
}

// Find an existing playbook by title (paginated list).
let existing = null;
let after = "";
do {
  const page = await api(`/playbooks?first=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
  existing = (page.items ?? []).find((p) => p.title === TITLE) ?? existing;
  after = page.has_next_page ? page.end_cursor : "";
} while (after && !existing);

let playbook;
if (existing) {
  playbook = await api(`/playbooks/${existing.playbook_id}`, {
    method: "PUT",
    body: JSON.stringify({ title: TITLE, body }),
  });
  console.log(`[devin-assets] updated playbook "${TITLE}"`);
} else {
  playbook = await api(`/playbooks`, {
    method: "POST",
    body: JSON.stringify({ title: TITLE, body }),
  });
  console.log(`[devin-assets] created playbook "${TITLE}"`);
}

const id = playbook.playbook_id ?? existing?.playbook_id;
console.log(`[devin-assets] DEVIN_PLAYBOOK_ID=${id}`);
console.log(`[devin-assets] add that line to .env.local to attach it to analysis sessions.`);
