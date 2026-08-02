# EYE-EASE — A Ground-Up Concept for UAA

**Status**: Creative exploration. Not an implementation plan. Nothing here is committed.
**Date**: 2026-08-02
**Supersedes nothing; ignores everything.** This concept deliberately does not reference the
current UI, the abandoned terminal redesign, or any prior exploration.

---

## 0. The One Idea

Every piece of investment software ever built is organized around **data**: quotes,
charts, tables, feeds. But an investor's actual work product is not data. It is a set
of **arguments** — evolving beliefs about assets, backed by evidence, tested against
price, and revised when the facts change.

If investment software had never existed, and you designed it today for a thinking
investor with a local AI, you would not build a dashboard. You would build a
**workbench for arguments**, and you would enforce — structurally, visually, in the
bones of every screen — the one distinction that all of finance journalism, sell-side
research, and Twitter fail at:

> **Facts and judgments are different substances and must never look alike.**

That is the entire concept. Everything below is that sentence, executed.

Every surface in UAA is split by a visible seam into an **evidence side** (facts:
prices, filings, ratios, events — things that are *true or false*) and a **judgment
side** (scores, recommendations, AI synthesis, your notes — things that are *good or
bad arguments*). They use different inks, different typefaces, different textures of
attention. A screenshot of UAA with the logo removed is recognizable the way a page
of double-entry bookkeeping is recognizable: not by decoration, but by **discipline
made visible**.

The design language is called **Eye-Ease**, after the pale green "eye-ease" ledger
paper that accountants' suppliers engineered in the early 20th century specifically
to reduce fatigue during long hours of numerical work. That paper is the only
physical material with a legitimate, functional, century-old claim on this exact
job — staring at columns of figures for hours — and no software product has ever
touched it. It is ours for the taking.

---

## 1. Research Notes — Principles Extracted, Appearances Refused

Before designing, I studied craft outside finance. What I took (and what I refused):

