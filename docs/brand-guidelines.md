# UAA Brand Guidelines — The Instrument of Record

> Version 1.0 · 2026-07-31 · Status: **Approved identity, pre-implementation (Phase 0)**
>
> This document is the single source of truth for UAA's brand identity. It governs the
> product application, marketing surfaces, exports, presentations, and social assets.
> **Nothing in this document is implemented in the app yet.** Implementation follows the
> phased roadmap in §14. Until Phase 1 ships, `app/globals.css` still carries the legacy
> sky-blue tokens; where the two disagree, this document describes the destination and
> `globals.css` describes the present.

---

## Quick Reference

| Element | Value |
|---------|-------|
| Identity name | The Instrument of Record |
| One-line idea | UAA is a private financial institution with a staff of one |
| Motto | Evidence in ink. Verdicts in brass. |
| Primary Color | #C8A96E |
| Secondary Color | #131519 |
| Accent Color | #E2C489 |
| Primary Font | Geist (interface) |
| Data Font | Geist Mono (computed fact) |
| Judgment Font | Tiempos Text (or Source Serif 4) |
| Voice | Exact, Measured, Sovereign, Candid |

---

## 1. Brand Philosophy

### 1.1 The central idea

**UAA is a private financial institution with a staff of one.** Not an app you use — an
institution you own. It has a research department (the 9-agent IC pipeline), a quant desk
(the Python/DuckDB engine), a committee (you), an archive (SQLite, on your premises), and
a track record (the journal). Everything it produces is *of record*: computed, attributed,
auditable, and kept locally.

The brand renders the two things such an institution deals in — **evidence** and
**verdicts** — as two visibly different materials:

- **Ink on graphite** — evidence. Quiet, achromatic, dense, exact.
- **Brass** — judgment. Rationed, warm, machined, final.

### 1.2 The emotional target

Opening UAA should feel like sitting down at a desk machined for you alone — the way a
pilot feels about a cockpit. Not "welcomed," not "delighted": **equipped**. The dominant
emotions are composure, sovereignty, and the pleasure of a tool that takes you seriously.
Bloomberg feels like a trading floor — shared, loud, urgent. UAA is its deliberate
opposite: **the quiet room where the decision actually gets made.**

### 1.3 The five governing principles

1. **Color is earned by judgment.** The interface is achromatic ink on graphite. Hue
   appears only where meaning exists: market semantics (green/red/orange) belong to the
   data; brass belongs to verdicts and to the points where the hand touches the
   instrument. Decoration never gets a hue.
2. **Three kinds of truth, three voices.** Computed fact (mono), interface (grotesk), and
   judgment (serif) are typographically distinct. You can tell what species of statement
   you're reading before you read it.
3. **Everything converges.** The diamond is the system's terminal particle, not a logo.
   Evidence flows (bars, lines, lists); decisions *set* (the diamond). Wherever a process
   resolves, a diamond marks the terminus.
4. **The record is sacred.** Every claim is attributed (Computed / AI / Cached, with
   timestamps), every score names its question, every export is sealed. Provenance is a
   visible aesthetic, not metadata.
5. **Density is respect.** UAA never dumbs a surface down; it organizes it. Whitespace is
   used for hierarchy, not emptiness. Wasting a professional's screen is an insult.

---

## 2. Brand Personality

### Brand Personality

If UAA were a person: *a senior portfolio manager who left the fund, kept the discipline,
and built their own desk.*

| Trait | We are | We are never |
|-------|--------|--------------|
| **Exact** | States numbers, sources, confidence. "Typically 15–40 s, depending on reasoning depth." | Vague, rounded, promotional |
| **Measured** | Speaks when it has a verdict. Silence is a feature. | Chatty, notification-hungry |
| **Sovereign** | Your data and every computed figure answer to no cloud and no vendor; the one external dependency — AI narration — runs on a key the user owns. | Defensive about locality; privacy-theater boilerplate; claiming zero egress |
| **Candid** | Shows the work, admits low confidence, reports its own signal degradation. | Falsely certain; hiding methodology |
| **Warm-metal** | Premium through craft: weight, finish, precision. | Gold-foil luxe, neon, gradients-as-glamour |

