# 06. Information Architecture and Reading Order: the Today dashboard (`/`)

Audit date 2026-08-08, branch `f22/day-change`. Method: static read of `lib/home/layout.ts`, `lib/home/registry.ts`, `lib/home/types.ts`, `app/_home/module-grid.tsx`, and the seven modules in `app/_home/modules/`; pixel measurements taken off `shots/baseline/1440.png` (full page 1440 x 2942 px), cross-checked against `390.png`, `2560.png`, and the state captures in `shots/states/`. Companion evidence from `00-architecture-map.md`, `01-numerical-integrity.md` (NI-04), `02-redundancy.md` (RD-02, RD-03, RD-06, the fact table), and `05-llm-quality.md` (section 3). `03-decision-utility.md` did not exist at the time of writing; where 02 forward-references its DU findings, those references are repeated here as-is.

No code was modified. This document is the only file this audit writes.

---

## 1. The hierarchy as built, and what the fold actually shows

The page is five groups in `HOME_LAYOUT` (lib/home/layout.ts:66-122), rendered in order by `ModuleGrid` (app/_home/module-grid.tsx:53-95, a straight walk of the config):

| Pos | Group | Modules and spans | Declared purpose (the file's own comments) |
|---|---|---|---|
| 1 | `command` | todays-brief 8/12 + book 4/12 | "what happened, and how is my book, answered before the fold" (layout.ts:69-70) |
| 2 | `changes` | whats-changed 12/12 | "the first question a returning user actually asks is what moved while I was gone" (layout.ts:81-83) |
| 3 | `attention` | attention-queue lg7/xl8 + radar lg5/xl4 | "what needs a decision now, and what's worth a look next" (layout.ts:89-90) |
| 4 | `tape` | market-intelligence 12/12 | "the market tape" (layout.ts:102) |
| 5 | `note` | ai-investment-brief 12/12, defaultCollapsed | "the user has already read the headline version at the top" (layout.ts:116-117) |

### The fold at 1440x900, measured

Scaling the 2942 px full-page capture: the hero card spans roughly y 175 to y 930. The hero's CTA row ("Open Action Center") centers at about y 850; the book card's footer links land at about y 865; the Since Last Visit band starts at about y 975; the Attention queue header at about y 1090; the queue's one executable ACTION row ("Trim USD Cash from 33% to 20%") at about y 1835; the Market Overview header at about y 2210; the long read header at about y 2800.

At a 900 px viewport the fold therefore cuts exactly where the brief's CTA row ends. Above-the-fold inventory, in eye order:

1. Eyebrow row: "AI EXECUTIVE BRIEF, NEUTRAL", changes chip, read time, generation time.
2. KPI strip: $4.07M, TODAY +1.2%, GRADE C 68, ACTIONS 1 (todays-brief.tsx:270-299).
3. The 34 px AI verdict sentence (todays-brief.tsx:325: `text-[34px] font-semibold`, the largest text on the page, larger than the h1 "Today").
4. Support prose (three sentences).
5. Session note + Top ABNB / Weakest AMD.
6. CTA row: Open Action Center, Resume: RELIANCE.NS, Dismiss.
7. The book rail: health ring, Day P&L, XIRR vs SPY, CASH 33%, the 90-day sparkline, contributors, footer links.

Below the fold: everything the page's own comments call the centerpiece. The change diff (position 2), the queue (position 3, "the page's centerpiece", layout.ts:89), the only sized, simulated, executable decision (y ~1835, at 62% of page height, two full viewports down), the tape, the long read.

### Does the eye path match decision priority? No.

The F-pattern's first two horizontal sweeps land on the eyebrow and the KPI strip; the dominant fixation is the 34 px verdict. What that altitude is spent on, per 05-llm-quality.md section 3: sentence 1 restates the regime badge 60 px above it and the breadth figure that also appears on the tape; sentence 2 restates KPI 2 and KPI 3 from the strip it sits under. The largest text on the page is a model-written caption for the chrome around it. The one sentence in the narrative that earns its place (the cash-position "what to watch") is the seventh appearance of that story on the page (02, F1) and, critically, it is prose about a decision whose actual actionable form (target 20%, simulated +3.3 health, $526,942 sizing) is 1,000 px further down, ranked BELOW an informationless threat restatement of itself (02 section 1, "The headline case"; 02 forward-references 03's DU-03).