| Source | Principle extracted | Appearance refused |
|---|---|---|
| **Meteorological station models** (the glyph clusters on weather maps encoding wind, pressure, temp, cloud cover in ~20px) | Many variables can live in one learnable mark if the notation is *fixed and taught* | Not copying the actual glyph shapes |
| **Double-entry bookkeeping** | Trust comes from structural discipline (every entry has a counterpart), not from claims of accuracy | No skeuomorphic paper texture, no torn edges, no "vintage" pastiche |
| **Transit maps (Beck)** | Fixed geography is learnable; physics-wobble is not. Distortion in service of topology beats fidelity | Not literally drawing tube lines |
| **Aviation flight-progress strips** | Physical persistence of "what am I tracking" beats any notification system | No cosplay of ATC towers |
| **Legal case files / medical charts** | The record of *how a conclusion was reached* is as valuable as the conclusion | No manila-folder skeuomorphism |
| **Marginalia in working libraries** (Fermat, Darwin's notebooks) | Annotation belongs *in the margin, anchored to the datum*, not in a separate notes app | No handwriting fonts |
| **Field guides / Peterson identification plates** | Comparison works when specimens share rulers — aligned axes, aligned scales | Not drawing birds |
| **The HP-12C calculator** | A tool can be beloved for 40 years because its grammar never changes and it never wastes a keystroke | No RPN jokes |

The defaults I explicitly refused because they are what generated design regresses to:
warm-cream + high-contrast serif + terracotta; near-black + one acid accent;
hairline-rule broadsheet columns; left sidebar + topbar; rounded floating cards;
Cmd-K launcher chrome; chat panes; "Thinking…" spinners.

---

## 2. The Identity System

### 2.1 Material: the Sheet

The base surface is not white, not cream, not dark. It is **eye-ease green** — the
pale, cool, slightly desaturated green of working ledger stock. It reads as neither
"light mode" nor a brand color. It reads as *a material you work on*. Crucially, it is
expressed only through color, ruling, and typographic behavior — **zero texture, zero
noise, zero skeuomorphism**. The material is an idea, not a JPEG.

**Palette (day sheet):**

| Token | Hex | Role |
|---|---|---|
| `sheet` | `#E7ECE3` | Base surface. The paper. |
| `rule` | `#C9D2C4` | Rulings, seams, structure. Never darker than this — structure whispers. |
| `ink` | `#1B1D1A` | Fact ink. All evidence, all data, near-black with a green cast. |
| `annot` | `#2F4358` | Judgment ink. Iron-gall blue-black — the traditional annotation ink. All scores, AI text, your notes, recommendations. |
| `loss` | `#A02C2C` | Dried red ink. **The only warm color in the product**, reserved exclusively for negative numbers, drawdowns, and breached limits. |
| `stale` | `#8A9184` | Faded ink. Data past its freshness TTL. |

**Palette (after-hours sheet)** — a manual toggle, defaulting to follow local evening,
because research runs long: `sheet #101511`, `rule #22301F`, `ink #D9DED4`,
`annot #8FA8C4`, `loss #C25E5E`, `stale #5B6357`. Same relationships, same discipline.

**The boldest single decision: gains are not green.** In bookkeeping, black ink *is*
the good outcome; red ink is the only alarm. UAA adopts this completely. Positive
returns are set in fact ink with an explicit `+`; negative returns are the only
colored numbers on the sheet. This does three things:

1. It kills the christmas-tree effect of every finance UI on earth. A page of UAA is
   calm even when the market is not.
2. It makes red *mean something again*. When you see red, something is actually wrong.
3. It is instantly identifying. No other product dares it. A table screenshot where
   only losses carry color is a fingerprint.

### 2.2 Rulings

The sheet is ruled. A faint horizontal baseline grid (`rule` color, 1px, at the text
baseline rhythm — 22px in dense regions, 28px in prose regions) is *visible* wherever
tabular data sits, exactly like ledger paper. Rulings are not decoration: every data
row sits *on* a rule, which is what lets density go far beyond normal web-app comfort
while remaining scannable. Prose (judgment text) sits on unruled ground — another
subliminal cue for which substance you're reading.

Vertical structure is carried by **seams**: single 1px rules with a 2px offset gap
(a "double-rule" — the bookkeeping mark for a column boundary). The most important
seam in the product is **the Spine Seam**: the vertical double-rule dividing evidence
from judgment on every folio. It is always in the same relative position (golden-ish,
~62% from left in wide layouts). Users will come to feel it the way a pianist feels
middle C.

### 2.3 Typography

Two families total. Discipline over variety; performance over fashion.

| Role | Face | Why |
|---|---|---|
| **Fact ink** — all data, tables, labels, tickmarks, the call line | **"UAA Figures"** — long-term, a commissioned duplexed tabular grotesk (the Bloomberg move: own your numerals). Interim: *Spline Sans Mono* with tabular figures, slashed zero, and sign-width parity (`+`/`−` occupy identical advance widths so columns never shiver). | Numbers are the product. They deserve a face where `0/O`, `1/l` cannot be confused, where a value flipping sign doesn't reflow a column, and where medium-weight emphasis doesn't change metrics (duplexing). |
| **Judgment ink** — AI synthesis, your notes, recommendations, all prose | **Charter** (Bitstream, 1987) | Designed by Matthew Carter *for low-resolution rendering of long text* — a screen-first serif before screens deserved one. Sturdy, deeply unfashionable in exactly the right way, has real italics for epistemic shading ("we *believe*"), ships on macOS so the body face costs **zero bytes**. Performance as a brand decision. |

No display face. Folio titles are Charter small-caps at modest size. The landing page
gets one large Charter italic. The absence of a "hero font" is itself a statement:
this product does not perform for you.

**Type scale**: figures at 12.5/22 in dense regions, 14/22 standard; prose at 15/26.
Micro-labels (marginalia, provenance) at 10.5 tracked small-caps of the figures face.
Nothing below 10.5px, ever.

### 2.4 The Tickmark — a proprietary notation

Next to every symbol, everywhere in the product — tables, prose, the Trail, the
Atlas, tooltips — sits a **tickmark**: a fixed ~22×14px glyph, drawn live, encoding
the four things an investor needs before deciding whether a name deserves attention:

```
      flag (stance)
       ▸
   ▁▂▄█ ← stem: composite score as fill height,
   ┊      notched at recommendation-band boundaries
   ┊
   tip fade = data freshness      baseline tick = trend
                                  (up-slash / flat / down-slash, 30d)
```

- **Stem fill** = composite score (0–100), with tiny notches at the band boundaries
  from `lib/recommendation.ts` — so "how far into Buy territory" is visible, not just
  the label.
- **Flag** on the stem: right-facing = held in Book (portfolio); left-facing =
  watched; filled flag = an active thesis exists in the Journal. No flag = never
  researched. Your *relationship* to the name, at a glance.
- **Baseline tick**: a short slash under the stem — rising / flat / falling 30-day
  trend.
- **Tip fade**: the stem's top pixel-rows fade toward `stale` as the underlying
  score's inputs age. A fresh mark is crisp; a week-old mark visibly wants refreshing.

This is the station-model idea: a dense, fixed, *taught* notation. Hovering any
tickmark, always, shows the legend with this symbol's actual values — the notation
teaches itself forever, so it never gates new users. After a week you stop reading
labels; you read marks. After a month, a screenshot of anything — a table, a
paragraph mentioning `NVDA ⌶` — is unmistakably UAA, because no one else has a
notation at all.

### 2.5 Voice

Fact ink states; judgment ink argues; nothing performs. No exclamation points. No
"insights." No "🎉 Portfolio updated!". Errors name what happened and the next
action ("EDGAR did not respond. Filings omitted; everything else is current.").
Empty states are ruled blank paper plus one line of direction — an empty ledger *is*
the invitation. AI absence follows the availability copy in `lib/ai/availability.ts`
and names the hosted path; the sheet never begs you to start a daemon.

---

## 3. The Structural Model — No Nav Bar, No Sidebar, No Cards

The product is a **Workbook** of six **Folios**. There is no persistent top bar and
no sidebar. Chrome is replaced by four permanent edge instruments, each borrowed
from a physical tool, none from software:

```
┌─────────────────────────────────────────────────────┬─┐
│ m │                                        ┊        │T│ ← Thumb Index
│ a │         EVIDENCE                       ┊ JUDG-  │O│   (right edge,
│ r │         (fact ink, ruled)              ┊ MENT   │D│    notched)
│ g │                                        ┊ (blue- │F│
│ i │                                        ┊ black, │D│
│ n │                                        ┊ prose) │B│
│   │                                   Spine Seam    │A│
├───┴────────────────────────────────────────┴────────┴─┤
│  ● ─ ● ─ ▪ ─ ● ─ ◆ ─ ●          the Trail             │ ← bottom edge
└────────────────────────────────────────────────────────┘
```

### 3.1 The Thumb Index (navigation)

A physical dictionary has notched thumb-tabs cut into its page edge. UAA's right
edge carries six **notches** — small cut-ins with rotated small-cap labels — one per
folio: **Today · Field · Dossier · Bench · Book · Atlas**. The active notch is cut
deeper (the content sheet visibly tucks under it). Notches subtly vary in ink
density by how much *your* recent work lives there — the index wears in like a used
book's.

Why the right edge: reading is left-anchored; navigation is a departure, and
departures belong at the far edge of the reading direction. Why not a sidebar: a
sidebar claims a permanent column of your widest dimension to answer a question
("where can I go?") you ask twenty times a day, versus the thousands of times you
ask "what does the data say?" The index is ~28px of edge.

- **Hover** a notch: it eases out 2px and shows a one-line status of that folio in
  the margin tongue — Book: "11 positions · day P&L −0.8% · 2 alerts"; Field:
  "census: 248 names, 3 filters held". Navigation previews *state*, not just place.
- **Click / `g` then `t·f·d·b·k·a`** (or `1–6`): go. The transition is a **sheet
  turn**: outgoing content departs 8px left with a 90ms fade as the incoming sheet
  settles under the deeper notch cut. One motion, 120ms total, transform/opacity
  only, honoring `prefers-reduced-motion` by cutting instantly.

### 3.2 The Trail (session memory as an instrument)

Along the bottom edge runs a thin filmstrip: the **Trail**. Every meaningful act
drops a tick on it, left to right, in real session time:

- ● a folio/dossier visited (with exact scroll + filter state captured)
- ▪ a judgment made (watched, pinned, annotated, journaled, threshold set)
- ◆ an AI synthesis you requested

Hovering a tick shows a micro-summary ("Dossier: TSM — peeked gross-margin
provenance, annotated"). Clicking returns you to that exact state — not the page,
the *state*. `[` and `]` walk the trail. This is browser history rebuilt as a
research instrument: the answer to "how did I get to this conclusion?"

At session end (or via `J`), the Trail can be **committed to the Journal** as a
session record: the decision you logged, and the exact path of evidence that
preceded it. Decisions gain provenance automatically. Six months later, "why did I
buy this?" has a replayable answer. No product has this; it becomes a signature the
way Git's log is a signature.

The Trail persists across sessions (last session's trail loads dimmed at the far
left; "Since you left" on Today references it). It is capped visually — old ticks
compress into a density strip, like a book's read pages seen edge-on.

### 3.3 The Call Line (search, command, and query — without a palette)

There is no Cmd-K palette floating in a rounded modal. Press `/` anywhere and the
**call line** appears: the *top rule of the sheet itself* becomes writable — one
ruled line, cursor blinking on it, exactly like beginning an entry in a ledger. You
write in a small grammar, plain enough to guess:

- `TSM` → opens the Dossier for TSM (symbol resolution with tickmark preview inline
  as you type — the candidates listed *on the next few rules*, not in a dropdown card)
- `TSM v NVDA v AVGO` → opens the Bench with all three pinned
- `field: fcf yield > 6, mcap > 10b` → opens the Field with those bounds sculpted
- `note: trimming rationale…` → appends to the Journal, timestamped, from anywhere
- `due` → jumps to Today's Due column (calendar)

Esc dismisses; the rule heals. The call line is a *line*, not a window — it belongs
to the sheet. Autocomplete appears as ghost text in fact ink on the same rule.

### 3.4 The Margin (provenance rail)

Every folio keeps a narrow left margin (~64px). It is not empty aesthetics — it is
the **provenance rail**, carrying, aligned to the rows they describe:

- **Freshness marks**: a small `∴` beside any row whose data is past TTL; hover for
  fetched-at timestamp and source; click to refresh that datum in place.
- **Annotation anchors**: your marginal notes (see §5.4) show as short blue-black
  underlines in the margin; hover to read, click to edit.
- **Agent cross-references** (Dossier): when two IC agents disagree, a thin tie-line
  connects their sections through the margin (see §4.3).
- **Margin math** (see §5.3) results render here.

The margin is why the content column can stay dense: all meta-information about
data lives *beside* the data, never inline diluting it.

---

## 4. The Six Folios

The six folios are the six stages of how research actually proceeds: orient →
discover → investigate → compare → decide/hold → relate. Existing modules are not
deleted — they are re-homed into the stage where their work is actually done.

---

### 4.1 TODAY — the desk sheet (orient)

*Absorbs: home dashboard, Daily Pulse, Wire/scanner headlines, calendar, regime,
"since you left".*

The question this folio answers: **"What changed, and does any of it touch my
book or my theses?"** Not "what is the market doing" in the abstract — the market
filtered through *your* standing commitments.

**Layout** (the fact|judgment duplex at full width):

```
┌─ margin ─┬──────────── EVIDENCE ─────────────────┊─── JUDGMENT ────┬─idx─┐
│          │ SINCE YOU LEFT (Fri 16:02 → now)      ┊ THE BRIEF       │     │
│ ∴        │  regime line · index moves · your     ┊ 5–8 sentences   │     │
│          │  positions' overnight deltas, one     ┊ of blue-black   │     │
│          │  ruled row each, tickmarks inline     ┊ synthesis: what │     │
│          ├───────────────────────────────────────┊ matters, what   │     │
│          │ THE WIRE                              ┊ can wait, which │     │
│ (fresh-  │  headlines as ruled rows: time ·      ┊ thesis is       │     │
│  ness    │  source · headline · affected         ┊ touched. Every  │     │
│  marks)  │  symbols w/ tickmarks. Rows that      ┊ claim carries a │     │
│          │  touch your Book/theses carry a       ┊ peekable source.│     │
│          │  filled margin dot.                   ┊─────────────────│     │
│          ├───────────────────────────────────────┊ DUE             │     │
│          │ SECTOR STRIP (11 GICS cells, one row: ┊ next 10 days:   │     │
│          │  rel-strength spark + rank, RRG state ┊ earnings, ex-   │     │
│          │  as a two-letter code)                ┊ div, filings —  │     │
│          │                                       ┊ *your names     │     │
│          │                                       ┊  first*, rest   │     │
│          │                                       ┊  collapsed      │     │
└──────────┴───────────────────────────────────────┊─────────────────┴─────┘
```

**Why this arrangement**: evidence (what happened) is the wide column because it is
what you scan; judgment (what it means) is the narrow column because synthesis is
short or it is bad. "Since you left" is first because cross-session continuity is
the single highest-value thing a research tool can offer a human with a life. The
Due list lives on the judgment side because a calendar is a claim on your future
attention — a judgment about what will matter.

**Interactions:**

- **Hover a wire row** → the margin shows which of your theses it touches ("touches:
  TSM thesis ¶3 — capex assumption") — computed from journal/thesis text matching.
  This is the hover that earns its keep: news is triaged *against your own beliefs*.
- **Hover a sector cell** → the cell expands in place by one rule-height showing its
  top 3 movers with tickmarks. Click → Atlas, zoomed to that sector's district.
- **`.` (peek) on any Brief sentence** → the underlay (see §5.1) shows the evidence
  rows and sources that sentence was synthesized from.
- **`w`/`p`/`;` on any hovered symbol** anywhere on the folio: watch / pin to Bench
  / annotate. Symbols are first-class targets everywhere; you never leave to act.
- The Brief regenerates only on request (`r` on the Brief) or when Since-You-Left
  spans > 4h; it is never spinning when you arrive. While generating, it writes
  settled sentences (see §5.6); the margin lists sources being consulted.

**Animation**: numbers that tick during market hours don't flash green/red. A value
that changes gets a 200ms **rule-sweep** — the baseline rule under it briefly
darkens and settles, like fresh ink drying on the line. Calm, directional
information carried by the sign and the tickmark, not by blinking.

---

### 4.2 THE FIELD — census, not screener (discover)

*Absorbs: screener, event scanner signals, opportunity map, thematic discovery.*

The question: **"Across everything, where should attention go next?"**

Every screener ever built is a form (filters) bolted to a table (results), and the
form is the interface while the table is dead output. The Field inverts this:
**the filters are the data**. The folio opens with the *census* — the full
universe (S&P 500, Russell, NSE, crypto — chosen on the folio's first rule) — and a
band of **distribution strips**, one per active metric, forming the table's living
header:

```
┌─ margin ┬──────────────────────────────────────────────┊──────────────┬─idx─┐
│         │ universe: S&P 500 · census 503 → 41          ┊  READINGS    │     │
│         │┌ fcf yield ┐┌ rev cagr ┐┌ momentum ┐┌ pe ┐   ┊  blue-black  │     │
│         ││▂▄▇█▆▃▁    ││ ▁▃▆█▅▂   ││ ▂▃▅█▇▄   ││▆█▄▂│   ┊  notes on    │     │
│         ││  [◀──▶]   ││   [◀──▶] ││          ││    │   ┊  the living  │     │
│         │└───────────┘└──────────┘└──────────┘└────┘   ┊  selection:  │     │
│         │  ← each strip: histogram of the whole        ┊  “41 names.  │     │
│         │    universe; drag directly on it to bound;   ┊  Quality is  │     │
│         │    survivors stay ink, excluded fade to      ┊  cheapening  │     │
│         │    stale *within the strip*                  ┊  in semis…”  │     │
│         ├──────────────────────────────────────────────┊  + saved     │     │
│         │ THE RESIDUE (survivors), ruled rows:         ┊  sculptures  │     │
│         │  ⌶ TSM   94 ▲  fcf 7.2  cagr 18  pe 21 …     ┊  as named    │     │
│         │  ⌶ AVGO  91 ▲  …                             ┊  lines       │     │
└─────────┴──────────────────────────────────────────────┊──────────────┴─────┘
```

**Sculpting**: you filter by dragging bounds directly on a distribution. The census
count (`503 → 41`) runs as a live counter; excluded rows in the residue fade to
stale ink and *settle out downward* (one 240ms translate, then removed — you see
what you excluded, which matters, because good screening is knowing what you threw
away). Every strip always shows the *whole universe's* shape with your kept-range
in ink — so you always see where your bounds sit relative to reality. No form. No
"Apply" button. The interface *is* the statistics.

**Why**: an investor screening isn't executing a query; they're *learning the
shape of the market* and carving at it. Distribution-first filtering means every
filter teaches you the base rate before you cut. This kills the classic screener
failure ("pe < 15" — is that strict? for this universe? this year?).

**Interactions:**

- **Add a metric**: `+` or click the empty strip slot; type on the ruled line
  (call-line grammar). The strip draws in 150ms, left to right, like a plotter.
- **Hover a residue row** → the row's values *light up as dots inside every strip*
  above — you see one company against every distribution simultaneously. This
  hover is a signature moment: nobody has it, and it answers the real question
  ("is this name cheap because everything is, or cheap specifically?").
- **Hover a strip** → margin shows quartiles, your bounds as numbers, and how many
  names each bound excludes on its own.
- **Signals as a strip**: event-screener output (earnings surprise, insider buys,
  breakouts) appears as a categorical strip — cells per signal type with counts;
  clicking a cell bounds the census to names carrying that signal. Events become
  just another dimension to sculpt on, not a separate page.
- **Themes as lenses**: the thematic engine's supply-chain/theme memberships are a
  strip too ("theme: HBM memory · 14 names"). One mental model for all discovery.
- **Sort** by clicking a column label on the residue's header rule; `s` cycles.
- **`p`** pins hovered rows to the Bench (up to 6; a small tray count shows on the
  Bench notch). **`↵`** opens the Dossier. **`v`** on 2+ selected rows → Bench.
- **Saved sculptures**: a named set of bounds ("quality compounders, expensive-ok")
  saved as a single line on the judgment side; clicking replays the sculpting —
  strips animate their bounds into place in 300ms, residue resolves. Rerunning a
  saved screen *shows you what changed* since last run: names newly entering the
  residue carry a margin `＋`, departures are listed struck-through for one viewing.

**The judgment column ("Readings")** is where AI earns a place in discovery: on
request (`r`), it writes 3–5 sentences characterizing the current residue — sector
tilts, common factors, what the sculpture is implicitly betting on ("your bounds
select for high asset-turnover businesses; 60% of survivors report within 3
weeks"). Peekable to the underlying stats, like every judgment in the product.

---

### 4.3 THE DOSSIER — the case file (investigate)

*Absorbs: research page, stocks/[symbol], IC report, valuation/DCF, filings, news,
per-symbol timeline, movement explainer.*

The question: **"What is true about this business, and what do I believe about it?"**

One symbol, one continuous vertical case file — not tabs. Tabs hide; a case file
accumulates. The Spine Seam runs the folio's full height: evidence left, judgment
right, *in permanent registration* — each judgment sits level with the evidence it
interprets. Scrolling is synchronized by section, not pixel (the shorter column
rests until its section's partner catches up — a 1px tie-line across the seam marks
the registration point).

**The file's sections, top to bottom** (order = the order a diligent analyst
actually works):

1. **Identification plate.** Symbol, tickmark (large, 40px — the one place it's
   displayed at teaching size, permanently labeled), name, exchange, sector, your
   stance and holding line if any. One ruled row of the vitals: price, day move,
   range position, market cap, ADV. To its right on the judgment side: **the
   standing thesis** — your current thesis paragraph from the Journal, always
   visible at the top of the case. If none exists: ruled blank lines and "No thesis
   on file. `;` to begin one." The product's deepest opinion, stated structurally:
   *research without a thesis is browsing.*

2. **Price & regime.** The chart is a **section-cut, not a poster**: a wide, short
   (~180px) price band in fact ink, 1px line, no gradient fill, no glow. Below it,
   three aligned 24px lanes: volume, regime posterior (HMM state as a shaded band),
   and drawdown-from-high. Your journal entries and timeline events for this symbol
   are **notched on the time axis itself** — tiny blue-black flags on the ruling.
   Hover a flag: the margin shows the entry ("2026-03-14 — added on capex fear
   overreaction"). *Your history with the name is part of the chart* — the chart
   answers "what happened" and "what did I think while it happened" in one glance.
   - Hover anywhere on the band: a hairline follows with values reading out in the
     margin (not a floating tooltip card — read-outs belong in the margin).
   - Drag horizontally: period stats (return, high/low, vol) compute in the margin
     — margin math (§5.3) applied to time.
   - `e` on any point: the Movement Explainer writes its explanation *level with
     that date* on the judgment side, with peekable sources.

3. **The record** (fundamentals). The dense heart: a ruled table of ~40 line items
   × 8 periods (annual/quarterly toggled with `q`). Real density, unapologetic —
   this is the eye-ease paper doing its job. Units declared per metric (never
   inferred from magnitude). Row hover: the row's 8 periods draw as a spark
   *in the margin*. YoY deltas render as small superior figures after each value,
   in stale ink, so levels and changes are both present without doubling the table.
   On the judgment side, level with this section: the **quality reading** — the
   composite score decomposed (value/quality/momentum stems side by side, each
   peekable to its formula terms and inputs — the full `computeScore` provenance).

4. **The examination** (IC agents). The 9-domain pipeline, recast: not a "report"
   below a button, but a **panel of examiners writing into the judgment column**,
   each under a small-cap heading (BUSINESS · INDUSTRY · COMPETITION · MANAGEMENT ·
   CAPITAL ALLOCATION · ACCOUNTING · VALUATION · GOVERNANCE · RISK). Level with
   each, on the evidence side, sit the raw materials that agent consumed: filing
   excerpts, ratios, transcript lines — so the seam literally separates what the
   agent read from what it concluded. Each examiner's margin carries a confidence
   mark (a stem-fill, same notation family as the tickmark) and its stated data
   limitations in stale ink.
   - **Disagreement is made visible**: when two examiners conflict (valuation says
     rich, momentum-informed risk says accumulating), a thin tie-line connects
     their margin marks through the provenance rail, with a one-line statement of
     the tension at the lower of the two. Disagreement between models is *the most
     valuable output an ensemble has*, and every other product averages it away.
   - Agents stream as settled sentences (§5.6), each section filling as its agent
     completes — the file visibly being written by a panel, without one spinner.

5. **The workings** (valuation). The DCF as a **worksheet, not a widget**: the
   arithmetic laid out line by line in fact ink — revenue build, margin bridge,
   FCF, discounting — with the *assumptions as the only editable figures*,
   underlined in blue-black (assumptions are judgments; the layout says so).
   Editing an assumption recomputes the sheet downward in one pass with rule-sweeps
   marking changed lines. The sensitivity grid is a ruled matrix whose cell under
   the current assumption pair carries a small ● — you always see where you *are*
   in the sensitivity space. Judgment side: implied-vs-market gap, and the AI's
   brief reading of which assumption the thesis most depends on (peekable).

6. **The paper trail.** Filings (EDGAR), news, and the symbol's timeline merged
   into one reverse-chronological ruled list on the evidence side, classified by
   the 28-category event taxonomy, each row: date · type-code · one line · source.
   Judgment side, level: **thesis evolution** — how your journal stance moved
   through these events ("held through the March guide-down; added").
   - `.` on any filing row: the underlay shows the relevant excerpt, not the whole
     filing; from the underlay, `↵` opens the full document.

**Dossier-specific keys**: `q` period toggle · `x` run/refresh examination · `e`
explain movement at cursor · `$` jump to workings · `t` jump to paper trail · `;`
annotate anything · `p` pin to Bench · `w` watch · `↵` on any symbol mentioned in
text opens *its* dossier (and drops a Trail tick, so cross-company digressions are
always recoverable).

**Why this folio wins**: every research tool splits "data about the company" from
"analysis of the company" into different pages or panes, destroying registration.
The Dossier's single scroll with a full-height seam means *you can always see the
evidence for the judgment you are reading, level with it.* That's the product's
one idea, at its fullest expression.

---

### 4.4 THE BENCH — the specimen tray (compare)

*Absorbs: compare.*

The question: **"Which of these, and what am I giving up?"**

Comparison UIs fail by juxtaposing *cards* — each asset formatted independently, so
your eyes do the alignment work. The Bench is a **specimen tray**: up to 6 pinned
assets laid on **shared rulers**. Every metric is one *row spanning all specimens*,
with a common scale drawn once in the margin — so magnitude comparisons are done by
the ruler, not by your working memory:

```
┌ margin(ruler) ┬─ TSM ──┬─ NVDA ─┬─ AVGO ─┬─ AMD ──┊─ VERDICT ──┬idx┐
│ score 0──100  │  ⌶ 94  │  ⌶ 88  │  ⌶ 91  │  ⌶ 76  ┊ blue-black │   │
│ fcf% 0───12   │  ●7.2  │ ●3.1   │  ●6.0  │ ●2.2   ┊ reading of │   │
│               │  ← values plotted as dots ON the  ┊ the tray,  │   │
│               │    shared scale line, value       ┊ trade-offs │   │
│               │    printed beside each dot        ┊ stated as  │   │
│ 5y price      │  one chart, all specimens,        ┊ sentences  │   │
│  (rebased)    │  rebased to 100, same axis        ┊ w/ peeks   │   │
└───────────────┴────────────────────────────────────┊────────────┴───┘
```

- Rows are grouped by concern (quality / growth / valuation / momentum / risk),
  group labels in the margin. All 14+ metrics present; density is the point.
- **The Delta Lens** — hold `d`: every row where specimens are within noise of
  each other fades to stale; only *meaningful divergences* stay in ink, and the
  largest divergence per group gets a margin ▸. Release to restore. Comparison
  is subtraction; the lens performs the subtraction for you. This is the folio's
  signature interaction and it exists nowhere else.
- **Hover a specimen column** → its dots enlarge across all rulers simultaneously;
  its tickmark values print in the margin.
- **Reorder** specimens by dragging column headers (150ms slide); **`x`** over a
  column removes it; pins persist across sessions until removed.
- **Charts share axes always** — rebased price, drawdown bands overlaid, not
  side-by-side minis.
- The **Verdict** column writes on request: the trade-offs as prose ("AVGO gives
  up 4 points of growth for 3 points of yield and materially lower customer
  concentration"), each clause peekable to the rows it summarizes.
- From the Field, `p p p` then `4` (Bench) is the entire flow from census to
  comparison. Three keys, no forms.

---

### 4.5 THE BOOK — positions, watch, and the written record (decide & hold)

*Absorbs: portfolio, watchlist, journal, decision engine, stress tests, alerts.*

The question: **"What do I hold, why, and is any 'why' now wrong?"**

The Book is a true ledger — three registers on one folio, because they are one
lifecycle (watch → hold → record), not three apps:

1. **Holdings register.** Ruled rows: tickmark · symbol · qty · basis · price ·
   day · **running balance column** (portfolio value as a bookkeeping running
   balance — the column that makes it read as a ledger, not a table) · weight ·
   fit. Losses in red ink; everything else black. Aggregate lines (day P&L, total,
   exposure by sector as a one-row strip) sit at the bottom above a double rule —
   where a ledger's totals live, under the entries, not in a hero banner. **No
   giant "Portfolio Value" number at the top.** The number you check compulsively
   is deliberately placed where the *composition* must be scanned on the way — a
   quiet behavioral nudge toward reading your book, not your score.
2. **Watch register.** Same ruled grammar, plus each row carries its *watch
   reason* (from watchlist intelligence: "watching for < 20× on pullback") — and
   when the reason's condition is met, the row gains a filled margin dot and
   surfaces on Today. A watchlist where every entry states *why it exists*; stale
   watches (no reason, no activity, 90d) visibly fade, inviting pruning.
3. **The written record (Journal).** Chronological entries in judgment ink:
   decisions, theses, session commits from the Trail. Each entry shows its
   evidence trail inline (the ◆● ticks, clickable, replaying the states that
   preceded the decision). Entries that reference symbols carry live tickmarks —
   so reading an old thesis, you see its subject's *current* state beside your
   past reasoning. The uncomfortable, honest juxtaposition that makes you better.

**Judgment column, level with the registers**: the Decision Engine's queue —
trim/add/replace recommendations, each stating its evidence (rotation rank,
concentration, PEG) as peekable clauses; the stress panel — scenarios as ruled
what-if lines ("Tech −25% → book −26.2%", red ink where earned), with the custom
scenario built on a call-line ("what if energy −15"); and the CIO memo on request,
written as settled prose.

- **Hover a holding** → margin shows its thesis's *age* and last confirmation
  ("thesis 142d old; last reaffirmed 38d ago") — quietly the most confronting
  hover in the product, and the most valuable.
- **`;` on a holding** → journal entry pre-anchored to that position.
- **Sector strip on the register footer**: hover a sector cell → the holdings in
  it highlight; the rotation rank prints in the margin ("Technology: rank 11/11,
  lagging — 34% of book").

---

### 4.6 THE ATLAS — fixed geography for relationships (relate)

*Absorbs: knowledge graph, sector rotation, macro dashboard, thematic maps.*

The question: **"What is this connected to, and what moves together?"**

Force-directed graphs are the astrology of data visualization: they look profound,
wobble differently every time, and teach nothing twice. The Atlas replaces physics
with **fixed geography**: the 11 GICS sectors are permanent **districts** in a
fixed tessellation (same positions forever — learnable like a city). Within
districts, companies are placed by stable coordinates (size → radial position;
sub-industry → block). Theme and supply-chain relations draw as **routes** —
orthogonal transit-style lines through districts (HBM memory line; India-capex
line), each a color-coded route *in ink weights, not rainbow* (line identity by
label and dash pattern, honoring the no-color-carnival rule).

- **Rotation as weather**: each district's ground tints by relative-strength rank
  (deeper eye-ease green = leading, paling to stale = lagging) — the RRG data as
  *climate on the map*, re-read every day at a glance because the geography never
  moves under it.
- Your Book and watchlist names carry their tickmark flags on the map — your
  exposure is *visible as settlement patterns* ("everything I own is in two
  districts" is a realization the holdings table hides and a map makes physical).
- **Hover a route** → the names on it list in the margin, in route order (supply
  chain order — upstream to downstream); the route's aggregate 30d move prints.
- **Hover a company** → its connections light; everything else dims to stale;
  margin shows the strongest three edges with their kinds (supplier / customer /
  theme / correlates).
- **`.` on an edge** → peek: *why* is this edge here (the filing line, the theme
  membership, the correlation window — provenance for relationships).
- **Click a district** → zoom (200ms transform); the district's census stats print
  in the margin; `f` from here opens the Field pre-sculpted to the district.
- Timeline events (market-wide) can be scrubbed under the map with `←/→`: routes
  and districts that an event touched pulse once per step — replaying a quarter's
  narrative as geography, not as a feed.

---

## 5. Cross-Cutting Instruments (the interactions that make it UAA everywhere)

### 5.1 The Peek (`.` or hold-Space) — provenance as a physical act

On any judgment — a score, a recommendation label, an AI sentence, a Verdict
clause, an Atlas edge — press `.`: the judgment **peels back** (a 120ms fold of
the local region, transform-only) revealing the **underlay**: the exact evidence
beneath it. For a score: the formula terms with their input values and weights.
For an AI sentence: the source rows/excerpts it was synthesized from. For an edge:
the document line that asserts the relation. Release/Esc: it heals.

The underlay is rendered *in the judgment's own footprint* — not a popover, not a
modal, not a side panel. Lifting a stencil to see the sheet beneath. This is the
product's epistemology as a gesture: **no judgment in UAA is more than one
keypress from its evidence.** It also disciplines the system itself — anything
that can't produce an underlay doesn't ship.

### 5.2 Freshness ink — time as visible material

Every fetched value knows its age. Within TTL: full ink. Past TTL: it fades to
`stale` and gains the margin `∴`. Hover: source + fetched-at. Click the `∴`:
refresh in place (the value rewrites with a rule-sweep). The entire product's
data-trust model — 24h fundamentals, always-fresh prices, daily parquet — becomes
*visible physics* instead of a doc page. You can glance at any sheet and know
what to trust, which is a capability no amount of "last updated" footers provides.

### 5.3 Margin math — the sheet computes

Drag vertically in any margin beside numeric rows: the spanned values compute —
sum, mean, median, spread — printed in the margin at the selection's foot, in
fact ink. Works on the record's line items, holdings, the residue, period stats
on charts. It's what paper always wished it could do; it makes the sheet feel
*alive under the hand* without a single decorative animation. Selection persists
until dismissed, so you can compare two margin-sums.

### 5.4 Annotation (`;`) — marginalia anchored to data

`;` on anything — a metric, a chart point, a filing row, an examiner's paragraph —
opens one ruled line in the margin for a note, anchored to *the datum, not the
page*. TSM's gross-margin note follows TSM's gross margin: into the Bench, the
Field's residue, the Dossier. Annotated data shows the margin underline
everywhere it appears. Notes roll up into the Journal, cross-referenced. Your
accumulated marginalia becomes the wear of the book — the month-two discovery is
finding your own past note exactly where you need it.

### 5.5 The keyboard grammar

Not "shortcuts" — a small consistent grammar, verb-object, hands on home row:

| Key | Meaning | Scope |
|---|---|---|
| `/` | call line | anywhere |
| `g` + `t f d b k a` (or `1–6`) | go to folio | anywhere |
| `[` `]` | walk the Trail | anywhere |
| `.` / hold `Space` | peek provenance | any judgment |
| `;` | annotate | any datum |
| `w` | watch | any hovered symbol |
| `p` | pin to Bench | any hovered symbol |
| `↵` | open Dossier | any hovered symbol |
| `d` (hold) | Delta Lens | Bench |
| `r` | request/refresh the local AI reading | any judgment column |
| `q` | toggle period | Dossier record |
| `x` | run examination / remove specimen | Dossier / Bench |
| `J` | commit session Trail to Journal | anywhere |
| `?` | the Legend (one sheet: notation + grammar) | anywhere |

`?` opens **the Legend** — a single ruled sheet teaching the tickmark, the inks,
the seam, and the grammar. It is the product's manual, one page, and it is also
the first-run experience: new users get the Legend as their first sheet, then
Today. No tour, no tooltips-on-rails, no confetti.

### 5.6 AI conduct — settled sentences, reading lists, never a spinner

All generation follows three laws:

1. **AI writes only in judgment ink, only in judgment columns.** It is never
   ambient, never a chat bubble, never a floating assistant. It is an examiner
   who writes on the right side of the seam when asked.
2. **Settled sentences.** Output buffers until a sentence completes, then the
   sentence lays down whole (60ms fade-in). No token-by-token typewriter — that's
   the model performing. While working, the *margin* shows the reading list: the
   sources being consulted, ticking through factually ("EDGAR 10-K ¶MD&A ·
   rotation snapshot · 8 news rows"). Honest, informative waiting — the reading
   list *is* provenance being assembled, and for a local model it makes latency
   legible instead of embarrassing.
3. **Every sentence is peekable** (§5.1). A sentence that can't cite its underlay
   is rendered in stale ink with a margin `unsourced` mark — the system marks its
   own speculation. (This single convention does more for trust than any
   disclaimer paragraph ever written.)

When every provider is offline: the judgment column shows ruled blank lines and
one factual sentence naming both recovery paths (per `AI_RECOVERY_HINT`). The
evidence side is always fully functional — the product degrades to an excellent
non-AI instrument, visibly and gracefully.

---

## 6. Motion & Performance Doctrine

**The law: motion only for causality.** Something moves only to show *what caused
what* — a changed value (rule-sweep), an excluded row (settle-out), a peek (fold),
a sheet turn (departure). Nothing moves to be admired. Full inventory of the
product's animations — this is all of them:

| Motion | Duration | Purpose |
|---|---|---|
| Rule-sweep under a changed value | 200ms | which number just changed |
| Sheet turn between folios | 120ms | you moved |
| Peek fold / heal | 120ms | evidence is *beneath* judgment |
| Residue settle-out | 240ms | what your filter excluded |
| Strip draw-in (new metric) | 150ms | the distribution is computed, not decoration |
| Settled sentence lay-in | 60ms | the examiner wrote |
| Atlas district zoom | 200ms | spatial continuity |
| Notch ease on hover | 80ms | affordance |

All transform/opacity. `prefers-reduced-motion` cuts everything to instant.

**Performance as identity**: body face is a system font (0 bytes); one webfont
(figures) subsetted; rulings are CSS gradients, not elements; the census virtualizes
above 100 rows; charts are stroke-only SVG (no filters, no gradients — the aesthetic
*is* the cheap path); underlays and Dossier sections prefetch on hover-intent;
tabular figures + sign-width parity mean live data never causes layout shift. The
restraint isn't just taste — every visual decision was chosen to be the fast one.
A product that looks like ink on paper has nothing expensive to render.

---

## 7. The Discovery Curve

- **Hour one**: the Legend, the seam, the tickmark taught by hovering. You can do
  everything by mouse; keys are printed in the margin the first three times each
  region is used (then never again).
- **Day two**: "Since you left" greets you with your own trail. First `.` peek —
  the moment the product's honesty lands.
- **Week one**: you notice the thumb index wearing in where you work; you find `d`
  on the Bench; your first sculpture saved; margin math discovered by accident
  (a drag that computed).
- **Month one**: a wire headline hovers to "touches: your TSM thesis ¶3"; an old
  journal entry shows its subject's current tickmark beside your past confidence;
  you commit a Trail to the Journal before a buy and realize the product has been
  building your provenance all along.
- **Year one**: the Atlas geography is in your spatial memory; your marginalia
  meet you everywhere; the notation reads faster than words. The book is worn in
  the shape of your hands.

Nothing above is a hidden easter egg — it is depth that compounds, which is the
difference between discovery and gimmick.

---

## 8. The Landing Page (public)

One sheet. Eye-ease green. At top, in large Charter italic, one sentence:

> *Facts on the left. Judgment on the right. Never confused again.*

Below it: a **live, real** (not screenshotted) Dossier fragment for one name —
seam, tickmarks, a peekable AI sentence the visitor can actually press `.` on.
The landing page *is* the product demonstrating its epistemology, interactive,
above the fold. Below: the Legend, verbatim — teaching the notation is the pitch.
No feature grid, no testimonial carousel, no gradient hero, no pricing table
theatrics. The confidence of showing one true thing.

---

## 9. Derivative Risk Audit

Being my own harshest critic, per major element — what it resembles, why, and how
to push further:

| Element | Resembles | Honest assessment | Push further |
|---|---|---|---|
| **Eye-ease green sheet** | Nothing in software. Adjacent risk: "vintage accounting" pastiche, or reading as a mere tint of the cream-editorial AI default. | The refusal of texture keeps it from pastiche. But green-tinted-paper alone is claimable by a copycat in an afternoon. | The color is defensible only *in combination with* the red-only-negative rule and the rulings. Codify the trio as inseparable. Consider making the sheet's green *subtly deepen with session length* (an hour in, the paper has "warmed" 2%) — material that responds to use is uncopyable by theme-swappers. Possibly too precious; prototype it. |
| **Red-only-negative (no green gains)** | Bookkeeping itself; no software. | The strongest single identity move in the concept. Risk: users trained on green/red may misread early. | Hold the line; the Legend teaches it in one line. Do not compromise with a "classic colors" setting — optionality would destroy the fingerprint. |
| **The fact/judgment seam** | Code-review diffs (two-pane); legal briefs; Talmudic page layout (commentary surrounding text). | The *registration* (judgment level with its evidence) and the two-ink system make it unlike diffs, which compare same-substance texts. Talmud is the closest ancestor — and 1,500 years old, not a competitor. | Deepen: let the seam be *interactive* — drag it to rebalance evidence/judgment widths, and let `\` collapse judgment entirely ("facts-only mode" — reading the sheet with all opinion withdrawn is a genuinely new reading mode for finance). |
| **Tickmark notation** | Weather station models (source, acknowledged); Zerodha/Kite's minimal marks superficially. | No product carries a taught, fixed, multi-variable glyph on every symbol. Real risk is *illegibility at 22px* and users never learning it. | Ship it with the permanent hover-legend (never gate on memorization). Test the stem at 3 fill-levels vs continuous. If continuous fails, quantize — a notation that must be squinted at is jewelry, not notation. |
| **Thumb index** | Vertical tab strips (browsers); Material nav rails, at squint distance. | The *cut* (active sheet tucking under a deeper notch), edge rotation, wear-in, and state-preview hovers separate it. At its worst it degrades into "right-hand icon rail." | Never allow icons on it — text notches only, rotated. Keep it 28px. The wear-in ink density must be real (usage-driven), not decorative, or cut it. |
| **The Trail** | Browser history; Arc's history strip; undo timelines in creative tools. | The judgment ticks (▪◆) and *commit-to-Journal* make it a provenance instrument, not history chrome. The weakest resemblance case, but the strongest workflow claim. | The differentiator must be enforced: the Trail is valuable *because it feeds the Journal*. If commit-to-Journal is rarely used, the Trail decays into history — instrument it and be willing to redesign the commit gesture. |
| **The call line** | Cmd-K palettes (Linear/Raycast); Spotlight. | Same reflex (`/` summon, type, act) — the *reflex* is convergent evolution and shouldn't be fought. The chrome is what's different: a ruled line of the sheet, results on rules, no floating rounded window, plus a query grammar palettes don't have. | Push the grammar: make `field:` bounds, `v` comparisons, and `note:` composable in one line ("TSM v AVGO note: watch HBM pricing"). The moment the call line does something no palette can, the resemblance inverts. |
| **The Field's distribution-sculpting** | Crossfilter (2012 demo); Observable notebooks; academic brushing-and-linking. | The lineage is real — brushing histograms is prior art. What's new: strips as the *table's living header*, whole-universe silhouettes under your bounds, hover-a-row-lights-every-strip, and saved sculptures that replay and diff. | Lean into the diff: "what changed in this screen since Tuesday" is the workflow claim no crossfilter demo makes. Consider strips also rendering *your Book's names* as fixed dots — your portfolio always visible against every distribution. |
| **The Bench's shared rulers + Delta Lens** | Peterson field-guide plates; parallel coordinates, distantly. | Nothing in consumer software puts N assets on literal shared per-metric rulers with a subtraction lens. Confident this is new. | Add "ghost specimen": pin a *saved sculpture's median* as a phantom column — comparing candidates against the field's typical survivor, not just each other. |
| **Dossier as registered case file** | Long-scroll research pages exist everywhere (every broker). | The registration discipline, examiners writing into the column, visible disagreement tie-lines, and journal flags on the price axis are each individually rare and jointly unique. | The disagreement tie-lines are the most original element — promote them: a Dossier-top "tensions" line ("2 tensions on file") jumping to them. Institutionalize disagreement. |
| **The Book's running balance & buried total** | Actual ledgers; YNAB's register, faintly. | Placing the portfolio total under the entries is a behavioral-design claim, not a layout habit. | Verify it survives contact with the owner's real habits — if it creates total-checking friction that pushes usage to a broker app, that's a loss. Prototype, watch, decide. |
| **Atlas fixed geography** | Treemaps (finviz's sector map is the elephant); transit maps. | finviz proximity is the real threat: "sectors as colored regions" reads finviz at a glance. Differentiators: permanent geography (finviz reflows by cap daily), routes (supply chains as lines — finviz has nothing relational), climate tinting instead of per-stock red/green carnival, tickmark settlements. | Kill per-company area-by-market-cap entirely (that's the treemap tell); place by sub-industry blocks with uniform marks. If a screenshot still smells finviz, the districts' tessellation should become more diagrammatic — hexes or a bespoke tessellation — and less area-chart. |
| **Settled sentences + reading list** | Streaming AI text is everywhere; "sources consulted" resembles Perplexity's citations. | Perplexity shows sources *after* as footnotes; the reading list is the *waiting state itself*, and unsourced sentences self-mark in stale ink — a self-disciplining convention no assistant product has. | Enforce ruthlessly: if any surface ships an unpeekable AI sentence in full ink, the convention is dead. This is a build-time contract, not a style. |
| **Overall silhouette** | The three AI-default looks: refused (not cream/terracotta, not black/acid-accent, not broadsheet). Closest living products: none in finance; distant cousins are editorial reading apps. | The combination — green sheet, two inks, seam, notation, edge instruments, no cards, no nav bar — has no single ancestor. The risk isn't resemblance; it's *coherence collapsing during implementation* (one shipped rounded floating card and the spell breaks). | Write the six laws below into the repo as a design constitution; review every PR against them. |

**The Six Laws** (the identity, compressed — violate none):

1. Facts in fact ink on rules; judgments in blue-black on plain ground; the seam
   between them is always visible.
2. Red is the only warm color, and it only ever means loss or breach.
3. Every judgment peels to its evidence in one keypress.
4. Data shows its age; nothing pretends to be fresher than it is.
5. Motion only for causality; nothing moves to be admired.
6. No cards, no floating panels, no chrome that isn't one of the four edge
   instruments.

---

## 10. What I'd Prototype First (to test the identity, not the features)

1. **One Dossier, fully drawn** (static data is fine): the seam, the inks, the
   registration, one peek, one tie-line. This proves or breaks the whole concept.
2. **The tickmark at real size** in a 50-row table. If it doesn't read at 22px,
   the notation needs redesign before anything else is built on it.
3. **The Field's strips** over the real 248-name universe — sculpting must feel
   instant (<16ms/frame) or the "filters are the data" claim is theater.
4. **Red-only-negative in the Book** with live positions for a week of real use —
   the boldest call deserves the earliest contact with reality.

---

*The goal was never a beautiful finance website. It is a sheet of working paper
with a hundred years of numerical labor behind it, an epistemology you can press
with a key, a notation you learn once and read forever, and a record of your own
mind that compounds. Remove the logo; it could not be anything else.*