---

## 3. Color System

### 3.1 Philosophy

**"Blue leaves the chrome and returns to the data."** The legacy brand sky-blue
(`#38bdf8` / `#0284c7`) is retired as the accent. The freed blue hue re-enters the
categorical chart palette as steel blue, where hue actually encodes information. In its
place, a two-material system: the instrument (ink and graphite, ~95% of every screen) and
the seal (brass, rationed to particles).

**The rationing rule (what makes it iconic):** brass appears only at hairline and particle
scale — a diamond, a rim, a seal, a focus ring, one primary action per view. If a screen
ever looks "gold," the system is being misused. Scarcity is the signature.

### Primary Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Brass | #C8A96E | rgb(200,169,110) | Dark-theme `--brand`: verdict seals, terminus diamond, focus rings, active states, the one primary action per view |
| Brass Dark | #7A5F33 | rgb(122,95,51) | Light-theme `--brand` (AA on white and #f7f8fa) |

### Accent Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Brass Lit | #E2C489 | rgb(226,196,137) | Dark-theme `--brand-strong`: hover/lit brass |
| Brass Lit Dark | #5F4A26 | rgb(95,74,38) | Light-theme `--brand-strong` |

`--brand-muted` remains a mix: `color-mix(in srgb, var(--brand) 12%, transparent)` (dark),
10% (light). Used for selected rows and tinted surfaces only.

### Neutral Palette — The Instrument (unchanged from current product)

The existing graphite/ceramic ramps are part of the identity and are retained as-is.

**Dark ("machined obsidian under a single overhead light"):**

| Token | Hex | Role |
|-------|-----|------|
| background | #0a0b0e | Ground |
| surface | #131519 | Panels |
| surface-2 | #1a1d23 | Raised |
| surface-3 | #23272f | Highest |
| border | #282d37 | Rules |
| border-strong | #384049 | Emphasized rules |
| foreground | #edeff2 | Ink |
| muted | #99a3b2 | Secondary ink |
| faint | #626c7a | Tertiary ink |

**Light ("near-white ceramic, workshop lighting"):** background #f7f8fa, surface #ffffff,
surface-2 #f4f6f9, surface-3 #e9edf2, border #e2e6ec, border-strong #cdd4dd, foreground
#101722, muted #56606f, faint #8a94a2.

The machined-instrument material system (panel gradients, specular top rims, depth
shadows, the `body::before` overhead light — hereafter **the desk lamp**) is a brand
asset and is retained unchanged.

### Semantic Colors — market semantics (sovereign; never used for chrome, never used by the brand)

| State | Dark | Light | Usage |
|-------|------|-------|-------|
| Positive | #4ade80 | **#15803D** (was #16a34a) | Gains, buys, upside. Data only. |
| Negative | #f87171 | **#B91C1C** (was #dc2626) | Losses, sells, risk. Data only. |
| Warning | **#FB923C** (was #fbbf24) | **#C2540A** (was #d97706) | Cautions, degraded signals. Data only. |

Warning migrates from amber to signal orange so no viewer ever confuses a caution with a
brass verdict seal. The light-theme value must be #C2540A (4.60:1 on white, AA); the
brighter #EA580C fails at 3.56:1 and is prohibited for text.

### Categorical chart palette

Orange leaves the palette (it now means "warning"); steel blue — the hue the chrome
vacated — takes its slot.

| Slot | Dark | Light |
|------|------|-------|
| chart-1 violet | #a855f7 | #a855f7 |
| chart-2 steel | **#60A5FA** (was #f97316) | **#2563EB** |
| chart-3 teal | #2dd4bf | #0d9488 |
| chart-4 pink | #f472b6 | #db2777 |
| chart-5 slate | #64748b | #64748b |

### Accessibility (verified 2026-07-31, WCAG 2.1 relative-luminance math)

