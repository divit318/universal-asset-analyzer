# HANDOFF — login/landing/auth workstream → AI-migration workstream

Written by the login workstream (2026-08-05/06). Requests and notices for files
this workstream does not own. Nothing here is blocking; everything ships and
runs without these actions — they are integration niceties plus two contract
overlaps you should resolve deliberately.

## 1. Mount the account chip (site-header.tsx — yours)

`app/_components/account-menu.tsx` is built, tested via /settings/account
flows, and self-contained. To mount:

```tsx
import { AccountMenu } from "./account-menu";
// …in the header's right cluster, e.g. beside the status badge:
<AccountMenu />
```

It renders nothing while signed out (gate-off daily mode has no account), so
mounting it is safe regardless of UAA_AUTH_GATE.

## 2. Top-bar status badge (deferred by owner)

The owner deferred the status-badge decision (the Ollama badge this workstream
was approved to reuse was deleted mid-flight by your migration). No action
needed from you yet; the slot is simply not filled by this workstream.

## 3. e2e/landing.spec.ts — hero contract now stale (yours)

The owner approved a hero/header rework (Row 10 + pill nav). Your spec still
pins the previous contract; these assertions now fail **by design**:

- `landing hero (Milestone 2)`: h1 is now "Every figure computed. Every claim
  traced." (old line moved into the subhead); `hero-product-reveal` testid was
  replaced by the `hero-stipple` illustration; hero primary CTA is now a
  button ("Get started") that opens the auth modal, not a link into the app.
- `ships marketing chrome…`: "Experience UAA" no longer exists in the header;
  the pair is ghost "Sign in" + filled "Get started" (buttons, not links).
- `mobile menu`: the dropdown became a focus-trapped Drawer sheet
  (role=dialog named "Menu"); `#landing-mobile-nav` still exists inside it,
  but the toggle is now labelled only "Open menu" (close is inside the sheet).
- The hero no longer carries the "Runs 100% on your computer" badge: the owner
  ruled hero copy must be outcome-independent about AI locality while your
  migration is unresolved.

Replacement assertions live in `e2e/landing-hero.spec.ts` (this workstream's
file, runs on :3121 via `playwright.login.config.ts`). Please update or retire
the overlapping blocks in landing.spec.ts when you next touch it.

## 4. package.json / .env.example (shared, edited before ownership rules landed)

Two additive lines in `scripts` ("demo", "predemo" — the owner-approved
demo-gate entry: `UAA_AUTH_GATE=on next dev`) and a commented UAA_AUTH_GATE
block appended to .env.example. Both are uncommitted and will ride along with
your next commit of those files — keep them, they are owner-approved.

## 5. app/_components/ui/index.ts (yours by default)

`PasswordInput` (app/_components/ui/password-input.tsx) is imported by direct
path everywhere in this workstream. If you want it in the barrel, add:

```ts
export { PasswordInput } from "./password-input";
```

## 6. Landing copy at risk (owner requested inventory; for your awareness)

The committed landing sections/FAQ claim local-only AI ("Local AI analysis —
no cloud keys, no metering", "Local models via Ollama", privacy section).
Untouched by this workstream per owner instruction; they are false if your
Anthropic migration lands as-is. The owner has the full two-column inventory
in this workstream's final report.

## 7. Scroll-lock scrollbar shift (dialog.tsx — yours)

The shared Dialog/Drawer lock body scroll with `overflow: hidden`, which
shifts layout on scrollbar-visible platforms (Windows, macOS "always show").
`scrollbar-gutter: stable` on `html` would remove the shift product-wide. Not
changed here — dialog.tsx is yours.

## 8. Pre-existing 375px overflow in section#comparison (yours)

At a 375px viewport, `/landing` scrolls horizontally by ~112px and the source
is `section#comparison` (verified by element isolation: hiding only that
section takes `documentElement.scrollWidth - clientWidth` from 112 to 0). The
table sits in an `overflow-x-auto` div, but the overflow still escapes to the
document. Pre-existing — not introduced by the login rework; the login suite's
375px assertion isolates the section (with a comment pointing here) so it can
keep guarding the hero/nav surfaces.

## 9. Shared e2e/.tmp wipe race (playwright.config.ts + global-setup — shared)

On 2026-08-06 ~00:33 your primary suite's global-setup ran `rmSync(e2e/.tmp)`
while the login suite's server (:3121) held `login-e2e.db` in that directory —
every subsequent login-suite request 500'd. global-setup (login workstream
owns it) now scopes cleanup: secondary suites (UAA_E2E_DB set) delete only
their own file; the primary path's full-wipe behaviour is unchanged. If you
can, avoid running the primary suite while a :3121 server is up — or agree a
lock file.

## 10. faq.tsx now contradicts the shipped auth (yours)

Your rewritten FAQ (app/landing/_components/sections/faq.tsx:17) says "UAA has
no sign-up and no login. The only credential is your own Anthropic API key."
As of the login workstream's commits there IS a local account system: a
sign-in/sign-up modal on this very page, an env-driven gate (`UAA_AUTH_GATE`,
off by default, on for `npm run demo`), and /settings/account. Credentials
stay in the local SQLite. Suggest e.g. "No cloud account. An optional local
sign-in (stored in your own database) protects shared machines and powers the
demo flow." Owner must approve final copy — flagged in the final report too.
