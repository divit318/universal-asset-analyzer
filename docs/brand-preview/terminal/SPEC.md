# UAA — The Terminal, Directed

A complete design specification for the command-first UAA. Not an implementation plan —
a description precise enough to rebuild the interface from words alone. The concept from
`/terminal/` stands; this document is what a design studio would hand over after living
with it for months.

Everything in here is written to one test: **if the logo were removed from a screenshot,
would you still know it's UAA?** The answer has to come from structure, rhythm, motion,
and writing — never from a color or a font.

---

## PART I — FOUNDATIONS

### 1. The canvas

- Background `#101113`. Not black. Black is a rendering default; this is a surface.
  There is exactly one background color in the entire product. No elevated panels, no
  raised cards, no tinted wells. Depth is done with type and rules, the way a newspaper
  does it, because a newspaper never needed drop shadows to tell you where an article ended.
- Ink `#E9EBEE`, muted `#9AA1AB`, dim `#5E646D`. Three grays, chosen so that each step
  reads as a *demotion in authority*, not a style. Ink states, muted explains, dim annotates.
- Rules: `#3C4048` (strong — opens a major section) and `#2B2E34` (hairline — separates
  siblings). A strong rule appears at most three times per page. If a fourth seems
  necessary, the page has too many ideas.
- **Amber `#E2A336` means one thing: a decision is open.** It is never a brand color,
  never a hover, never "new." Green `#4BD587` and red `#F0716B` belong to the market and
  are never borrowed for interface moods — an error message is not "red," because an
  error is not a loss.
- Corner radius: 0 everywhere. Focus ring: 1px amber offset 2px — the only glow-adjacent
  effect in the product, and it means "your keyboard is here."

### 2. The grid, and how it is deliberately broken

Twelve columns, 24px gutters, 36px page margins, content max 1360px. But the grid is a
tool, not a look:

- **Content lives in columns 1–9.** Columns 10–12 are **the margin** — a reserved strip
  that stays empty most of the time. It is where provenance, footnotes, and marginal
  actions appear on demand (see "the margin answers," §5). Empty margin is not wasted
  space; it is the interface holding a place for its own annotations, the way a legal pad
  keeps a ruled margin whether or not you write in it.
- **The one-big-number rule.** Every page sets exactly one element at 76px — a price, a
  count, a verdict word. One. This creates a focal point per page and an instantly
  recognizable rhythm across screenshots: UAA pages have a single oversized figure and
  everything else is working-size. Two big numbers on one page is a design error by
  definition.
- **Compression and release.** Sections alternate density on purpose. The figure row is
  compressed: numbers shoulder-to-shoulder, hairline above and below, no air. The
  standfirst below it is released: 16.5px type, 66ch measure, 22px clear above and below,
  nothing beside it. Dense, open, dense, open — down the page like breathing. Uniform
  padding is the tell of generated design; UAA's padding is an editorial decision made
  per section, and the sections are allowed to disagree.
- **Asymmetry with a reason.** The research page's three columns are 7 : 3.2 : 2.8 —
  not thirds. The chart deserves more than the wire; the wire deserves less than the
  readings. When two things are equally important they get equal space, which is rare,
  which is the point.

### 3. Typography

Two families: **Geist** (interface prose and labels) and **Geist Mono** (every number,
every timestamp, every command, tabular figures always). No display face. No serif. The
hierarchy comes from a deliberately gapped scale — nearby sizes are avoided so that no
two levels can be confused:

| Role | Spec |
|---|---|
| The one big number | Mono 76px / 600 / −2.5% tracking. One per page. |
| Masthead price | Mono 30px / 600 |
| Page title | Sans 21px / 600, company name in muted 400 on the same line |
| Standfirst | Sans 16.5px / 400 / 1.5 line height / max 66ch |
| Working text | Sans 13.5px / 400 |
| Table figures | Mono 12.5px / tabular / right-aligned to the decimal |
| Findings (table prose) | Sans 12px muted |
| Labels | Sans 10px / 500 / +14% tracking / uppercase / dim |
| Provenance & margin notes | Mono 10px dim |