| Pair | Ratio | Grade |
|------|-------|-------|
| Brass #C8A96E on background #0a0b0e | 8.77:1 | AAA |
| Brass #C8A96E on surface #131519 | 8.14:1 | AAA |
| Brass #C8A96E on surface-3 #23272f | 6.67:1 | AA+ |
| Brass Lit #E2C489 on background | 11.71:1 | AAA |
| Button ink #0a0b0e on brass #C8A96E | 8.77:1 | AAA |
| Warning #FB923C on dark background | 8.70:1 | AAA |
| Steel #60A5FA on dark background | 7.74:1 | AAA |
| Brass Dark #7A5F33 on #ffffff | 5.98:1 | AA (all sizes) |
| Brass Dark #7A5F33 on #f7f8fa | 5.63:1 | AA |
| Brass Lit Dark #5F4A26 on #ffffff | 8.42:1 | AAA |
| White on brass #7A5F33 (light-theme button) | 5.98:1 | AA |
| Warning #C2540A on #ffffff | 4.60:1 | AA |

All interactive elements must meet WCAG 2.1 AA. Focus rings are brass in both themes.

---

## 4. Typography — Three Voices

Type roles map to the product's epistemology. The typeface tells you what kind of truth
you are reading.

| Voice | Species of truth | Face | Usage |
|-------|------------------|------|-------|
| **The Ledger** | Computed fact | Geist Mono | Every number, ticker, score, timestamp, table figure. Always `tabular-nums`. Numbers right-align like a ledger. |
| **The Instrument** | Interface | Geist | All UI chrome: labels, nav, buttons, captions, form controls. |
| **The Analyst** | Judgment | Tiempos Text / Tiempos Headline (licensed) — Source Serif 4 as the free stand-in | AI-written prose only: daily brief headline, IC report narrative, verdict rationales, copilot answers, thesis text. Also marketing headlines. |

### Font Stack

```css
--font-data:      "Geist Mono", ui-monospace, monospace;        /* the Ledger */
--font-interface: "Geist", system-ui, sans-serif;               /* the Instrument */
--font-judgment:  "Tiempos Text", "Source Serif 4", Georgia, serif; /* the Analyst */

/* Aliases for brand tooling (.claude/skills/brand) — same faces, generic names */
--font-heading: 'Tiempos Text';
--font-body: 'Geist';
--font-mono: 'Geist Mono';
```

### Typography rules

- Serif is **only** for judgment prose. If it appears in a label, a table, or chrome, the
  system is broken. A user must learn within a day: serif = the machine's opinion, mono =
  the machine's arithmetic.
- The existing micro-hierarchy is a brand asset and is retained: text-micro 9px
  (uppercase pill labels), text-label 10px (uppercase micro-headers, tabular numerics),
  text-caption 11px.
- Weights: 400/500/600; 700 is rare. Display sizes are reserved for exactly two moments:
  the serif judgment headline (26–31px, e.g. the daily brief) and the mono hero figure.
- Sentence case everywhere except the established uppercase-tracked micro-labels.

### Type Scale

| Element | Voice | Size | Weight | Notes |
|---------|-------|------|--------|-------|
| Judgment headline | Analyst (serif) | 26–31px | 500 | Daily brief, IC report cover, verdict rationale lead |
| Hero figure | Ledger (mono) | 28–40px | 600 | Portfolio value, primary score |
| Page title | Instrument | 20–24px | 600 | |
| Section header | Instrument | 14–16px | 600 | |
| Body / judgment prose | Analyst (serif) in memos; Instrument elsewhere | 14–16px | 400 | Serif at 1.6 leading in memo surfaces |
| Table figures | Ledger (mono) | 12–13px | 400–600 | `tabular-nums`, right-aligned |
| Caption | Instrument | 11px | 400 | |
| Micro-label | Instrument | 9–10px | 500–600 | Uppercase, tracked |

---

## 5. Shape Language

One shape governs: **the diamond** — a square rotated 45° because work finished. It is the
terminal particle of the whole system:

