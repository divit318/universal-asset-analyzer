#!/usr/bin/env node
/**
 * Create a Devin session via the Cognition v3 REST API.
 *
 * Shared by every Devin automation in .github/workflows/ (maintenance,
 * error triage, incident response) so the payload conventions live in one
 * place: every automated session gets a hard ACU spend cap, audit tags,
 * and the repo pre-attached. PR review does NOT go through here — it uses
 * the dedicated /pr-reviews endpoint (see devin-pr-review.yml).
 *
 * Auth (never hardcode; pass via env / GitHub Actions secrets):
 *   DEVIN_API_KEY   service-user key, `cog_` prefix (COGNITION_API_KEY also accepted)
 *   DEVIN_ORG_ID    organization id, `org-` prefix (Settings > Service Users)
 *
 * Usage:
 *   node scripts/devin/create-session.mjs \
 *     --title "Weekly dependency audit" \
 *     --prompt-file scripts/devin/prompts/maintenance.md \
 *     --tags scheduled-maintenance \
 *     --max-acu 5
 *
 *   --prompt "..."        inline prompt (alternative to --prompt-file)
 *   --prompt-file <path>  read prompt from a file
 *   --append-env <VAR>    append the contents of env var VAR to the prompt
 *                         (used by workflows to pass issue/incident context
 *                         without shell-escaping hazards)
 *   --repos <a,b>         repos to attach (default: this repo)
 *   --tags <a,b>          audit tags (always also tagged "automation")
 *   --max-acu <n>         hard per-session ACU cap (default 5)
 *   --title "<t>"         session title
 *
 * Prints the session URL; in GitHub Actions also exports `session_id` and
 * `session_url` step outputs.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    title: { type: "string" },
    prompt: { type: "string" },
    "prompt-file": { type: "string" },
    "append-env": { type: "string" },
    repos: { type: "string", default: "divit318/universal-asset-analyzer" },
    tags: { type: "string", default: "" },
    "max-acu": { type: "string", default: "5" },
  },
});

const apiKey = process.env.DEVIN_API_KEY ?? process.env.COGNITION_API_KEY;
const orgId = process.env.DEVIN_ORG_ID;
if (!apiKey || !orgId) {
  console.error(
    "[devin] missing DEVIN_API_KEY (or COGNITION_API_KEY) and/or DEVIN_ORG_ID",
  );
  process.exit(1);
}

let prompt = args.prompt ?? "";
if (args["prompt-file"]) prompt = readFileSync(args["prompt-file"], "utf8");
if (args["append-env"]) {
  const extra = process.env[args["append-env"]] ?? "";
  prompt = `${prompt.trimEnd()}\n\n${extra}`;
}
if (!prompt.trim()) {
  console.error("[devin] empty prompt — pass --prompt or --prompt-file");
  process.exit(1);
}

const maxAcu = Number.parseInt(args["max-acu"], 10);
const tags = [
  "automation",
  ...args.tags.split(",").map((t) => t.trim()).filter(Boolean),
];

const payload = {
  prompt,
  title: args.title ?? null,
  repos: args.repos.split(",").map((r) => r.trim()).filter(Boolean),
  tags,
  max_acu_limit: Number.isFinite(maxAcu) ? maxAcu : 5,
  // Default agent mode — "fast" is ~4x the ACU cost and never worth it for
  // background automation.
  devin_mode: "normal",
};

const res = await fetch(
  `https://api.devin.ai/v3/organizations/${orgId}/sessions`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  },
);

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  // v3 errors are RFC 9457 problem+json: { title, status, detail }.
  console.error(
    `[devin] session create failed (${res.status}): ${body.detail ?? body.title ?? "unknown error"}`,
  );
  process.exit(1);
}

console.log(`[devin] session created: ${body.url} (${body.session_id})`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `session_id=${body.session_id}\nsession_url=${body.url}\n`,
  );
}