Numbers inside sentences are set in mono at the surrounding text size: "trimming NVDA to
`6%` raises `$44,700`." The sentence reads as prose; the figures read as facts. This one
habit does more for the institutional feel than any layout decision.

### 4. Motion doctrine

Three durations, one easing (`cubic-bezier(0.32, 0.72, 0, 1)`), and a single law:
**motion exists to show causality — where something came from, or what changed.** Motion
that only decorates is deleted.

- 120ms — acknowledgement. Keypresses, focus moves, hover reveals.
- 240ms — consequence. A row re-ranking, a column removed, a value updating.
- 420ms — arrival. A page assembling, a run completing.

**The settle.** Numbers never fade in and never spin. A new value arrives by ticking
through at most three intermediate values in 180ms — the visual grammar of a tape, not an
odometer. A value that *changed* settles; a value merely being re-rendered appears
instantly. Users learn, without being told, that a settling number is news.

**Departure by demotion.** Nothing disappears abruptly. A removed row compresses to a
1px rule over 240ms, holds one beat, and fades. A stale figure dims to `dim` and gets a
mono annotation of its age. In UAA, data is allowed to become old; it is not allowed to
silently vanish.

**No spinners, no percentages, no pulsing dots — anywhere.** Loading is typographic:
the page's real layout renders immediately with em-dashes (`—`) where figures will be,
and figures settle in left-to-right, column by column, as sources answer. A page loading
looks like a page being *filled in by a fast clerk*, and slow sources are visibly slow in
exactly the cell they own — which is honest, and diagnostic for free.

### 5. The margin answers (there are no tooltips)

Hover any figure, score, or claim, and hold for 300ms: a mono annotation appears in the
right margin **at that row's height** — source, timestamp, method, one line each:

```
yahoo · live · 09:42:07
composite.ts · quality 28 / value 24 / growth 24
your journal · 12 mar
```

No bubble, no arrow, no floating box that covers the very data you're reading. The
annotation sets in the margin at 120ms, follows your hover down the page like a patient
librarian, and fades 600ms after you leave. Keyboard users summon it with `?` on a
focused cell. This single mechanic replaces every tooltip in the product and is,
screenshot for screenshot, the most identifiable thing on the screen: **UAA is the
interface whose margins talk.**

### 6. Sound

Off by default; two sounds exist, both under "Preferences → Sound, if you want it."

- **Recording a decision:** a short, dry, wooden tick — the register of a pen cap, not a
  cash register. 40ms, −18 LUFS quiet.
- **A run completing:** one low, round tone, like a clock in another room. Runs take
  minutes; the user has earned the right to look away and still know.

Nothing else makes a sound. Markets are loud enough.

### 7. The keyboard

The product is fully drivable without a mouse, and the grammar is small enough to write
on an index card:

- Typing anywhere (outside a field) focuses the command line. `Esc` always returns there.
- `j / k` — move down/up rows, on any page. The focused row carries the amber focus ring
  on its left edge only — a 2px amber tick, not a box.
- `Enter` — open. `d` — decide (opens the decision affordance for the focused item).
- `w` — add to watchlist, with the note prompt pre-focused. UAA won't stop you from
  saving a name without a note, but the field comes first on purpose.
- `t` — trim sheet (portfolio). `.` — repeat last command. `g` then a letter — go:
  `g r` research, `g p` portfolio, `g w` watchlist.
- `?` — the reference card: a full-screen typeset sheet (not a modal grid of chiclets),
  set like the keyboard cards that shipped with 1980s terminals. Two columns, headed
  THE LINE and THE PAGES. Dismisses on any key.

---

## PART II — THE GLOBAL CHROME

Everything above the content is 68px tall in total and never grows.

### The command line (top, 37px)

Left to right: the wordmark `UAA` (mono 12px 600, 18px padding, hairline right border);
then the line itself — mono 12px, prompt text in ink, hint text in dim:

```
NVDA▊   — a ticker opens research · two or more compares them · "roe > 15" starts a screen
```

