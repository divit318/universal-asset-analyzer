# North star: what the Today page is for

## The one sentence

Today is the five-minute morning triage surface for a single self-directed investor running a real book: it tells them what changed, whether it touches their positions, and the single most valuable thing to do next, and then it gets out of the way.

## Who is using it

One person, most mornings, usually before or just after the US open, sometimes on a weekend when nothing is trading. They own the whole stack (this is a local-first, single-user terminal), they are numerate, they distrust unexplained numbers, and their scarce resource is attention, not information. They have other surfaces for depth: Research, Portfolio, The Wire, the Screener, the Journal. Today is not where analysis happens; it is where the day's work gets chosen.

## The daily ritual the page serves

1. Orient (5 seconds): is my book up or down, as of when, and is the market open. One stated clock.
2. Delta (15 seconds): what changed since I was last here that is material to MY positions. Not the market's day; my delta.
3. Triage (2 to 4 minutes): work a single ranked queue. Every item is either acted on (with the decision recorded), deliberately deferred (snoozed to a date or condition), or dismissed (and it stays dismissed). Reaching the end is an achievable, visible state.
4. Depart (5 seconds): jump into the one tool the chosen action needs, with context carried along.

Anything on the page that does not serve one of those four steps is decoration and must justify itself or leave.

## What every number owes the user

- One source: each fact is computed once, server-side, and every surface renders the same object. Two precisions of the same fact on one screen is a correctness bug.
- One clock: the page has a single authoritative as-of, and any figure on a different clock says so next to the number, not in a code comment.
- A window: no return without its period. "+68.6%" is not a fact; "+68.6% annualized (XIRR) since May 5" is.
- A provenance path: any figure can be interrogated in place: what produced it, from what inputs, as of when.
- Reconciliation: parts sum to wholes on screen, or the residual is shown. Attribution that cannot reach its own total admits the gap.

## What the AI is allowed to do

Narrate, never compute; select, never invent. Every sentence of machine prose must be traceable to an engine-produced fact that is on (or one click from) the screen. Prose that would read the same for any portfolio is spam and gets cut, not polished. When the model is unavailable the page must remain fully useful; the deterministic path is the product, the prose is seasoning.

## What the page deliberately refuses to do

- It does not repeat itself. One fact, one place, disclosure for depth.
- It does not perform urgency. No ambient motion, no counters ticking for effect, no red badges for things that can wait. A quiet day is reported as a quiet day; "nothing needs you" is an earned success state, never a fallback for an error.
- It does not pretend precision it does not have. An uncalibrated 67-vs-65 ranking renders as a band, not a number.
- It does not chase engagement. No infinite feeds, no generic market news, no content that exists to make the page feel full. Shorter is better.
- It does not duplicate the other tools. It links into them with context; it never re-implements them in miniature.
- It does not require the network to say true things. Offline or upstream-dead, it shows the last known state, honestly stamped, and says what is missing.

## The acceptance test

Open the page at 7am. Within thirty seconds you can say out loud: what moved, whether it matters to your book, and what you will do first. Every number you just read can be defended to another investor without opening a second tab. Nothing you read twice. When you have worked the queue to zero, the page says so plainly, and stops asking for your attention.