- List bullets in reports → small ink diamonds; the accepted recommendation's bullet is brass.
- Chart data points → diamonds; the latest/decisive point is brass.
- Timeline nodes, graph vertices, stepper states → pending = outline square, resolved =
  filled diamond (the loading mark's grammar, applied everywhere).
- Checked states, active nav ticks, slider thumbs → diamond.
- Favicon, avatar, watermark, PDF seal → the diamond.

Everything else stays rectilinear and calm. The role-named radii are retained: control
8px, card 14px, panel 16px. Hairline rules (`--edge-hairline`) are the connective tissue,
used like the rulings of ledger paper.

**The one-sentence law: "No circles. A diamond is a decision."**

---

## 6. Logo & Iconography

### 6.1 The Convergence Point (mark) — retained

Four bars of evidence converging to a diamond terminus. The mark's behavior — the terminus
rotating from square to diamond the moment work resolves — is a brand asset and must not
be altered. The terminus inherits `--brand`, so it becomes brass automatically at Phase 1.

### 6.2 Wordmark — retained with a formal lockup spec

`◆ asset/analyzer` in Geist Mono, semibold, tracking-tight. The diamond is always
`--brand`.

| Rule | Value |
|------|-------|
| Clear space | One diamond width on all sides |
| Minimum size | Full wordmark ≥ 96px wide; below 24px use the monogram |
| Monogram | The brass diamond alone (favicon, avatars, watermarks) |

**Don'ts:** don't rotate or skew; don't recolor the diamond outside `--brand`; don't add
shadows, gradients, or glow; don't set the wordmark in any face but Geist Mono.

### 6.3 The Terminus Mark icon set — retained as icon law

Legible pictographs, `currentColor` strokes at 1.6px, every circle a conventional icon
would use replaced by a brass diamond. Elevated from "nav icon set" to the icon law of the
entire brand: status dots, presence markers, alert badges, empty-state glyphs, and
marketing spot icons all obey it.

### 6.4 Loading experience — retained

The LoadingMark (arrive-hold-fade wave → square-to-diamond resolve) and boot splash stay
as shipped. Boot messages adopt the brand voice: the institution reporting for duty
("Waking the quant desk… Reading the wire… Convening the committee…").

---

## 7. Layout, Grid & Spacing

**"The ledger and the memo."** Two reading postures, already latent in `PageShell`, now
doctrinal:

| Posture | Width | Surfaces | Character |
|---------|-------|----------|-----------|
| **The Ledger** | wide (1920px) | Screener, Portfolio, Engine, Compare, Watchlist | Dense tables, hairline rulings, sticky headers, right-aligned mono numerals |
| **The Memo** | reading (1280px) | IC Report, Brief, Journal, Calendar | Single measure ~68ch, serif body, generous leading, footnoted evidence |

- Rhythm rule: **vertical hairlines separate evidence; whitespace separates arguments.**
- Grid: strict 12-column, 4px base unit.
- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Panels sit under the desk lamp (the single overhead light on `body::before`) — retained.

---

## 8. Component Language

- **Panels**: machined treatment retained — lit top face, specular rim, grounded shadow.
  Finish name: *graphite, brushed, lit from above.*
- **The Verdict Seal** (new signature component, Phase 3): every Buy/Hold/Sell call
  renders as a seal — a diamond-anchored badge, brass-rimmed, mono score + serif one-line
  rationale. Same anatomy everywhere a banded score appears (research hero, compare,
  screener rows, exports). Replaces generic rounded-pill recommendation badges. Only
  score kinds that are genuinely Buy/Hold/Sell calls get seals (see `lib/score-kinds.ts`).
- **Provenance chips**: Computed / AI / Cached badges become a formal system — square chip
  = raw data, diamond chip = derived judgment, always timestamped.
- **Buttons**: one brass primary per view; secondary and ghost in ink. Press feedback
  (`active:scale-[0.97]`) retained — the instrument has travel.
- **Focus rings**: brass, both themes. Accessibility as brand.
- **Tables**: the existing DataTable density system is a brand asset; numerals mono and
  right-aligned; row tone washes only from market semantics.

---

## 9. Empty States

**"An empty state is a standing order."** Never a mood, never an apology, never a gray
illustration of a folder.

Pattern: an outline (unresolved) square glyph from the icon grammar + one sentence of
instruction in the interface voice + one action. The square resolves to a diamond when the
first real data arrives.

> Not: "No holdings yet 😕"
> But: **"The book is empty. Add your first position to bring the desk online."** [Add position]

---

## 10. Illustration & Imagery

**In-product: none.** The instrument does not decorate itself.

Marketing, docs, and social use one style: **the patent drawing.** Hairline technical
illustrations of UAA's actual machinery — the 9-agent pipeline as a labeled schematic, the
Convergence Point exploded into its four bars, the data layer's DAG — drawn in ink
hairlines on graphite with brass diamond nodes, annotated in mono like figures in a filing
("FIG. 3 — Verdict assembly").

**Visual don'ts:**

| Avoid | Reason |
|-------|--------|
| Stock photography | The machinery is the imagery |
| Gradient meshes, glow, glassmorphism | Trend-bound; violates the material story |
| 3D renders, mascots | Wrong register for an institution |
| Screenshots in tilted browser frames | Template marketing |
| Glossy gold at area scale | Reads crypto-luxe; brass is matte and rationed |

**AI image generation base prompt:** *"Technical patent-drawing illustration, fine ink
hairlines (1px) on deep graphite (#0a0b0e), small filled diamond nodes in matte brass
(#C8A96E), monospaced annotation labels, precise, engineered, no gradients, no glow, no
photorealism, flat archival finish."*

---

## 11. Data Visualization

**"Ink lines, brass points."**

- Series render in ink weights (foreground/muted/faint) by default — hierarchy through
  weight, not hue. Categorical hue (violet/steel/teal/pink/slate) only when >3 series
  demand it.
- Green/red exclusively for directional P&L meaning — never for "series A vs B."
- **The last point of any primary series is a diamond.** Decisive thresholds and crossings
  are diamonds. The current price is a brass diamond.
- Grid lines at hairline opacity; axes in 11px mono; tooltips are small ledgers (mono
  values, right-aligned).
- No gradient fills, no glow, no rounded "friendly" bars. The plot draw-in sweep (1500ms
  clip-path) is retained — data arrives, it doesn't bounce.

A UAA chart with all labels removed should still be attributable: graphite field, ink
line, one brass diamond at the terminus.

---

## 12. Voice & Writing

**Persona: the senior analyst who respects your time.**

### 12.1 Rules

1. **Verdict first, evidence after.** Every summary leads with the call, then shows the
   work. ("Trim. Concentration in semis is 2.4× your policy cap." — then the numbers.)
2. **Numbers are exact or absent.** "A full run typically takes a few minutes," never "blazing fast."
3. **Sentence case everywhere. No exclamation marks. No emoji. Ever.**
4. **The product reports; it doesn't perform.** No "Great job!", no "Oops!". Errors state
   what failed and the next action.
5. **Sovereignty is stated as fact, not marketing.** "Runs on your machine. Nothing leaves
   it." Full stop.

### 12.2 Lexicon (official brand vocabulary — already alive in the codebase)

*the book* (portfolio) · *the desk* (the workstation) · *the brief* (daily summary) ·
*the committee* (the user) · *the verdict* (a banded call) · *conviction* · *regime* ·
*the wire* (news/events) · *the record* (journal, exports, provenance) · *thesis* ·
*fit* · *signal*.

Features are named as departments of the user's institution, not as SaaS features.

### 12.3 Tone by context

| Context | Tone | Example |
|---------|------|---------|
| Verdicts | Declarative, then evidenced | "Hold. The price already carries the growth you're underwriting." |
| Errors | Factual, next-action | "AI is unavailable — add your Anthropic API key in Settings. Every computed figure is unaffected." |
| Empty states | Standing order | "The book is empty. Add your first position to bring the desk online." |
| Long tasks | Exact expectations | "Running the committee — typically a few minutes." |
| Marketing | Claims with mechanisms | "9 agents, run in parallel, on your hardware." |

### Prohibited Terms

| Avoid | Reason |
|-------|--------|
| "Blazing fast", "lightning" | Unquantified performance claims |
| "Seamless", "effortless" | Filler; the product is rigorous, not easy |
| "Revolutionary", "game-changing" | Overselling |
| "AI-powered" as a headline | The AI explains; the engines decide |
| "Beat the market" | UAA provides discipline, not predictions |
| Apologetic error copy ("Oops!", "Sorry!") | The instrument reports; it doesn't emote |

---

## 13. Surface Translations

- **Product**: the daily brief is the identity's hero moment — serif headline (the analyst
  speaks), mono figure strip (the ledger reports), one brass seal (the verdict), all under
  the desk lamp. Screener = ledger posture; IC report = memo posture with a seal on the
  cover block. Every long-running task uses the square→diamond resolution grammar.
- **Marketing site** (`/landing`): graphite field, serif memo-opener headlines ("Evidence
  in ink. Verdicts in brass." / "A financial institution with a staff of one."),
  patent-drawing figures of the real machinery, and every claim carrying a mono footnote
  citing the mechanism.
- **Presentations**: graphite slides; one serif statement per slide; evidence in mono
  tables; the brass diamond as the only bullet; patent drawings as the only imagery;
  footer: *Prepared by the committee of one.*
- **Social**: rigid tile system — graphite square, one serif sentence or one giant mono
  number, one brass diamond, hairline rule, mono attribution.
- **Exports**: PDF IC reports and Excel exports get the Record treatment — cover block
  with the brass seal (diamond + score + date + "of record"), serif body, mono exhibits,
  provenance footer.

---

## 14. Implementation Roadmap (post-Phase-0)

| Phase | Scope | Notes |
|-------|-------|-------|
| **0 — The Brand Book** | This document. No product changes. | ✅ Complete. Brass hues contrast-verified (§3, Accessibility). |
| **1 — The Materials** | Token swap in `app/globals.css`: brass in, sky-blue out; warning→orange (light theme must use #C2540A); steel blue into chart-2 (`app/_components/chart-theme.ts` uses literal hex — update both). | Whole app inherits via `--brand`. Atomic change; existing tests are the net. |
| **2 — The Voices** | Introduce the judgment serif (brief headline, IC narrative, verdict rationales, copilot prose); codify voice rules; copy sweep. | Serif never enters chrome or tables. |
| **3 — The Particles** | Diamond grammar system-wide (bullets, chart termini, steppers, checked states); ship the Verdict Seal component; empty-state pattern. | Seals only for genuinely banded score kinds. |
| **4 — The Record** | Export/PDF seal treatment; landing page in the new identity; patent-drawing figure library; presentation + social templates. | |

Each phase is independently shippable and independently reversible.

### Known deltas vs. the shipped product (as of Phase 0)

- `--brand` is still #38bdf8 / #0284c7 (sky blue) in `app/globals.css`.
- `--warning` is still amber #fbbf24 / #d97706.
- chart-2 is still orange #f97316.
- No judgment serif is loaded; all prose is Geist.
- Recommendation badges are rounded pills, not Verdict Seals.
- `app/_components/chart-theme.ts` carries literal hex copies of the above and must move
  in the same commit as the token swap.
- **`lib/brand/mark.ts` (`BRAND_COLORS`) is a second such file.** It holds literal hex
  copies of `--brand`/`--foreground`/`--background` for the three contexts that cannot
  read CSS custom properties: the generated favicon + app icons
  (`npm run brand:assets` → `app/favicon.ico`, `app/icon.svg`, `app/apple-icon.png`,
  `public/brand/*`), `app/manifest.ts`'s theme colours, and the PDF exports
  (`lib/brand/pdf.ts` → IC Report + Portfolio). Swap it and re-run
  `npm run brand:assets` in the same commit, or the app goes brass while the browser
  tab, the installed-app icon and every exported PDF stay sky-blue. Everything else
  (all in-app rendering of the mark) resolves `var(--brand)` at paint time and needs
  no change.

---

## 15. Governance

- This file is the source of truth. `app/globals.css` implements it; where they disagree
  during rollout, this file wins for new work and §14 tracks the gap.
- Any new hue, typeface, shape, or component pattern must be justified against §1.3's five
  principles before it enters the product.
- The three one-sentence laws every contributor (human or agent) must know:
  1. **Color is earned by judgment.**
  2. **No circles. A diamond is a decision.**
  3. **Serif is opinion; mono is arithmetic.**

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-07-31 | Initial brand book: The Instrument of Record. Identity approved; no product implementation. Brass palette contrast-verified in both themes. |