The cursor is a 7×13px block, blinking at 1.1s in steps (no fade — terminals don't fade).
Right side: session status in mono 10.5px dim — `● AI READY · PRICES LIVE
09:42:07` — with the dot in green. When the AI is unavailable (no key), the dot goes dim
(not red — it's not a loss) and the text reads `AI OFF · PROSE PAUSED · NUMBERS FINE`.

**Autocomplete is a column, not a dropdown.** Typing opens a typeset list directly under
the line — mono rows, matched characters in ink, the rest dim, source hints right-aligned
(`ticker · nasdaq`, `saved screen · 4 feb`, `command`). Arrow keys move an amber left-tick
down the column. No box, no shadow, no rounded container: the suggestions look like the
next four lines of a document.

**The line understands sentences.** `wl ASML buy under 900` adds a watch with its note.
`why NVDA 81` prints the conviction decomposition inline beneath the line, right there,
without leaving the page. `run ic MU` queues a report. `port trims` opens the sizing
sheet. Every response to a typed command appears *below the line in document flow* —
never in a toast, never in a corner notification. The product has no toasts at all: if
something deserves your attention it earns a line of type in the page, and if it doesn't,
it isn't shown.

### The function row (31px)

Seven words, mono 10.5px, +10% tracking: `RESEARCH SCREEN COMPARE PORTFOLIO WATCHLIST
IC REPORT RUN`. The active page carries a 2px ink underline that **slides** between words
in 240ms when you navigate — the only persistent moving element in the chrome, and the
one place the interface visibly acknowledges travel. Far right, in dim: `JOURNAL` and
`THE DESK`.

### The decision line (every page, directly under the masthead)

The product's signature ritual. A full-width strip: strong rule above, hairline below,
12px vertical padding. Left: a mono 10px tag — `DECISION OPEN` in amber, or `NOTHING
OPEN` in dim. Then one sentence, working size, muted with key phrases in ink. Right:
one action in mono 11px with a hairline underline (`journal ↵`).

**Scroll behavior:** the decision line is not sticky — it scrolls away like everything
else. But as it exits, its amber tag detaches and docks into the command line's right
end as a small `◆ 1 OPEN` marker (240ms slide). The decision is never off-screen; it is
merely folded. Clicking the marker scrolls you back at 420ms with the line landing
exactly under the masthead — the interface returning you to the exact sentence you left.

When nothing anywhere needs deciding, the docked marker reads `◇ CLEAR` in dim. Users
report checking for that empty diamond the way they used to check a phone.

---

## PART III — THE PAGES

Each page below is described top-left to bottom-right, with motion, states, keyboard,
signature moment, and where the eye goes.

---

## 1. THE DESK (the opening screen)

**What it is.** UAA does not open on a dashboard. It opens on the docket: every open
decision in the product, aggregated and aged, followed by what changed overnight. The
Desk exists to answer one question — *do I need to do anything?* — and then get out of
the way.

**The scene, top to bottom.** Masthead: `The Desk` (21px) with today's date in muted on
the same baseline, and on the right, in the mast's small mono block: `LAST SESSION ENDED
TUE 16:12 · 2 DECISIONS RECORDED`. Below it, no decision line — the Desk *is* the
decision line, expanded.

Then the docket. Each open decision is a numbered item (`01`, `02` in amber mono 11px,
hanging left of the text column): one bold lead phrase, one explanatory sentence, one
action. The typographic weight of each item is a function of its age — see the signature
moment. Between items, hairlines. After the last item, 48px of nothing, then a strong
rule and the section `OVERNIGHT` in label type: a wire-style list of what changed while
you were gone, each line a finding, not an event: not "NVDA +1.2%" but "NVDA opened
above your trim line — the decision above got more expensive to ignore."

At the bottom, compressed: a one-line figure row for the book (`$482,960 · +0.84% ·
◆ 1 policy breach`), because the Desk should let you leave without visiting Portfolio.

**Signature moment — decisions gain weight.** An item open for two days is set at
working weight. At two weeks, its lead phrase is 600 weight. At six weeks, the item's
number ticks up in size (11 → 13px) and its age is printed beside it in amber: `OPEN 11
WEEKS`. Nothing blinks, nothing nags, no red badges — the interface simply lets
procrastination *accumulate typographic mass*, the way an unanswered letter feels heavier
on a real desk. Users describe this as the product's conscience, and it is the single
most-quoted detail in the concept.

**The empty state** is the best screen in the product. When the docket is empty and
nothing changed materially overnight, the Desk renders a nearly blank page with one
sentence, centered optically (slightly above true center), working size, muted:

> Nothing needs you. The book is fine, the watchlist is quiet, and the last open
> decision was closed Tuesday. Come back when something changes — it will be at the top.

No illustration. No mascot. The restraint *is* the reward: UAA is the only financial
product whose ideal state is a page that tells you to leave.

**Eye path.** Big date → `01` in amber → the oldest item's bold phrase → the action on
its right → down the docket → OVERNIGHT. Total time to "am I needed?": under three
seconds, by design.

---

## 2. RESEARCH

**The scene.** Masthead: ticker + company (21px line), price in mono 30px, change in
mono 14px colored by the market, and at far right the session block (two mono 10.5px
lines, right-aligned). The price is *not* the page's big number — see below.

The decision line follows, then the standfirst — two sentences that read like the first
paragraph of a good column, written by the analyst at 06:00 and frozen for the day:

> Priced for two more perfect quarters. Consensus wants $28.4B of data-center revenue on
> 28 May and a gross margin that starts with a 7; the multiple assumes both arrive.

Hovering the standfirst puts yesterday's version in the margin, struck through — the
page keeps its own history and isn't embarrassed by it.

Then the figure row (six figures, compressed), then the three ruled columns:

- **Column A (7/12): the chart.** No frame, no toolbar, no chart-type picker. One ink
  line (1.7px), the 200-day in dim (1.1px), one dotted reference line only if a journal
  note establishes one (the user's trim line at 1,150 renders as a hairline with `YOUR
  LINE · 12 MAR` in margin type at its right end — the chart displays your commitments
  alongside the price, which no charting library on earth does by default). Axis labels
  are four numbers and four months in mono 9px. Below the chart: `WHAT MOVED THE SCORE
  THIS QUARTER` — three findings with signed contributions (`+6`, `+3`, `−4`) in the
  date gutter, so the score's recent history reads like a wire.
- **Column B (3.2/12): the readings.** Five engines as a text ledger: name (muted),
  value (mono 600, right-aligned), one clause (dim). The dissenting engine's clause is
  amber. Below, a two-sentence paragraph on the disagreement, ending with the one fact a
  buyer needs: "The factor model's call changes near 1,050." Then `YOUR POSITION` —
  three ledger rows. If the asset isn't held, this block is replaced by a single dim
  line: "You don't hold this. Fit is scored as if you were about to."
- **Column C (2.8/12): on file.** The wire — filings and news as date-guttered items,
  each with a one-line *judgment*, not a summary ("Scheduled selling is noise; the
  screen only flags the unscheduled kind.").

Full width below: `THE ANALYST'S NOTE` — two paragraphs, 70ch, with the attribution
line above (`WRITTEN LOCALLY · QWEN3 · 41S · 9 OF 9 FIGURES TRACED`) and sources below a
hairline. While the note is being written (first visit of the day), the attribution line
reads `WRITING — 20–40S ON YOUR M3` and prose streams in *as typeset text* with a block
cursor; there is no skeleton, no shimmer, no "thinking." If the AI is unavailable: "The
analyst is offline (add your API key in Settings). Every number on this page is unaffected." — the page
demonstrably true to "AI explains, engines decide."

**Signature moment — probing the price.** Click and hold the masthead price, and it
becomes draggable: drag left and the whole page recomputes at the counterfactual price —
conviction resettles, the verdict word flips when a band edge crosses, the P/E in the
figure row reflows, the chart's last point slides. The dragged price renders in amber
(it is, after all, a decision being rehearsed) with the delta beneath: `AT 1,050:
CONVICTION 87 · QUANT WITHDRAWS ITS OBJECTION`. Release, and everything settles home in
240ms. This is the fastest way ever built to answer "at what price would I be wrong?" —
and it's only possible because UAA's engines are deterministic and local. Competitors
whose scores live on a server cannot copy this without shipping their model to you.

**The one big number** on Research is the conviction score in column B — 76px, ink,
with `CONVICTION` in label type above and the band word beside its baseline. The price
is deliberately smaller than the score: **UAA's opinion of the price outranks the
price.** That inversion is the page's thesis, expressed in font size.

**Keyboard.** `d` opens the decision. `p` starts a price probe (arrow keys step $5,
shift-arrows $25). `1–5` focus each engine reading and print its full decomposition in
the margin. `n` — new journal note, pre-addressed to this ticker.

**Eye path.** Price → change → decision line's amber tag → standfirst → the 76px
conviction → its amber dissent clause → chart. The layout forces the reading order a
careful analyst would choose anyway: situation, obligation, thesis, evidence.

---

## 3. SCREEN

**The scene.** Masthead (`Screen` + universe note), a decision line that is almost
always `NOTHING OPEN` (screens rarely demand decisions; the page says so honestly), then
**the query line**: the filter set, written as a sentence in mono 13px between two rules:

```
us · market cap > $10b · roe > 15% · fcf yield > 3% · net debt/ebitda < 2
```

Every clause is directly editable — click `15%`, it becomes a field, type, `Enter`, and
the table re-ranks beneath your hands. The **binding clause** — the one doing most of
the eliminating — is amber, automatically, with the explanation beneath in dim: "The ROE
filter does most of the work — alone it removes 2,214 names. If the list feels thin,
that is the filter to argue with, not the other three."

Below: the results table, full-bleed to the content column, open (no container). Columns:
rank, NAME (ticker mono 600 + company muted), PRICE, TODAY, SCREEN (600), QUALITY, VALUE,
GROWTH, MOM, QUANT, and — the column that makes the page — `WORTH KNOWING`: a finding per
row, written like a margin note ("Value 38 is the whole debate in one cell."). Rows are
34px; a density toggle (`dense`) drops them to 28px and hides findings. Row hover: no
background wash — the rank number turns ink and the margin answers with the row's cache
age. Rows with an engine split ≥ 20 carry a faint amber left-edge gradient, 60px wide,
and their QUANT figure is amber 600.

**Signature moment — the re-rank.** Change any clause and rows do not refresh: they
*move*. Each surviving row slides to its new rank in 240ms (staggered 12ms per row);
departing rows compress to a 1px rule, hold a beat, fade; arriving rows unfold from a
rule. Ten seconds of playing with the ROE threshold teaches more about a universe than
an hour of exported CSVs — you can *watch* which names are threshold-sensitive, because
they are the ones that keep moving. Sorting works the same way (`sort gap` on the
command line, or click a header): the table is never rebuilt, only re-argued.

**Loading.** First visit of the day: the table renders instantly from the 24h cache
with prices as em-dashes, then live prices settle in top-to-bottom over ~2s. The footer
states it plainly: "Fundamentals from last close, refreshed 06:00. Prices live. Scores
follow both."

**Empty state.** Not a sad illustration — a diagnosis: "Nothing passes all five
filters. ROE > 18% is the binding one: at 15% you get 34 names back, at 12%, 71.
The other four filters agree with each other." One click on either counterfactual
applies it. An empty result is treated as a *finding about your filters*, which it is.

---

## 4. COMPARE

**The scene.** Masthead, decision line (typically summarizing drift since you last
compared these names — the page remembers), then the matrix: metric labels down the left
in muted 12px, one column per ticker. Column headers are the tickers in mono 600 with
price and day-change beneath. The first data row is the conviction row — scores at 16px
600 with band words — and it sits *above* the fundamentals: verdict first, evidence
after, even in a table.

No winner highlighting, no green columns. Instead each row's best figure carries a
small ink tick to its left — countable at a glance without shouting. Hold `w` and the
ticks tally: each column header shows `WINS 7 · 3 · 4` in label type until release.

Below the matrix, `READING THE TABLE`: the analyst's three paragraphs, one per name,
each beginning with its role in the decision ("AVGO is the conservative way in… AMD is
the disagreement…"), ending with the sentence that names the real constraint ("This
table can't fix that; only selling something can.").

**Signature moment — columns are physical.** Grab a column header: the entire column
lifts 2px (its rules detach with it, a paper-slip effect done purely with translate and
a hairline shadow — the only shadow in the product, and it exists to mean "picked up").
Drag horizontally to reorder; drag it upward past the masthead and it tears away —
compressing to a vertical rule that fades, exactly the table's departure grammar rotated
90°. To add a name, the empty fourth column header is a mono prompt: `type a ticker`.
Type into it directly. The new column's figures settle top to bottom, and its
conviction ticks last — the engines take a visible half-second to caucus on a newcomer,
and the delay reads as diligence, not lag.

**The one big number** here is the count of engine agreements at the top of the analyst
read: `2 OF 3` names carry aligned engines, 76px. It is the page's actual finding.

---

## 5. PORTFOLIO

**The scene.** Masthead (`Portfolio · 14 positions · 2 accounts`; right block:
`MARKED LIVE · COST BASIS FROM YOUR LOTS, NOT ESTIMATES`). The figure row: seven
figures — value, today, YTD vs bench, XIRR, beta, cash, health. Health prints as `74 ·
weakest: income` because a score without its weakness is advertising.

Then `REQUIRES A DECISION` — the docket pattern from the Desk, scoped to the book. The
policy breach reads like a memo from yourself: "Semiconductors are 24.1% of the book
against your 15% limit — the limit you set on 12 Mar, in writing, for exactly this
situation." The word *you* appears in every policy item, because the policy engine's
authority is entirely borrowed from the user, and the writing never lets you forget it.

Then `HOLDINGS`, the open table: NAME, WEIGHT, AVG COST, PRICE, P&L, QUALITY, FIT,
STANDING. Standing is prose: the row's story in one line ("The book's quiet anchor.
Nothing to do, which is the point." · "No thesis on file. See item 03 above."). BND's
quality cell prints `no basis` in dim — and hovering it, the margin explains: "Equity
engines don't score bonds, and won't invent a 50 to be polite."

**Signature moment — the trim sheet.** Press `t` on the policy item and the holdings
table *itself* becomes the instrument: the two over-cap positions' WEIGHT cells unlock
into draggable figures. Drag NVDA's `9.4%` downward and three things move in the same
240ms: the sector total in the policy sentence counts down, the proceeds figure counts
up (`RAISES $31,200`), and the amber tag at the top dims by exact proportion — reaching
`15.0%` is the moment the entire decision line's amber drains to gray, the strong rule
above it redraws itself across the full width (420ms, left to right), and the item files
itself to the journal with the wooden tick, if sound is on. Compliance is not a toast;
it is watching the page physically relax. Nobody forgets it.

**Empty state** (new user): the figure row renders with em-dashes and one sentence
beneath: "Add your first lot and this row starts meaning something. Everything is
computed from your actual fills — there are no estimated cost bases in this product."

---

## 6. WATCHLIST

**The scene.** Masthead, then a decision line that is very often live — the watchlist
is where notes come due. The table: NAME, PRICE, SINCE ADDED, CONVICTION, and the widest
column in the product: `WHAT YOU SAID · WHAT'S TRUE NOW`. Every row pairs the user's
dated note with the current fact, written to make the gap unmissable:

> **12 May — "buy under 900."** It's under 900. The only new fact since you wrote that
> is a favorable IC report. Deciding not to act is fine; not deciding is not.

Rows are ordered by how much they need you — notes at trigger, then aging theses, then
the dormant. The order is the interface's opinion, and it says so in the footer.

**Signature moment — retiring a note.** Press `r` on a row: the note's text is struck
through left-to-right in 420ms — a real animated strikethrough, the product's most
literal gesture — then the row's type dims and it files to the journal as `RETIRED 27
MAY — price never came`. Retirement is not deletion: retired notes remain queryable
(`journal retired`) and feed calibration. The strikethrough matters because it makes
abandoning a thesis *a recorded act with a feeling attached*, which is exactly what it
should be. Adding a note has a mirror gesture: `w` from anywhere opens a one-line
composer in document flow — `ASML · buy under [900] · because [   ]` — and the because
field is focused first.

**Empty state.** "Nothing here yet. Add a name with the price at which you'd act and
one sentence about why — the sentence is the part you'll thank yourself for. Names
without numbers are hopes, and this page will keep saying so."

---

## 7. IC REPORT

**The scene.** This page is a document, and behaves like one. Masthead carries the
company and the run's provenance (`COMPLETED TUESDAY 06:31 · 11M 42S · LOCAL · NOTHING
LEFT THIS MACHINE`). The decision line holds the verdict: "Buy, with one reservation
carried in full" — and the reservation is *in* the verdict sentence, not a footnote.

Below, a two-column document: a 190px margin TOC (sticky) listing the nine sections in
mono 10.5px, the dissenting section in amber; and the body at 76ch. Sections open with
a numbered heading, the agent's stance and confidence right-aligned on the same rule
(`SUPPORTS · CONF 0.86` / `DISSENTS · CONF 0.77` in amber). Body text is working-size
prose that reads like a memo, not a summary. The dissent gets the product's one inset
treatment: a 2px amber left rule, 18px indent — typographically a held breath.

**Signature moment — the report knows what you've read.** TOC entries begin dim and set
to ink as their sections actually cross the viewport for reading-speed durations (a
skim doesn't count; the threshold is honest). The export block at the end states it:
`YOU'VE READ 7 OF 9 SECTIONS. THE TWO YOU SKIPPED ARE GOVERNANCE AND RISK.` — and the
exported PDF's cover carries the same line. No lock, no gate, no shame-modal: just the
record, kept. Institutions have reading files; UAA gives one person the same
accountability. People change their behavior within a week of meeting this feature.

**Scrolling.** Section headings do a 300ms "press" as they pass the top (the rule above
them momentarily strengthens) — a page-turn cue at reading rhythm, subtle enough to
miss, strong enough to pace you.

---

## 8. RUN

**The scene.** The page where the product works in front of you — already the concept's
strongest, now fully directed. Masthead: `Run · IC report · MU Micron Technology`,
elapsed clock ticking in the right block (mono, updates once a second — the only
once-a-second motion in the product). Decision line: `IN PROGRESS — nine sections run
in parallel and file independently; you can read the finished ones now.`

The run log: timestamp gutter (mono 11px dim) and findings. Each completed step is a
sentence with its content, not a status ("Accounting filed. **Concurs, 0.81** — the
inventory writedown risk has left the balance sheet. First clean concurrence in three
MU reports."). The live step's timestamp is amber. Future steps are listed in dim after
an em-dash — the plan is visible, not mysterious.

Below a strong rule, the stream: the section currently being written, as typeset prose
with a block cursor, streaming word by word. When the grounding pass corrects a figure,
you see it happen: the number is struck and replaced inline, with a margin note
(`corrected against 10-Q p.12`) — the model editing itself in public, maybe once per
run. Nothing in the product builds more trust per pixel.

**States.** Completed sections become links the moment they file (read while the rest
cook). If the laptop lid closes, the run pauses; reopening shows `PAUSED AT 07:12 —
resumed` in the log gutter, because the log is the truth and the truth includes naps.
On completion: the elapsed clock stops, holds one beat, and the masthead crossfades
(420ms) from `Run` to the report's title — the page you were watching *becomes* the
report, in place. Optional low chime. No confetti; finishing a job is the job.

---

## 9. MOBILE

One principle: **the phone is for deciding, not researching.** The mobile build is the
decision line given the whole viewport. Top: `UAA` and the live clock. Then `NEEDS
DECIDING · 2` in label type, and each decision as a full-width item: ticker + price
line, the situation in two sentences, and three inline text actions (`decide` ·
`defer ▸ 28 may` · `retire note`) — mono, underlined on the current one, 44px touch
targets despite the visual lightness. Below: `CHANGED SINCE LAST NIGHT`, a findings
list. That is the entire app. Charts, tables, and reports open on request but arrive
formatted for glancing, and the product says why: "a 390-pixel DCF is a novelty, not a
tool." Swipe right on a decision item to defer it — the item slides and its date stamps
on, no springy overshoot. No tab bar, no FAB, no pull-to-refresh theatrics.

---

## PART IV — EXPERIMENTAL IDEAS

Filed honestly: some of these may never ship, all of them are in-character.

1. **Stress the book.** The Research page's price probe, applied to Portfolio: type
   `stress spx -10` and watch the whole book recompute under the scenario — every
   position's beta-implied move settling in, the policy lines re-evaluating, the health
   score absorbing it. Scenarios are sentences, not wizards.
2. **Replay.** `replay NVDA 12 mar` re-renders the research page exactly as it stood the
   day you wrote the note — scores, standfirst, chart truncated to that date — with
   today's outcome in the margin. The journal stops being a list and becomes time travel.
   Calibration you can *feel*.
3. **The annual report of you.** Every January, UAA typesets a bound PDF: your year —
   decisions made and dodged, calibration curve, best call, worst call, the note that
   aged best, written in the house voice. The only growth loop the product needs: people
   will show this document to other people.
4. **Ambient regime.** The canvas luminance tracks market regime within a ±1.5% band —
   stress regimes are literally, imperceptibly darker. Below conscious notice, probably;
   in testing, people claim they can feel it. Ships behind a preference, honestly
   labeled "probably placebo."
5. **The second screen.** A companion mode that turns a spare display into pure wire —
   the tape, the docket marker, and nothing else, set at meeting-room-legible sizes. UAA
   as furniture.
6. **Voice of the record.** `read ic ASML` — the model reads the report aloud for
   the commute, generated on-device, in a flat professional register. The one feature
   where the product is allowed to be heard.

---

## PART V — SELF-CRITIQUE

**Why this doesn't read as AI-generated.** The tells of generated design are uniformity
and hedging: equal paddings, symmetrical grids, every section a card, every number a
KPI tile, accents distributed like confetti, motion as garnish. This concept breaks
each tell *with a reason*: the grid reserves an asymmetric margin that talks; every page
has exactly one oversized figure; sections alternate compression and release; there is
one accent and it is a workflow state, not a brand; motion is causality; and the copy
takes positions ("not deciding is not fine") that no risk-averse generator would take.
Identity accumulates in the rituals — the decision line, the settle, the strikethrough,
the weight of an ignored docket item — which is where identity lives in Bloomberg and
vim and every tool people tattoo on themselves: **in the grammar, not the paint.**

**What it risks.** Three honest weaknesses. First, austerity: a user who wants comfort
will find this cold until the first time the Desk tells them to go outside — the empty
state carries a lot of emotional load. Second, the learning curve: a command grammar
must be learnable in one session or it's an affectation; the hint line and the `?` card
carry that burden and must be tested hard. Third, discipline drift: this system is one
lazy amber badge, one convenience card, one "just this once" toast away from becoming
the generic dashboard it defines itself against. The design notes page exists so future
contributors inherit the reasons, not just the rules.

**What I'd validate first.** (1) The re-rank animation at 400+ rows — it must never
stutter, or the product's fastest feeling becomes its slowest. (2) Whether the margin
annotations are discoverable without a tour — they should be found by accident within
minutes. (3) Whether decisions-gaining-weight reads as conscience or as nagging; the
line between them is about 100 milliseconds of restraint and one font weight.

**The sentence for the wall.** Other terminals show you the market. This one shows you
your own mind, holds it to what it said, and keeps the margins ready for questions.