Should a model restatement of two stats be the biggest thing on the page? The defensible version of yes: a synthesized verdict sentence is the fastest read for a returning user, and prose can carry causality that a KPI strip cannot. But this verdict carries no causality: it is grammatically a synthesis and informationally a repeat (05 section 3: "swap in any book with grade C and a positive day and every sentence except the cash one survives unchanged"). Altitude should be rationed by irreversibility and novelty. The 34 px slot is currently spent on the least novel content above the fold.

Verdict on group 1: the command row answers "how is my book" (the book rail does this well) and spends its dominant 8/12 on re-answering it in prose. "What happened" (the change diff) is position 2, below the fold. "What do I do" is position 3, two viewports down. The hierarchy as built is: restatement, state, diff, decision. Decision priority is the reverse.

---

## 2. The two column splits

### Command row: is the book genuinely secondary to the brief?

No, it is the wrong way around. Count first mentions (02 section 3): the book rail owns the page's only non-restated portfolio numbers (F20 XIRR vs SPY, F21 90-day curve, F22 contributor bps) plus the richest renderings of health (the ring + explain popover) and day P&L. The hero's 8/12 owns: four KPIs of which two are duplicated on the rail beside it (GRADE and TODAY, RD-04: both open the identical explainHealth popover 300 px apart), a verdict sentence that restates two of the KPIs, prose that restates the cash story, and a movers line (F16/F17) that restates the contributors band in a second unit (RD-12). The 8/12 column is the secondary content wearing the primary span. The 4/12 column is the primary content compressed into a rail: at rail width the two vs-SPY comparisons stack into apparent contradiction (+39.0 excess above +4.9 spread, RD-08) partly because there is no horizontal room to separate them.

### Attention row: is the radar genuinely secondary to the queue?

It is not secondary, it is identical. 02 section 2 proves the five radar tiles and the five queue SIGNAL rows are one array (`buildOpportunitySnapshot().opportunities`, mission-control.ts:307-316, fed to both at digest.ts:264 and digest.ts:289-293) rendered twice through two monotone transforms of one number. The row gives 4-5/12 of the page's widest band to a card 02 measures at ~340 px per new fact, the worst on the page. A rail is supposed to complement its primary. This rail mirrors it.

The state captures make the structural cost visible: in `shots/states/all-clear-queue.png` the queue is empty ("Nothing needs your attention", a ~1000 px tall 7/12 card of empty space) while the radar beside it still shows the same five signals as tiles. Clearing the queue does not clear the radar because dismissal state lives only on the queue side. The "primary" surface can be done while its "secondary" mirror still shouts the same five names. The two-column split is not an IA relationship at all; it is one dataset with two z-indexes.

---

## 3. The long read at the bottom

Position: last, full width, collapsed by default (layout.ts:109-120). Written by the same single model call as the hero headline (registry.ts:192: "Same stream as Today's Brief, one model call feeds both"; 00 section 5: one call, three surfaces). The group's own on-page description is an admission: "A full morning note, written from the same data as the brief above" (layout.ts:112).

Is it earning the position? The position (last, collapsed) is the correct treatment for optional depth. The problem is that what is behind the fold is not depth. RD-03: of the live note's seven sections, five are restatement of facts F1/F3/F4/F5/F6/F11/F12 already rendered above, one (macro) is structurally empty by prompt starvation (05, LQ: zero macro facts are ever supplied), and exactly one claim on the entire expanded surface is new (Technology leader-today vs laggard-multi-week). 02 section 3 scores the expanded body at ~365 px per new fact, tied with the radar for worst on the page. Collapsed, it still costs ~145 px to render a labeled section header, a sparkle "AI GENERATED" badge (which renders even when generation failed, 05 section 4), and a promise.

