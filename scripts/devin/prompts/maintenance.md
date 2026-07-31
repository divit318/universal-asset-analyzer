You are running the weekly dependency-maintenance pass for the
divit318/universal-asset-analyzer repository (Next.js 16 / React 19 / Node 26,
local-first app — see CLAUDE.md and AGENTS.md at the repo root and follow them).

Scope — do exactly this, nothing more:

1. Run `npm outdated` and `npm audit` and summarize the results.
2. Identify SAFE upgrades only:
   - patch/minor bumps of existing dependencies,
   - security fixes flagged by `npm audit`.
   Never propose major-version bumps of next, react, react-dom, tailwindcss,
   vitest, or eslint in this pass — list them in the summary as "needs a human
   decision" instead.
   Repo policy: only adopt dependency versions published at least 7 days ago.
3. Apply the safe upgrades with npm (edit via `npm install <pkg>@<version>`,
   not by hand-editing package.json), then verify with the same three commands
   CI runs: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
   If any of the three fails after a bump, revert that bump and note it.
4. If (and only if) there is at least one change that passes verification,
   open a single PR against main titled
   "chore(deps): weekly maintenance — <date>" with a body that lists each
   bump, why it is safe, and the audit findings that remain open.
   If there is nothing safe to upgrade, do not open a PR — just end the
   session with the summary.

Never touch app/globals.css, never run any shadcn CLI command, and never
modify the user-facing AI stack under lib/ai/ (it is Ollama-only by design).
