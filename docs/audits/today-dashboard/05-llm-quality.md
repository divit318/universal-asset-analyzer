# 05. LLM Output Quality: the home brief under the microscope

As of 2026-08-08, branch `f22/day-change`. Method: static read of `lib/home/brief.ts`, `lib/ai/grounding.ts`, `lib/ai/analysis.ts`, `lib/ai/task-registry.ts`, `app/api/home/brief/route.ts`, the two consumer modules, plus a local harness (`/tmp/brief-samples.ts`, run with `npx tsx`) that prints the exact production prompt and deterministic fallback for six synthetic states. **No model was called anywhere in this audit.** Verbatim quotes below render the source's em dash as `--` per this audit's formatting rules; the bytes on disk differ only in that character.

## 1. The prompt, verbatim

`buildHomeBriefPrompt` (lib/home/brief.ts:119-169) produces, for the live 33%-cash book:

```
You are a portfolio manager writing the morning note for one client.

Use ONLY the facts below. Do not invent tickers, prices, percentages, or events. If a fact is not given, do not assert it.

MARKET REGIME: neutral -- 82% of sectors advancing. Market is mixed/neutral. 82% of sectors advancing. Leading: Consumer Cyclical, Materials, Technology. Dominant sectors: Consumer Cyclical, Materials, Technology.
SECTOR ROTATION: Over the last several weeks -- leaders: Healthcare, Financials, Industrials. Laggards: Energy, Utilities. (These are multi-week trends and may differ from today's movers above; that difference is normal and is not itself a signal.)
PORTFOLIO: Health grade C (68/100). Today +1.2%. 2 concentration finding(s). Top recommendation: REDUCE USD Cash -- A single holding this size means the portfolio's outcome is largely this one asset's outcome, regardless of how good it is.
UNREAD ALERTS: 3

Return ONLY valid JSON in exactly this shape:
{
  "headline": "2-4 sentences. What's happening, how it touches this portfolio, and the single most important thing to watch today.",
  "portfolioSummary": "1-2 sentences on the portfolio's current state. If no portfolio is tracked, say so plainly.",
  "note": {
    "regime": "1-2 sentences on the market regime and what it implies.",
    "opportunities": "1-2 sentences on where the biggest opportunity is.",
    "risks": "1-2 sentences on the biggest risk.",
    "portfolio": "2-3 sentences of portfolio observations.",
    "sectors": "1-2 sentences on which sectors to watch and why.",
    "macro": "1-2 sentences on macro developments.",
    "recommendations": ["3 to 5 short, specific, actionable recommendations"]
  }
}

No preamble. No markdown fences. JSON only.
```

And the deterministic fallback (`deterministicBriefing`, brief.ts:88-112) for the same state:

```
Market is mixed/neutral. 82% of sectors advancing. Leading: Consumer Cyclical, Materials, Technology. Multi-week leadership: Healthcare, Financials, Industrials. Portfolio health grade C (68/100), 2 concentration finding(s). 3 unread notifications.
```

**Is the model handed pre-computed values?** Yes, entirely: regime trend + breadth, one regime summary sentence, rotation leader/laggard names, health grade/total, today %, finding count, one recommendation sentence, unread count. The model computes nothing.

