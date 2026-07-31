# Devin Engineering Automation

Devin (Cognition's cloud coding agent, [docs.devin.ai](https://docs.devin.ai))
is wired into this repo's **engineering workflow only** — PR review, weekly
dependency maintenance, error triage, and (dormant) incident response. It is
deliberately **not** part of the app: the user-facing AI analysis stack stays
on local Ollama via `lib/ai/`, and nothing under `app/` or `lib/` ever calls
the Devin API.

Components:

| Piece | File | Trigger |
|---|---|---|
| Session helper | `scripts/devin/create-session.mjs` | called by workflows |
| Prompts (versioned) | `scripts/devin/prompts/*.md` | — |
| PR review | `.github/workflows/devin-pr-review.yml` | PR opened / reopened / undrafted |
| Weekly maintenance | `.github/workflows/devin-maintenance.yml` | cron Mon 14:00 UTC + manual |
| Error triage | `.github/workflows/devin-error-triage.yml` | `devin-triage` label on an issue |
| Incident response | `.github/workflows/devin-incident.yml` | `repository_dispatch` (inert today) |

## One-time setup

### 1. Create a Devin service user

1. In [app.devin.ai](https://app.devin.ai) go to **Settings > Service users**.
2. Create a service user (e.g. `uaa-automation`) with a role that includes
   `ManageOrgSessions` and `UseReviewManual`. Nothing else is needed —
   least privilege on purpose.
3. Copy the API key (`cog_...`, shown once) and the org ID (`org-...`, shown
   on the same page).

### 2. Add GitHub Actions secrets

```bash
gh secret set DEVIN_API_KEY --repo divit318/universal-asset-analyzer   # cog_...
gh secret set DEVIN_ORG_ID  --repo divit318/universal-asset-analyzer   # org-...
```

Every workflow degrades to a no-op warning (PR review, maintenance) or a
clear failure (triage, incident) when the secrets are missing, so merging
this before the secrets exist is safe.

To use the helper locally, put the same two vars in `.env.local` (see
`.env.example`) and run e.g.:

```bash
node scripts/devin/create-session.mjs --title "Test" --prompt "Say hi and stop." --max-acu 1
```

### 3. Sentry (feeds error triage)

1. Create a free Sentry org + a Next.js project at sentry.io.
2. Put the DSN in `.env.local` as both `SENTRY_DSN` and
   `NEXT_PUBLIC_SENTRY_DSN`. Without them the SDK is a complete no-op —
   error tracking is opt-in, like every other env var here.
3. In Sentry: **Settings > Integrations > GitHub** — install it and link this
   repo, then enable issue creation via an alert rule (**Alerts > Create
   Alert > Issues**, action "Create a GitHub issue") so new error groups file
   GitHub issues automatically. Sentry's grouping is the dedupe layer: one
   issue per error signature, not per event.
4. Create the label the triage gate listens for:
   ```bash
   gh label create devin-triage --repo divit318/universal-asset-analyzer \
     --color D93F0B --description "Launch a Devin session to root-cause and fix this error"
   ```

SDK wiring already in the repo: `sentry.server.config.ts` (server init, loaded
by `instrumentation.ts`, which also exports `onRequestError`),
`instrumentation-client.ts` (browser init), `app/global-error.tsx` (render
crashes). Tracing is disabled (`tracesSampleRate: 0`) — errors only, free tier.

## How each integration works

### PR review

`devin-pr-review.yml` calls Devin Review's dedicated endpoint — no session
payload, Devin fetches the PR head itself and leaves inline comments:

```
POST https://api.devin.ai/v3/organizations/{org_id}/pr-reviews
Authorization: Bearer cog_...
{ "pr_url": "https://github.com/divit318/universal-asset-analyzer/pull/123" }
```

A `409` means a review for that commit is already pending — treated as
success. Review runs on open/reopen/undraft only, **not** every push; re-run
the workflow manually for a re-review, or manage trigger modes centrally in
app.devin.ai **Settings > Review**.

### Weekly maintenance

`devin-maintenance.yml` creates one session per week from
`scripts/devin/prompts/maintenance.md`:

```
POST https://api.devin.ai/v3/organizations/{org_id}/sessions
Authorization: Bearer cog_...
{
  "prompt": "<contents of maintenance.md>",
  "title": "Weekly dependency audit — 2026-08-03",
  "repos": ["divit318/universal-asset-analyzer"],
  "tags": ["automation", "scheduled-maintenance"],
  "max_acu_limit": 5,
  "devin_mode": "normal"
}
```

The prompt enforces repo policy: patch/minor bumps only, versions ≥7 days
old, majors flagged for a human, verified with the same `tsc`/`vitest`/`build`
trio as `verify.yml`, one PR max, no PR when there's nothing to do.

> Alternative: Devin also has a native Schedules API
> (`POST /v3/organizations/{org_id}/schedules` with `cron_schedule` +
> `timezone`) that removes GitHub Actions from the loop. We chose Actions so
> the prompt and cadence stay versioned in-repo next to `verify.yml`.

### Error triage (human-gated)

Flow: **Sentry error → auto-filed GitHub issue → you add `devin-triage` →
session launches → PR that `Fixes #N`** (or findings commented on the issue
if Devin can't root-cause within budget). The workflow comments the session
URL on the issue so the audit trail lives where the error does.

GitHub is the webhook receiver by design — the app is localhost-only and can
never terminate a Sentry webhook itself. The label gate means noisy or
duplicate errors cost **zero** ACUs until a human opts in, and the issue body
is passed to the prompt as quoted data (via env var, after an instruction to
treat it as data, not instructions) to blunt prompt-injection through crafted
error messages.

### Incident response (inert until there's a deployment)

The app currently has no deployment, so there is nothing for an uptime
monitor to watch. `devin-incident.yml` is checked in but dormant: it listens
for a `repository_dispatch` event nothing sends yet, plus `workflow_dispatch`
for end-to-end testing today.

To activate later (e.g. free-tier UptimeRobot): UptimeRobot's free webhooks
can't set an `Authorization` header, so relay through a ~20-line Cloudflare
Worker that holds a fine-grained GitHub PAT (contents: read, actions: write):

```js
export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("nope", { status: 405 });
    const alert = Object.fromEntries(new URL(req.url).searchParams); // UptimeRobot passes *alert* vars as query params
    await fetch("https://api.github.com/repos/divit318/universal-asset-analyzer/dispatches", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "uaa-incident-relay",
      },
      body: JSON.stringify({ event_type: "uaa-incident", client_payload: alert }),
    });
    return new Response("ok");
  },
};
```

Devin then investigates the outage window against recent commits and opens a
postmortem PR (`docs/postmortems/<date>-<slug>.md`). The workflow's
concurrency group stops a flapping monitor from fanning out sessions.

## Cost (ACU / on-demand credit) budgeting

Devin meters actual work performed; idle/sleeping sessions cost ~nothing
(auto-sleep after ~0.1 ACU idle). Every automated session here is created
with `devin_mode: "normal"` (fast mode is ~4x cost) and a hard
`max_acu_limit`, so the worst case is bounded:

| Pattern | Typical | Hard cap | Worst-case cadence |
|---|---|---|---|
| PR review | fraction of an ACU per review | n/a (product-managed) | per PR opened |
| Weekly maintenance | 1–4 ACUs; well under 1 on a no-op week | 5 | 1/week |
| Error triage | 2–6 ACUs per investigated issue | 8 | only when you label |
| Incident response | 2–5 ACUs | 5 | dormant |

Rules of thumb:

- Steady state is roughly **5–10 ACUs/month** (maintenance + a few reviews).
  Each labeled triage adds a few more. On self-serve plans these draw from
  quota/on-demand credits at the same dollar value.
- Every session is tagged (`automation` + a per-workflow tag), so spend is
  auditable per pattern in app.devin.ai **Settings > Consumption** / Session
  Insights, or via
  `GET /v3/organizations/{org_id}/consumption/daily`.
- If a session hits its cap mid-task, it stops; the triage prompt tells Devin
  to comment partial findings on the issue rather than guess.
- Don't lower the review trigger to every-commit (`synchronize`) unless PR
  volume is low — that is the easiest way to burn credits silently.