So the long read is not a long read; it is the headline again, seven times, slower. Until the prompt work in 05 (feed each section its owning engine's facts, ban restatement of on-screen numbers) makes it capable of saying things that appear nowhere else, it has no IA claim to any position on this page, including the last one. A page owes a collapsed section only if expanding it pays.

---

## 4. The intended ritual vs the five-minute user

### The ritual the page assumes (reconstructed from code and copy)

1. Read the brief. Evidence: "2 min read" chip and generation time in the hero's meta row (todays-brief.tsx:256-266); the KPI strip promoted "ABOVE the narrative so the numbers land before the prose does" (todays-brief.tsx:10-12); the module doc calls its CTA row "the three verbs that start the day" (todays-brief.tsx:16).
2. Check the book beside it. Evidence: command row comment, layout.ts:69-70.
3. Scan the change band. Evidence: layout.ts:81-83.
4. Work the queue. Evidence: "One ranked stream. Clear it, and you're done." (queue subtitle, visible on every capture); dismiss endpoints and persisted dismissal TTLs (00 section 2).
5. Glance the tape. Evidence: layout.ts:102-107; 60s interval refresh only here (registry.ts:164-165).
6. Optionally expand the long read. Evidence: layout.ts:116-117.

Six steps, prose first, action fourth. The registry's paint priorities (1 brief, 2 book, 3 changes, 4 queue, 5 radar, 6 tape, 7 note, registry.ts) encode the same order: the AI surface is priority 1, the decision surface priority 4.

### What a rational user with 5 minutes needs

1. What changed since I last looked.
2. Does it touch my book.
3. What do I do about it.
4. Done, leave.

### The mismatches, enumerated

- M1: The band that answers question 1 is at position 3 of 5 (below the fold at 900 px), and the code KNOWS: layout.ts:81-83 states "the first question a returning user actually asks is what moved while I was gone" while placing that answer under two answers to other questions. The comment is a correct IA spec that the config above it violates.
- M2: Position 1's primary button exists to escape position 1. "Open Action Center" is `scrollIntoView` to the queue (todays-brief.tsx:48-50, 372-378; anchor at attention-queue.tsx:610). The hero's terminal verb is "go to the real page", which concedes the hero is an anteroom. Worse, the label chain is broken: KPI "ACTIONS 1" -> button "Open Action Center" -> lands on a surface headed "Attention, 19 open" (NI-04). And the queue's own NEXT BEST STEP spotlight is the same cash story the hero's prose just told (02 F1 mentions 2 and 3), so the CTA delivers the user to a restatement of what they just read.
- M3: The tape at position 4 is context, not decision. Nothing on it gates any queue item; its sentiment and VIX tiles narrate each other (NI-05, RD-10). It is also the only module with live refresh (registry.ts:164-165), parked below the surface the user is supposed to finish at, and it duplicates a page that already exists: both the radar and the tape navTarget to `/wire` (registry.ts:151, 180). Reference material is interleaved into the middle of the action path.
- M4: "Done" has no landing. After clearing the queue, the page's reward is ~1000 px of empty card beside a full radar of the same five signals (`all-clear-queue.png`). The ritual's terminal state is a layout hole.
- M5: The layout is state-blind. `new-user.png`: no portfolio, yet the hero keeps its 8/12 with a filled "Open Action Center" button above "ACTIONS 0", a "Resume: RELIANCE.NS" pill, and an empty queue keeps 7/12 beside a radar saying "No new candidates today". `LayoutSlot.visible` is static data (layout.ts:30-31); nothing in the layer can reflow on digest state.
- M6: The counting vocabulary fights the ritual. Four counts for four collections (ACTIONS 1, 19 open, 6 changes 4 new, 3 unread; RD-07, NI-04) mean step 3 ("what do I do") has no single number a user can drive to zero.

---

## 5. Three restructures

All wireframes at desktop width (12-col at lg+). Spans in 12ths.

### A. "Triage ledger": single-column priority stack

Organizing principle: the page IS the queue. Every unit of content is a ranked, dismissible row in one list: actions first, then threats, events, material changes, then (capped) signals, then one market-context row and one note row that expand inline. State is a one-line header strip, not a card.

```
+------------------------------------------------------------------+
| Today  Sat Aug 8 . markets closed, Fri close . updated 3:11 AM   |
| $4.07M  +1.2% today  C 68  cash 33%  [regime: neutral]           |
+------------------------------------------------------------------+
| 1  ACTION  Trim USD Cash 33% -> 20%   +3.3 health  $527K  [do][x]|
| 2  EVENT   US Employment Report (Jul)             Fri    [cal][x]|
| 3  CHANGE  Regime shifted risk-on -> neutral             [why]   |
| 4  CHANGE  3 queue items cleared since last visit                |
| 5  SIGNAL  TSM fits your book (79) NEW           [research][x]   |
| 6  SIGNAL  ALL fits your book (79) NEW           [research][x]   |
| ...                                                              |
| >  Market context (1 row, expands: tape + sentiment)             |
| >  Morning note (1 row, expands: prose)                          |
+------------------------------------------------------------------+
```

FOR: it takes the queue's own copy ("One ranked stream. Clear it, and you're done.") at its word and makes the page deliver it. Zero duplication by construction: one list means one renderer, one dedupe, one count, so RD-01/RD-02/RD-07 and NI-04 all die structurally rather than by policy. The five-minute ritual becomes literal: read the header, work the list, empty list = done, and an empty list is a proud terminal state instead of a layout hole. Mobile is the identical artifact.

AGAINST (steelman): the whole page becomes hostage to one ranking function that 02 already flags as unvalidated (the fit-score compression, forwarded to 03 DU-01/DU-04); if cross-kind scoring is wrong, the ENTIRE IA is wrong, whereas zoned layouts contain scoring damage to one card. State glanceability suffers: a one-line strip cannot carry the 90-day curve, contributors, or the health decomposition, so "does it touch my book" gets answered by a header instead of a surface. Dashboards also serve ambient reassurance (open, glance, close); a ledger with 2 rows looks broken on quiet days, and a ledger with 40 rows is a chore, not a glance.

Mobile degradation: best of the three. It is already a single column; nothing reflows, nothing reorders.

Implementation cost vs the seams: highest. The book, brief, tape, and note stop being cards; their content becomes row types inside one mega-module, which inverts the registry architecture (seven definitions collapse to roughly two: header + ledger). layout.ts becomes trivial but the module map, the registry validators, and module-shell all lose their purpose. This is a Phase-3 rebuild, not a Phase-2 reflow.

### B. "State + delta + queue": three fixed zones, context demoted to disclosure

Organizing principle: three full-width zones in question order (where do I stand -> what changed -> what do I do), each owning its facts exactly once, with ideas, tape, and prose demoted to a collapsed context shelf below the work.

```
+------------------------------------------------------------------+
| ZONE 1 . STATE (book, flattened to a strip, span 12, ~140px)     |
| C 68 [ring]  Day +1.2% +$31.7K  XIRR +68.6%/yr vs SPY  Cash 33%  |
| [90d sparkline]  Top: ABNB +64bps VOO +5 GOOGL -4 (14 others +14)|
+------------------------------------------------------------------+
| ZONE 2 . DELTA (whats-changed, span 12, ~90px)                   |
| Since Fri 12:53: regime risk-on -> neutral . 2 new ideas -> Radar|
| . 3 cleared    "<AI one-liner, one sentence, linked>"  [details] |
+------------------------------------------------------------------+
| ZONE 3 . QUEUE (attention-queue, span 12, signals feeder removed)|
| NEXT: ACTION Trim USD Cash 33% -> 20%  +3.3 health  [decide]     |
| THREAT ... (deduped into action) / EVENT ... / ALERT ...         |
| n open . clear it and you're done                                |
+------------------------------------------------------------------+
| CONTEXT (collapsed shelf)                                        |
| > Radar . 5 ideas, 2 new            (expands: compact tile row)  |
| > Market . S&P +0.6% VIX 14.9       (expands: current tape)      |
+------------------------------------------------------------------+
```

The brief and the long read as modules die. The AI's surviving output is one verdict sentence rendered inside Zone 2 (the delta band is where a synthesized "so what" belongs, captioning the diff it summarizes), linking to the full note on demand only after 05's prompt fixes make the note non-duplicative.

FOR: it is the ritual, in order, with the fold budget spent exactly on questions 1-3 (~140 + ~90 + queue header + spotlight + 3 rows fits inside 900 px). Every high finding in this audit is addressed positionally: the decision moves from y ~1835 to y ~450; the diff moves above the fold; the radar/queue mirror is dissolved by ownership (queue owns decisions, radar owns ideas, per 02's single-mention map F7-F11) rather than by span tuning; the tape stops interrupting the action path. It preserves the card/module architecture, so the registry, module map, validators, and per-module degraded states all survive.

AGAINST (steelman): three stacked full-width bands are monotonous, and full-width rows waste horizontal space at 1440+ for what are essentially 6-column contents; the current asymmetric rows are more visually alive. Two of three zones are read-only, so the top of the page still spends pixels on non-action (answer: they gate the action; state and diff are the queue's justification, and they are capped at ~230 px combined). Demoting the AI to one sentence bets against users who open the page FOR the morning prose; there is no usage instrumentation to test that bet either way (00, obs 7). The flattened book strip risks becoming a KPI junk drawer if it inherits every number the old card held; it must hold seven numbers, not seventeen.

Mobile degradation: good. The zones are already full-width; on 390 the strip wraps to a 2x3 stat grid, the delta chips wrap, the queue is unchanged, the context shelf stays collapsed. Same order, same artifact, one column.

Implementation cost vs the seams: medium, and it lands ON the seams. Position changes are layout.ts only. Module deaths are `visible: false` first (layout.ts:30-31 documents exactly this switch), deletion later. The genuinely new work is one module variant (the book's horizontal strip), one feeder removal (digest.ts:264), one prompt scope cut, and a compact radar row. module-grid.tsx is untouched.

### C. "Two-pane terminal": persistent summary rail + workspace queue

Organizing principle: a sticky left rail holds state + delta + micro-tape (always visible while working); the right pane is the queue as a keyboard-first workspace (j/k move, x dismiss, enter opens the row's deep link).

```
+----------------------+-------------------------------------------+
| RAIL (sticky, 4/12)  | WORKSPACE (8/12, scrolls independently)   |
| C 68  +1.2% +$31.7K  | ATTENTION  n open        [filter: kinds]  |
| XIRR +68.6% . Cash 33| > ACTION Trim USD Cash 33% -> 20%  [enter]|
| [90d sparkline]      |   EVENT  US Employment Report             |
| ---------------------|   ALERT  TSM 29% below targets            |
| SINCE LAST VISIT     |   ...                                     |
| regime -> neutral    |   (signals removed; radar link in rail)   |
| 2 new ideas . 3 done |                                           |
| ---------------------|                                           |
| S&P +0.6% VIX 14.9   |                                           |
| Radar: 5 ideas (2new)|                                           |
| Morning note ->      |                                           |
+----------------------+-------------------------------------------+
```

FOR: it answers "does it touch my book" continuously rather than once: state stays on screen while every queue row is judged, which is the real cognitive loop of triage. It is the strongest expression of the product's own vocabulary ("The Desk", "the tape", "the book"): terminals keep state persistent and work focal. No vertical interleaving means the tape can never again sit between the action and the exit. Keyboard-first turns the ritual's step 4 into seconds.

AGAINST (steelman): it optimizes a loop nobody has measured; there is zero dashboard usage instrumentation (00, obs 7), and keyboard-first is a power-user feature with a full input-handling, focus-management, and a11y bill attached. A sticky rail on the app's landing page competes with the global nav for the same job. At lg (1024-1280) an 8/12 workspace leaves queue rows too narrow for title + rationale + score + link, the exact texture the current 7/12 queue already strains at. And the homepage stops being a glanceable dashboard at all: a two-pane IDE is a place you work, not a place you check, which may be wrong for the open-glance-close visit that a daily page mostly serves.

Mobile degradation: worst of the three. Panes cannot coexist at 390; the rail must collapse into a top accordion or a summary strip, at which point mobile IS layout B while desktop is something else: two IAs to maintain, two reading orders to document, and the keyboard layer is dead weight on touch.

Implementation cost vs the seams: highest short of A. module-grid.tsx renders vertical groups only; panes with independent scroll and stickiness need a new renderer and a layout schema extension (groups -> panes), i.e. a breaking change to the one file that owns position. The keyboard system, roving focus, and shortcut help layer are all new. Modules mostly survive, but the rail versions of book/changes/tape are three new compact variants.

### The pick: B, "state + delta + queue"

Reasons, in order of weight:

1. It fixes all four high-severity findings below (IA-01, IA-02, IA-03, IA-04) with position and ownership changes, and most of the position half is a one-file edit. A and C fix them too, but at the cost of the module architecture (A) or a second mobile IA plus a new renderer (C).
2. It is the only option whose mobile artifact is the same artifact. A ties on this, but A's implementation cost buys the same IA outcome B reaches for a third of the work.
3. It contains the scoring risk. The queue's cross-kind ranking is unvalidated (02 -> 03 DU refs); in B a mis-ranked queue damages one zone, in A it damages the entire page.
4. It respects the codebase's own stated intent. layout.ts:81-83 already says the diff is question 1; the registry already says the queue is the centerpiece; 02's single-mention map already assigns radar the signals and the queue the decisions. B is the layout those three statements describe. The current layout is the one they contradict.

### Target layout config, precisely

Final state of `HOME_LAYOUT` (lib/home/layout.ts), after the module work lands. `GRID` and `SIZE` as they exist today (types.ts:60-71):

```ts
export const HOME_LAYOUT: HomeLayoutConfig = {
  groupGap: "gap-6",
  groups: [
    // Zone 1: where do I stand. The book, rendered as a full-width strip.
    {
      id: "state",
      columns: GRID,
      gap: "gap-4",
      slots: [{ moduleId: "book", span: SIZE.full }],
    },
    // Zone 2: what changed. Owns the diff AND the AI one-line verdict.
    {
      id: "delta",
      columns: GRID,
      gap: "gap-4",
      slots: [{ moduleId: "whats-changed" }],
    },
    // Zone 3: what do I do. Full width; signals feeder removed server-side.
    {
      id: "queue",
      columns: GRID,
      gap: "gap-5",
      slots: [{ moduleId: "attention-queue", span: SIZE.full }],
    },
    // Context shelf: ideas and the tape, present but demoted to disclosure.
    {
      id: "context",
      label: "Context",
      description: "Ideas entering the pipeline, and the tape.",
      columns: GRID,
      gap: "gap-4",
      slots: [
        { moduleId: "radar", span: SIZE.full, collapsible: true },
        { moduleId: "market-intelligence", collapsible: true, defaultCollapsed: true },
      ],
    },
    // Retired in place: data paths intact, position withdrawn.
    {
      id: "retired",
      columns: GRID,
      gap: "gap-4",
      slots: [
        { moduleId: "todays-brief", visible: false },
        { moduleId: "ai-investment-brief", visible: false },
      ],
    },
  ],
};
```

Validator compatibility, checked against the code as it stands: `visible: false` slots still count as "placed" in `validateHomeComposition` (layout.ts:177-179 iterates config slots before `resolveLayout` filters), so retiring in place passes the "registered but never placed" check (layout.ts:213-215). All widened spans are legal: the layout may widen freely and only clamps below `minSize` (layout.ts:138-148); book (minSize rail), attention-queue (minSize half), and radar (minSize rail) all accept span 12. market-intelligence keeps its default full. No registry sizing edits are required for this config.

What merges, what dies:

- `todays-brief` DIES as a module. Redistribution of its unique content: KPI strip -> Zone 1 strip (value, day, grade already live there; ACTIONS is replaced by the queue's own open count, resolving RD-07/NI-04 by leaving exactly one count); AI verdict sentence -> Zone 2 caption, one sentence, linked to the full note route; movers line -> already owned by the book's contributors (RD-12); regime chip -> Zone 1 strip; CTA row -> dies entirely (the queue is on screen; a button that scrolls to it is vestigial); Resume pill -> global nav or activity surface, not this page's hero.
- `ai-investment-brief` DIES from this page. It returns only if/when 05's LQ fixes give it non-duplicative content, and then as a linked page or a context-shelf entry, not a default group.
- `book` MERGES UP into Zone 1 and reflows horizontally (same module id, same digest slices, new internal layout at span 12; keep the id so module-map, registry, and tests are untouched). Content cap per the steelman: health ring, day P&L, XIRR with its always-on qualifier (NI-03), cash, one sparkline, contributors WITH residual row (NI-01/NI-06). The XIRR-vs-90d pair collapses per 02's map (F20/F21: chart stays, XIRR becomes its caption).
- `attention-queue` stays, full width, minus the signals feeder (delete/gate the `seedsFromSignals` call at digest.ts:264) and with the threat/action dedupe fix (shared story key, per 02 F11) so the spotlight is the ACTION, not the threat restatement.
- `radar` stays as the sole owner of signals (02 map F7-F11), compact horizontal tile row at span 12, collapsible; queue dismissals of a symbol must mark its radar tile (the all-clear decoupling in section 2).
- `whats-changed` stays, promoted, and switches from restating to referencing (RD-06: "2 new ideas -> Radar" instead of four per-symbol chips).
- `market-intelligence` stays, defaultCollapsed; its 60s interval should pause while collapsed (registry refresh policy note, registry.ts:164-165).

### Migration note (position lives in lib/home/layout.ts, and only there)

Step 0, one file, ship first: a pure layout.ts edit that captures ~70% of the IA value with zero module changes. Reorder groups to `changes, command, attention, tape, note`; add `collapsible: true, defaultCollapsed: true` to the tape slot; set `visible: false` on the long read slot. No module, engine, or route is touched; validateHomeComposition passes as argued above. This step alone moves question 1 above the fold and removes the two worst px-per-fact surfaces from the default view.

Step 1, module work, in any order behind step 0: (a) book strip variant; (b) queue signals-feeder removal + threat/action dedupe (server-side, digest.ts/attention.ts); (c) whats-changed reference chips + AI one-liner slot; (d) radar compact row + dismissal propagation.

Step 2, the final config above: flip `command` out, `state/delta/queue/context/retired` in. This is again a layout.ts-only change because every module variant from step 1 shipped behind its existing module id. Registry edits at this step are limited to non-positional metadata: retire priorities so book=1, whats-changed=2, attention-queue=3 for paint order (registry.ts priorities), and update the two dead modules' definitions only when they are actually deleted (types.ts `HomeModuleId`, module-map, registry, layout, in that order, per the registry's own four-step recipe, registry.ts:11-16).

Rollback at every step is a one-file revert of layout.ts.

---

## 6. Findings

**IA-01 (high). The page's only executable decision sits at 62% of page height, two viewports below the fold, while the fold is spent on restatement.** At 1440x900 the fold cuts at the brief's CTA row (~y 850-900 of 2942); above it: KPI strip, a 34 px AI sentence restating two of those KPIs, prose restating the cash story, and a book rail duplicating two hero KPIs. The trim-cash ACTION row renders at ~y 1835; the queue itself starts at ~y 1090. Evidence: shots/baseline/1440.png (measurements section 1); layout.ts:66-122; attention-queue row order per digest sample (02 F11).

**IA-02 (high). The largest text on the page is a model-written restatement of on-screen stats.** `text-[34px]` verdict (todays-brief.tsx:325) vs the h1 "Today"; content-wise sentence 1 restates the regime chip and breadth, sentence 2 restates KPIs 2 and 3 (05-llm-quality.md section 3). Altitude is allocated to the least novel content above the fold. Evidence: todays-brief.tsx:270-327; 1440.png.

**IA-03 (high). The reading order inverts the question order, and the code comments admit it.** "Since Last Visit" answers the returning user's first question from position 3, below the fold; layout.ts:81-83 states this is "the first question a returning user actually asks" while the config places two groups above it. The brief (position 1) answers "what is the market narrative", the user's third or fourth question. Evidence: layout.ts:68-101; section 4 mismatches M1-M3.

**IA-04 (high). The attention row's rail duplicates its primary exactly, and their states can contradict.** The radar's five tiles and the queue's five SIGNAL rows are one array rendered twice (02 section 2, RD-02: digest.ts:264 and digest.ts:289-293 -> radar.tsx:174/249); dismissals apply only to the queue, so an emptied queue sits beside a full radar of the same items. Evidence: shots/states/all-clear-queue.png; layout.ts:93-101; 02-redundancy.md section 2.

**IA-05 (medium). The hero's primary CTA is an in-page scroll to a differently named, below-fold surface.** "Open Action Center" (todays-brief.tsx:372-378) -> `scrollIntoView` (todays-brief.tsx:48-50) -> `id="action-center"` on a card headed "Attention, 19 open" (attention-queue.tsx:610), after a KPI reading "ACTIONS 1". The page's top-of-hierarchy button exists to escape the hierarchy, and its label chain is broken at both ends. Evidence: NI-04; RD-07.

**IA-06 (medium). The long read holds a full layout group for content that is ~80% restatement of the top of the page, by the same model call.** Collapsed it costs ~145 px for a header and an unconditional "AI GENERATED" badge; expanded it scores ~365 px per new fact. The group description on screen admits the duplication ("written from the same data as the brief above", layout.ts:112). Evidence: RD-03; 05 sections 2-4; registry.ts:185-206; 1440.png.

**IA-07 (medium). The tape interleaves reference material into the action path.** Position 4, 584 px, between the queue and the exit; no queue item depends on it; it duplicates `/wire`, which both it and the radar navTarget to (registry.ts:151, 180). It is also the only live-refreshing module (registry.ts:164-165) placed where the ritual is already over. Evidence: layout.ts:102-108; 02 section 3 table.

**IA-08 (medium). The layout is state-blind; empty states keep full-strength hierarchy.** New user: hero keeps 8/12 with a filled primary CTA over "ACTIONS 0" and a "Resume: RELIANCE.NS" pill; empty queue keeps 7/12 beside an empty radar rail. All-clear: ~1000 px empty queue card beside five populated radar tiles. `visible` is static config (layout.ts:30-31); no mechanism exists for digest-state-conditional layout. Evidence: shots/states/new-user.png; shots/states/all-clear-queue.png.

**IA-09 (low). The command row's spans invert information ownership.** The 4/12 book rail holds the page's only non-restated portfolio facts (F20/F21/F22) and its richest renderings of health and day P&L; the 8/12 hero holds duplicates and prose. Rail-width compression is a contributing cause of the vs-SPY double-take (RD-08). Evidence: 02 fact table F3/F4/F16-F22; layout.ts:71-79; book.tsx:262-345.

**IA-10 (low). At 2560 the row-height coupling pads the hero with dead space.** The command row's columns are equal height; at ultrawide the hero stretches to match the book and opens a visible blank band between the prose and the movers row, giving the page's most prominent card the most prominent emptiness. Evidence: shots/baseline/2560.png; 1440.png shows the same gap at smaller scale.

**IA-11 (low). On mobile the stack order places the radar's five duplicate tiles immediately after the queue's five identical rows.** One column, ~2 consecutive viewports of the same five facts twice, mid-page, with the tape and long read still to come below. Evidence: shots/baseline/390.png; SIZE tokens collapse all rails to sm:12 (types.ts:60-71).

**IA-12 (info). The IA is documented only in code comments; on the page, the structure is invisible.** Only the `note` group has a visible label (layout.ts:111); `command`, `changes`, `attention`, and `tape` render unlabeled, so the reading order argued in layout.ts:57-64 is never signposted to the user who is supposed to follow it. Evidence: module-grid.tsx:64-69 (labels render only when present); 1440.png.

---

Cross-references: fold and altitude findings feed the chosen restructure in section 5; IA-04/IA-11 are the positional face of RD-02; IA-05 is the positional face of NI-04; IA-06 depends on 05's LQ fixes before the long read can re-earn a slot. 03-decision-utility.md, once written, should validate the queue ranking that restructure B leans on (02 forwards DU-01/DU-03/DU-04).