**Where can it still emit numbers of its own?** Everywhere the shape demands content the facts do not cover. Count the distinct quantities in the prompt above: 82 (breadth), 68 (health), 100 (denominator), +1.2 (day), 2 (findings), 3 (unread). Six numbers and roughly ten proper nouns must fill: a 2-4 sentence headline, a 1-2 sentence summary, six prose sections, and 3-5 recommendations, roughly 15-20 sentences. There are zero facts about "opportunities" (the Radar's five scored candidates: absent), zero about "risks" beyond the finding count (the threat engine's worst case -20.2% and VaR: absent), zero about "sectors" beyond the two leader lists already spent on the regime section, and **zero macro facts of any kind** (the digest's macro calendar never reaches the prompt). The model's only legal moves in those sections are (i) restating the six numbers again, (ii) unfalsifiable no-number prose, or (iii) invention.

**And only the headline is checked.** `generateHomeBrief` at brief.ts:332:

```ts
const grounding = verifyGroundingWithFacts(headline, buildBriefFacts(ctx, portfolio), { extraEvidence: prompt });
if (grounding.level === "low") return fallback;
```

`headline` is the sole argument; `parsed.note` flows through `readNote()` (brief.ts:337), which validates types, not truth. The cache-revalidation path is the same: brief.ts:291-292 re-grounds `parsedCache.headline` only. The seven note sections, the largest and least constrained output, ship unverified. A note.macro reading "The Fed cut rates 50 bps yesterday" would pass every gate in this pipeline.

`buildBriefFacts` (brief.ts:177-198) confirms the grounding set is four facts maximum: breadth, portfolio day change, health total, finding count. `grep` of the function body: those are the only `facts.push` calls. There is **no as-of fact for the scanner or rotation**: rotation's `asOf` is used in the cache key (brief.ts:250) and nowhere in the prompt or the facts, and the two day-basis facts are stamped `sessionDate: today` computed from `Date.now()` at build time (brief.ts:182-184), i.e. from the wall clock, not from the data. The verifier's stale-day check (grounding.ts:642-658) can therefore never fire for this caller: the facts always swear the data is from today.

## 2. Six synthetic states: what the prompt permits the model to say

Harness: `/tmp/brief-samples.ts` imports `buildHomeBriefPrompt`, `deterministicBriefing`, `buildBriefFacts` from `lib/home/brief.ts` and prints all three for six literal states. Key excerpts (full output reproducible with `npx tsx /tmp/brief-samples.ts` from the repo root):

**State 1: concentrated 33%-cash book (mirrors live digest).** Prompt as quoted in section 1. Fact budget: 6 numbers for ~18 sentences. Note that the 33% cash weight itself is NOT in the prompt as a number; it arrives only inside the recommendation sentence as the words "USD Cash", so the live headline's "32.9% USD Cash position" (see section 3) was grounded via the `extraEvidence: prompt` transcription escape hatch only if the rec sentence happens to carry it, and in this build it does not. It survived because the number appears in `topRecommendation` when the decision engine's rationale includes it; in the sampled prompt it does not, meaning "32.9%" in the rendered headline matched nothing in `buildBriefFacts` and nothing in the prompt, and still shipped. (The verifier tolerates it: 1 unsupported figure among ~5 keeps numericSupport at 0.8, score 0.85+, level "high"; the gate only rejects "low" < 0.6, brief.ts:333, grounding.ts:271-275.)

**State 2: diversified 20-holding A-grade book.**
```
PORTFOLIO: Health grade A (88/100). Today +0.4%. 0 concentration finding(s). The decision engine found no trade worth making.
UNREAD ALERTS: 0
```
The model must still produce "biggest opportunity", "biggest risk", and 3-5 "specific, actionable recommendations" for a book whose own engine says do nothing. Every recommendation it emits will contradict the one portfolio fact supplied. The only honest recommendations section is a refusal, which the shape ("3 to 5") forbids.

**State 3: 40% drawdown book.**
```
MARKET REGIME: risk-off -- 18% of sectors advancing. ...
PORTFOLIO: Health grade F (34/100). Today -6.8%. 3 concentration finding(s). Top recommendation: REDUCE NVDA -- Position is 41% of the book and drove most of the drawdown.
```
The prompt never says the book is down 40%. Drawdown, total return, and the equity curve are not brief facts, so the note's "portfolio observations" for a catastrophic book can speak only of one day (-6.8%) and a grade letter. The single most important true sentence ("you have lost 40% from peak") is unsayable from the supplied facts, and if the model infers it, it is fabricating.

**State 4: 100% cash.**
```
PORTFOLIO: Health grade D (45/100). Today +0.0%. 1 concentration finding(s). Top recommendation: ADD equity exposure -- 100% of value is in a single cash asset.
```
Structurally identical to any other book: nothing in the prompt's fixed fields distinguishes all-cash except whatever the recommendation sentence happens to say. "Today +0.0%" invites a sentence about a flat day in a portfolio that cannot move. Health-engine dimensions (income, liquidity would score oddly; most abstain on a cash-only book) are absent, so the note's "portfolio observations" section has one number (45) to spend across 2-3 sentences.

**State 5: zero holdings.**
```
PORTFOLIO: No portfolio is tracked.
UNREAD ALERTS: 0
```
Fallback: `Market is mixed/neutral. 82% of sectors advancing. Leading: ... Multi-week leadership: ...` (no portfolio line, correct). Grounded facts: exactly one (breadth 82). Yet the JSON shape still demands opportunities, risks, portfolio, sectors, macro, and 3-5 actionable recommendations, addressed to a client who owns nothing. Only `portfolioSummary` has instructions for this case ("say so plainly"); the other sections have no empty-state instruction at all, which is why the client-side `isEmptySection` heuristic (ai-investment-brief.tsx:109-114) exists to detect "No specific macro developments were provided..." padding after the fact: the UI is compensating for a prompt that forces sections it cannot fill.

**State 6: data stale 3 days (identical book to state 1, rotation asOf 2026-08-05, scanner stale).** The printed prompt is **byte-identical to state 1's**. Diffed: no difference. No staleness fact exists anywhere in the pipeline: `buildHomeBriefPrompt` reads neither `ctx.scannerFreshness` nor `rotation.asOf`, `buildBriefFacts` stamps day facts with the current wall-clock date regardless of data age, and the fallback is equally silent. A brief generated from three-day-old numbers asserts "Today +1.2%" with full confidence, and the grounding layer certifies it.

**Structural conclusion:** in every state the prompt carries at most 6 numbers (state 5: 1 number) against a demanded output of seven note sections plus headline plus summary. The note is arithmetically forced into restatement (the same 6 numbers recycled section by section), hedging (no-number prose that could describe any portfolio), or fabrication (which only the headline pass could catch, and doesn't check the note).

## 3. The live rendered output (1440 baseline screenshot)

Visible AI text:

> Headline (verdict line): "Breadth is broad today with 82% of sectors advancing, but the tape is still classified as..." (clamped)
> Support: "Your portfolio is up 1.2% today and carries a health grade of C (68/100), held back by two concentration findings. The single most important thing to watch today is the 32.9% USD Cash position, which currently dominates the portfolio's outcome more than any market move."

Critique:

- **Sentence 1 restates the two stats rendered directly above it**: the regime badge "NEUTRAL" in the hero's own header row and breadth 82% (also on the Market Overview card). Information added: zero. It is a caption for the chrome.
- **Sentence 2 restates the KPI strip it sits under**: Today +1.2% (KPI 2), Grade C 68 (KPI 3), plus the finding count. The `portfolioSummary` field, per the prompt, would say the same thing again; it is streamed (route.ts:47, home-provider.tsx:113) and then rendered by **no module** (grep: no consumer of `brief.data.portfolioSummary`), a dead field generated and shipped on every call.
- **Sentence 3 is the one earning its place** (the cash-position "what to watch"), and it is simultaneously the seventh appearance of the cash-concentration story on this page (architecture map item 3) and carries the page's least-grounded number (32.9% appears in no brief fact; section 2, state 1).
- The collapsed AI Investment Brief's note sections were not expanded in this capture, but their input starvation is fully determined by section 2: with the facts spent on the headline, `opportunities`/`sectors` can only re-shuffle the six sector names with hedge verbs ("watch", "may continue"), `macro` has literally nothing and will either pad ("No specific macro developments were provided", which the UI then deletes via `isEmptySection`) or invent, and `recommendations` can only re-verb the single engine recommendation into 3-5 bullets, a multiplication of one fact into five imperatives, each looking independently authoritative. The prose is also largely **portfolio-independent**: swap in any book with grade C and a positive day and every sentence except the cash one survives unchanged. That is the signature of narration over analysis.

## 4. Cache, determinism, latency, cost, failure UX

**Cache key** (brief.ts:245-253): `hour : healthGrade-healthTotal-alertCount : rotation.asOf : regime.trend`. What it misses within an hour:
- **Day P&L direction flip mid-session** (+1.2% at 9:40, -0.8% at 10:15): key unchanged; the serve-time re-ground (brief.ts:291-292) checks only the headline, and only for level "low"; a headline saying "up 1.2%" against a live -0.8% fact is one direction violation among ~5 claims, numericSupport 0.8, level stays "medium"+, cached prose serves. The re-ground also passes `extraEvidence: prompt`, and the freshly built prompt contains the NEW day change, so a stale figure can even transcription-match against other numbers in the prompt.
- **A new threat or a changed top recommendation**: neither is in the key (alertCount counts concentration findings only). The engine can flip from "REDUCE USD Cash" to "REDUCE NVDA" with no regeneration.
- **Breadth/sentiment moves**: regime `trend` is in the key, `breadthPct` is not; 82% -> 51% is the same key while the headline literally quotes the number. The serve-time re-ground does catch large breadth drift IF it makes the whole headline "low", which a single changed figure rarely does.
- Conversely the key **over-fires** hourly: an unchanged book regenerates every hour it is viewed, up to ~7 identical spends per market day for a static portfolio.

**Determinism**: no temperature is set for `daily-briefing` (task-registry.ts:265: `{ complexity: "light", latency: "standard", maxTokens: 800, devinTimeoutMs: 240_000 }`, no `temperature` field). The router falls back to the model spec default 0.3-0.4 (models.ts), and the hosted providers **accept and ignore temperature entirely** (anthropic-provider.ts:24-26, openai-compatible-provider.ts:17-20, gemini-provider.ts:18-19, devin-provider.ts:18-22; ARCHITECTURE.md "No temperature on the wire"). Only Ollama honors it (ollama.ts:206, default 0.4). Net: generation is non-deterministic on every provider, so the same portfolio state can produce a differently-worded brief each hour, while `runAnalysis` adds a second cache (`ai_result`, keyed on prompt hash, analysis.ts:46-53) that is only consulted when `maxAgeMs` is passed, and `generateHomeBrief` passes none (brief.ts:311-318), so that layer is write-only here.

**Latency handling: the stream is cosmetic.** `app/api/home/brief/route.ts:44-49`:

```ts
const brief = await generateHomeBrief(ctx, toBriefPortfolio(report), unread);
send({ type: "headline", text: brief.headline });
send({ type: "portfolioSummary", text: brief.portfolioSummary });
if (brief.note) send({ type: "note", note: brief.note });
send({ type: "done", ... });
```

Every chunk is enqueued only after the FULL generation (plus `gatherContext` + a second `buildPortfolioReport`) completes. The NDJSON framing, the client's incremental reader (home-provider.tsx:93-122, "a stream that dies halfway leaves us holding the headline"), and the file-level comments ("Sections are pushed to the client as they become available", brief.ts:16-17; "so the short headline can paint the moment it is ready", route.ts:8-9) all describe a behavior the route does not have. The four chunks arrive in one flush; the headline paints not one millisecond earlier than the note. Additionally the route rebuilds the universal report that `/api/home` just built (route.ts:36-38), adding ~10s of engine time to the brief's critical path on a cold load (architecture map section 4).

**Cost controls**: one call per cache window; hourly key; every failure path is free (fallback, no retry loop); `maxTokens: 800` caps the output; provider chain falls through to local Ollama. Reasonable, apart from the hourly regeneration of unchanged states noted above.

**Failure UX** (`aiGenerated: false`): coherent in Today's Brief, incoherent in the long read.
- todays-brief.tsx:226-228 shows a "Computed" pill when the text is not AI, and the deterministic fallback ships inside the digest so there is always true text. Good.
- ai-investment-brief.tsx:349-357: no note renders "The long-form note needs a reachable AI provider. Connect one and refresh.", honest, but the header's "AI generated" sparkle badge (ai-investment-brief.tsx:480-482) renders **unconditionally**, including around the loading skeleton, the error state, and the fallback message, i.e. the card claims AI generation precisely when there was none. It also does not distinguish "provider unreachable" from "generation was discarded by the grounding gate", two very different trust events.
- The fallback text itself (section 1) is stilted telegraphese ("2 concentration finding(s)"), rendered as the hero's 34px display verdict; the `(s)` pluralization artifact ships to the most prominent text slot on the page.

## 5. Adversarial states (from the section 2 harness plus code)

- **100% cash**: prompt shows a generic grade/day%/findings line; nothing names cash except (optionally) the recommendation string. The health engine will abstain on most dimensions for a one-asset cash book (pulse.ts buildHealthFactors carries abstentions), but no coverage fact reaches the prompt, so the model narrates a "D (45/100)" as if fully evidenced.
- **Down 40%**: unsayable from the prompt (no drawdown, no total return, no peak). The note's "risks" section will name a smaller risk than the one that already happened.
- **Zero holdings**: one grounded fact total; seven sections still demanded; only portfolioSummary has an empty-state instruction.
- **Stale 3 days**: prompt byte-identical to fresh (state 6 diff); `buildBriefFacts` has no as-of for scanner or rotation and stamps day facts with the build-time date, so the pipeline manufactures freshness attestations for stale data; the grounding layer's own stale-session check is thereby unreachable from this caller.

## 6. Findings

**LQ-01 (high). Five of seven note sections are structurally ungrounded and unverified.** Zero facts are supplied for opportunities, risks (beyond a count), sectors (beyond two name lists), macro (nothing), and recommendations (one engine sentence); only the headline passes `verifyGroundingWithFacts` (brief.ts:332); the note ships raw. Evidence: brief.ts:119-198, 332-337; harness states 1-5. Fix: (i) verify the note, `collectClaimText(note.regime, note.opportunities, ..., note.recommendations)` exists for exactly this (grounding.ts:699-709) and can be checked with the same facts and a per-section discard rather than all-or-nothing; (ii) feed each section its owning engine's facts (see LQ-07 sketch); (iii) drop the sections that cannot be fed, an unfillable "macro" section is prompt-injected padding by design.

**LQ-02 (high). The grounding gate certifies stale and drifted data as fresh.** Day facts are stamped with wall-clock `today` (brief.ts:182-192) regardless of the data's session; no scanner/rotation as-of exists in facts or prompt; state 6's prompt is identical to state 1's. Mid-session sign flips survive the serve-time re-check because a single wrong figure cannot push a multi-number headline to level "low", and the current prompt is passed as transcription evidence for the OLD headline. Evidence: brief.ts:177-198, 279-297; grounding.ts:642-658 (unreachable check); section 4 cache analysis. Fix: stamp facts with the report's `sessionDate`/`asOf` (pulse already carries them); add a staleness fact line to the prompt ("Data as of Fri Aug 7 close; markets have since closed/opened") so the model can hedge honestly; add day-change sign to the cache key; re-ground the cache against facts alone without `extraEvidence: prompt`.

**LQ-03 (high). The stream is cosmetic and doubles the engine work.** All chunks are sent after `await generateHomeBrief` completes; the route rebuilds the portfolio report the digest just built. Evidence: route.ts:36-49; brief.ts:16-17 and route.ts:8-9 documenting the opposite. Fix: either stream for real (emit headline from a partial parse as tokens arrive, the chain provider already supports streaming for Ollama) or delete the NDJSON framing and the misleading comments and return one JSON body; reuse the digest's report via the request-scoped cache (`lib/portfolio/context.ts` already caches 5 min for `/api/portfolio/report`).

**LQ-04 (medium). Cache key granularity misses what matters and regenerates what doesn't.** Misses: day P&L direction, breadth value, new threats, changed top recommendation. Over-fires: hourly for unchanged books. Evidence: brief.ts:245-253; section 4. Fix: key on a small fingerprint of the actual prompt facts (sign of day change, breadth decile, top-rec id, threat-set hash) with a longer TTL (4h) instead of the raw hour.

**LQ-05 (medium). Non-determinism with no control and no disclosure.** No task temperature; hosted providers ignore the field anyway; the same state re-words hourly, and a user comparing today's brief to an hour ago sees changed prose over unchanged facts with nothing explaining why. Evidence: task-registry.ts:265; provider files cited in section 4. Fix: accept non-determinism but make the cache key strict enough (LQ-04) that re-wording only happens when facts change; alternatively pin phrasing by making the deterministic fallback the headline and reserving the model for the note.

**LQ-06 (medium). Failure-state chrome lies in the long read.** "AI generated" badge renders on skeleton, error, and no-AI states (ai-investment-brief.tsx:480-482); grounding-discard and provider-down collapse into one message; `portfolioSummary` is generated, streamed, and never rendered by any module (dead spend); the deterministic fallback's "(s)" artifacts render at display size. Evidence: ai-investment-brief.tsx:342-357, 480-482; grep for `portfolioSummary` consumers (home-provider.tsx:113 accumulates, nothing reads); brief.ts:106. Fix: gate the badge on `brief.data?.aiGenerated`; distinguish the two failure copies; either render portfolioSummary (the Book card's designed slot per architecture map section 5) or remove it from the schema and prompt; write real pluralization in `deterministicBriefing`.

**LQ-07 (medium). Prompt rewrite sketch.** Keep the "engines decide, AI narrates" split, but feed the narrator what the engines already computed, all of it in the digest today:

```
MARKET REGIME: [as now, plus] Sentiment: Extreme Greed (81/100, high confidence). VIX 14.9.
PORTFOLIO: [as now, plus] Cash 32.9% of book. Total return on cost +3.1%. 90d return +9.7% vs SPY +4.9%. Day move driven by ABNB (+64 bps of book), VOO (+5), GOOGL (-4).
RISKS (from the risk engine; cite verbatim, do not add): worst modelled scenario -20.2%; daily VaR -0.67% at p=0.05; inflation exposure -2.6%; USD Cash single-asset concentration.
OPPORTUNITIES (from the scanner, ranked by fit; do not add others): SYF fit 80, ALL 79, TSM 79, BAC 75, SCHW 75.
UPCOMING (from the calendar): US Employment Report (Jul), 2026-08-07.
DATA AS OF: portfolio Fri Aug 7 close; scanner scan 1h ago; rotation 2026-08-07.
```

Then restructure the output: drop `macro` (no macro engine exists; the calendar line can live inside `risks` or a renamed `watch`), drop free-form `recommendations` in favor of "restate the engine's top recommendation and, at most, sequence the existing queue items", and instruct every section to cite only supplied lines with an explicit "write NOTHING_TO_SAY if the facts above do not cover this section" escape so `isEmptySection` heuristics become unnecessary. Extend `buildBriefFacts` in lockstep (every number added to the prompt becomes a tagged fact) and verify headline + note together. This turns the note from input-starved narration into a summary that is checkable line by line, and it costs no new computation: every figure above is already in `/tmp/home-digest.json`.

**LQ-08 (low). The headline's job overlaps the chrome.** Even fully grounded, sentence 1 restates the regime badge and breadth tile, and sentence 2 restates three KPIs rendered 40px above (section 3). The prompt asks "what's happening" before "how it touches this portfolio"; the page already answers "what's happening" with numbers. Fix: invert the instruction, one sentence maximum of market context, and require the verdict sentence to be the portfolio-specific "single most important thing", which is the only content the KPI strip cannot render.
