# Knowledge Graph: What This Feature Is For (Phase 2)

Five concrete questions the Knowledge Graph must answer. Every node class,
edge class, panel, and control must map to at least one; anything that maps to
none gets cut. Target: each job completable in under 30 seconds, unaided.

## J1 — Blast radius
"If this event happened, what in my book is exposed, through which route, and
how much?"
- Served by: market/timeline event nodes edged ONLY to entities that are
  materially about them or tracked by the user; edge evidence carries the
  route; position weights on asset nodes; path finding from an event to a
  holding.
- Cut test: an event edge to an entity the user does not track and that the
  story is not about serves nobody — dropped (KG-001/002/011/012 fixes).

## J2 — Hidden concentration
"Where am I concentrated without realising it, counting look-through into
funds?"
- Served by: correct book weights (cash fixed, KG-008), weighted OWNS edges,
  HOLDS edges from funds to disclosed underlyings, the look-through panel
  (promoted, full routes), sector concentration with combined weight.

## J3 — Connection with evidence
"How is entity A connected to entity B, and by what evidence?"
- Served by: find-path (ranked multi-path + deterministic chain + AI
  narration), edge inspector (evidence, confidence-or-Unknown, provenance,
  timestamp), hover cards.

## J4 — What changed, ranked by materiality
"What changed in my exposure network since I last looked?"
- Served by: the rebuilt delta feed — deduplicated (one story = one entry),
  per-entity capped, ranked by importance, timestamped, full text on hover,
  click focuses the node, +/− key explained.

## J5 — Adjacent but not owned
"What is adjacent to what I already own that I do not own?"
- Served by: opportunities panel with real labels (theme, direction, one-line
  rationale), sector-scope representative members (SPDR top holdings) not in
  the book, fund-disclosed underlyings held only via funds.

## What this feature is deliberately NOT
- Not a market-wide news browser: The Wire owns that. Events appear here only
  through their connection to the scoped entities.
- Not a prediction engine: every number is computed by an existing engine;
  AI only narrates over computed numbers, with enforced citations.
- Not a 2,000-node universe map: every scope is a bounded, answerable view.
  Density is calibrated per scope (~15-60 nodes), enforced at build time.

## Decisions taken against this frame
- Cash IS a node in portfolio scope (it is book weight and answers J2), typed
  "Cash", valued at face, with no sector/event edges.
- Rotation quadrant terms get a definition and a methodology line (they serve
  J4 weakly but users see them; jargon without definition is banned).
- "Density 0.03" serves no job — cut.
- Pan/zoom stay out of the URL; selection/focus/filters are in (J3/J4 sharing
  works; transform churn does not add answerability).
