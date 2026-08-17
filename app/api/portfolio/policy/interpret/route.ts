/**
 * POST /api/portfolio/policy/interpret — { text, portfolioId? }
 *
 * Free text → a PROPOSED structured policy patch. The contract that keeps AI
 * subordinate to the policy engine:
 *
 *   1. The model returns a PolicyPatch-shaped proposal plus the parts of the
 *      text it could NOT map to anything measurable (`unmappable`, stated —
 *      never silently dropped).
 *   2. This route VALIDATES the proposal field-by-field against the policy
 *      vocabulary (unknown fields dropped, numbers clamped by the same
 *      parseInvestorPolicy bounds) and returns it for REVIEW, with a
 *      plain-language line per effect (describePolicyPatch).
 *   3. Nothing is saved here. The editor renders every line; the investor
 *      applies (merging into the DRAFT via applyPolicyPatch) and then saves —
 *      two explicit human actions between prose and a live policy.
 *
 * The model never sees a score, never returns a score, and cannot invent a
 * field this route doesn't whitelist. If AI is unavailable the route says so
 * and NOTHING about the policy changes.
 */
import { NextResponse } from "next/server";
import { runPrompt } from "@/lib/ai";
import { AllModelsFailedError } from "@/lib/ai/router";
import { aiUnavailableMessage } from "@/lib/ai/availability";
import { extractJson } from "@/lib/json-extract";
import { loadInvestorPolicy } from "@/lib/portfolio/alignment/store";
import {
  ALIGNMENT_THEMES,
  describePolicy,
  describePolicyPatch,
  type AlignmentThemeId,
  type InvestorGoal,
  type PolicyHorizon,
  type PolicyPatch,
  type PriorityLevel,
} from "@/lib/portfolio/alignment/policy";
import { listRawHoldings } from "@/lib/portfolio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOALS: InvestorGoal[] = ["growth", "balanced", "income", "preservation"];
const HORIZONS: PolicyHorizon[] = ["short", "medium", "long"];

function clampNum(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}

/** Whitelist-validate the model's proposal into a PolicyPatch. Anything unknown is dropped. */
function sanitizePatch(raw: unknown, heldSymbols: Set<string>): { patch: PolicyPatch; dropped: string[] } {
  const dropped: string[] = [];
  const patch: PolicyPatch = {};
  if (!raw || typeof raw !== "object") return { patch, dropped };
  const r = raw as Record<string, unknown>;

  if (r.goal !== undefined) {
    if (GOALS.includes(r.goal as InvestorGoal)) patch.goal = r.goal as InvestorGoal;
    else dropped.push(`goal "${String(r.goal)}"`);
  }
  if (r.horizon !== undefined) {
    if (HORIZONS.includes(r.horizon as PolicyHorizon)) patch.horizon = r.horizon as PolicyHorizon;
    else dropped.push(`horizon "${String(r.horizon)}"`);
  }

  if (r.priorities && typeof r.priorities === "object") {
    const out: Partial<Record<AlignmentThemeId, PriorityLevel>> = {};
    for (const [k, v] of Object.entries(r.priorities as Record<string, unknown>)) {
      if ((ALIGNMENT_THEMES as readonly string[]).includes(k)) {
        const lvl = clampNum(v, 0, 3);
        if (lvl != null) out[k as AlignmentThemeId] = Math.round(lvl) as PriorityLevel;
      } else dropped.push(`priority "${k}"`);
    }
    if (Object.keys(out).length > 0) patch.priorities = out;
  }

  if (r.tolerances && typeof r.tolerances === "object") {
    const t = r.tolerances as Record<string, unknown>;
    const out: PolicyPatch["tolerances"] = {};
    const num = (key: string, lo: number, hi: number) => {
      if (t[key] === undefined) return undefined;
      const v = clampNum(t[key], lo, hi);
      if (v == null) dropped.push(`tolerance "${key}"`);
      return v ?? undefined;
    };
    const maxPositionPct = num("maxPositionPct", 2, 100);
    const maxDrawdownPct = num("maxDrawdownPct", 5, 95);
    const liquidityFloorPct = num("liquidityFloorPct", 0, 100);
    const incomeYieldPct = num("incomeYieldPct", 0, 15);
    if (maxPositionPct != null) out.maxPositionPct = maxPositionPct;
    if (maxDrawdownPct != null) out.maxDrawdownPct = maxDrawdownPct;
    if (liquidityFloorPct != null) out.liquidityFloorPct = liquidityFloorPct;
    if (incomeYieldPct != null) out.incomeYieldPct = incomeYieldPct;
    if (Array.isArray(t.cashRangePct) && t.cashRangePct.length === 2) {
      const lo = clampNum(t.cashRangePct[0], 0, 100);
      const hi = clampNum(t.cashRangePct[1], 0, 100);
      if (lo != null && hi != null) out.cashRangePct = lo <= hi ? [lo, hi] : [hi, lo];
    }
    if (Array.isArray(t.growthBandPct) && t.growthBandPct.length === 2) {
      const lo = clampNum(t.growthBandPct[0], 0, 100);
      const hi = clampNum(t.growthBandPct[1], 0, 100);
      if (lo != null && hi != null) out.growthBandPct = lo <= hi ? [lo, hi] : [hi, lo];
    }
    if (Object.keys(out).length > 0) patch.tolerances = out;
  }

  if (Array.isArray(r.addExceptions)) {
    const out: NonNullable<PolicyPatch["addExceptions"]> = [];
    for (const e of r.addExceptions as unknown[]) {
      if (!e || typeof e !== "object") continue;
      const ex = e as Record<string, unknown>;
      const symbol = typeof ex.symbol === "string" ? ex.symbol.trim().toUpperCase().slice(0, 12) : "";
      const cap = clampNum(ex.maxPositionPct, 2, 100);
      if (!symbol || cap == null) continue;
      // An exception for a symbol the investor does not hold is almost always
      // a hallucination; state it instead of applying it.
      if (heldSymbols.size > 0 && !heldSymbols.has(symbol)) {
        dropped.push(`exception for ${symbol} (not held)`);
        continue;
      }
      out.push({ symbol, maxPositionPct: cap, note: typeof ex.note === "string" && ex.note.trim() ? ex.note.trim().slice(0, 200) : null });
    }
    if (out.length > 0) patch.addExceptions = out;
  }

  if (Array.isArray(r.removeExceptionSymbols)) {
    const out = (r.removeExceptionSymbols as unknown[])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().toUpperCase().slice(0, 12));
    if (out.length > 0) patch.removeExceptionSymbols = out;
  }

  return { patch, dropped };
}

export async function POST(request: Request) {
  let body: { text?: unknown; portfolioId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
  if (text.length < 8) {
    return NextResponse.json({ error: "Describe what you want in a sentence or two (at least 8 characters)." }, { status: 400 });
  }

  const portfolioId = Number.isFinite(Number(body.portfolioId)) ? Number(body.portfolioId) : 1;
  const current = loadInvestorPolicy(portfolioId);
  const heldSymbols = new Set(
    listRawHoldings()
      .map((h) => h.symbol?.trim().toUpperCase())
      .filter((s): s is string => !!s),
  );

  const prompt = `You translate an investor's own words into a STRUCTURED portfolio-policy patch. You do not judge the portfolio, do not compute any score, and do not invent rules the investor did not state.

THE INVESTOR'S CURRENT POLICY (their existing settings — patch only what their text changes):
${describePolicy(current)}

SYMBOLS THE INVESTOR HOLDS: ${[...heldSymbols].join(", ") || "(none on record)"}

THE INVESTOR WROTE:
"${text}"

Map their words onto ONLY these fields (omit everything their text does not address):
- goal: "growth" | "balanced" | "income" | "preservation"
- horizon: "short" (<3y) | "medium" (3-10y) | "long" (10y+)
- priorities: { structure|resilience|concentration|liquidity|income|inflation|exposure: 0-3 } — 0 means "report as fact, don't score"; 3 = top priority
- tolerances: { maxPositionPct (2-100), maxDrawdownPct (5-95), liquidityFloorPct (0-100), cashRangePct [lo,hi], incomeYieldPct (0-15), growthBandPct [lo,hi] }
- addExceptions: [{ symbol, maxPositionPct, note }] — ONLY for a specific held position the investor deliberately allows above the general cap ("my NVDA position is intentional, up to 30%")
- removeExceptionSymbols: [symbols]

Anything in their text that cannot be expressed in these fields goes into "unmappable" as a short quote — NEVER approximate it into a number they didn't say.

Respond with JSON only:
{"patch": { ...only the fields their text justifies... }, "summary": "<one sentence restating what you understood, in plain language>", "unmappable": ["<verbatim-ish fragment>", ...]}`;

  let responseText = "";
  try {
    responseText = await runPrompt("portfolio-intelligence", prompt, { json: true, timeoutMs: 120_000 });
  } catch (e) {
    if (e instanceof AllModelsFailedError) {
      return NextResponse.json(
        { error: aiUnavailableMessage("Policy interpretation"), code: "ai_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed" }, { status: 502 });
  }

  let parsed: { patch?: unknown; summary?: unknown; unmappable?: unknown };
  try {
    parsed = extractJson(responseText);
  } catch {
    return NextResponse.json({ error: "The interpretation didn't come back in a usable shape. Try rephrasing." }, { status: 502 });
  }

  const { patch, dropped } = sanitizePatch(parsed.patch, heldSymbols);
  const unmappable = [
    ...(Array.isArray(parsed.unmappable)
      ? (parsed.unmappable as unknown[]).filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim().slice(0, 200))
      : []),
    ...dropped.map((d) => `Could not apply: ${d}`),
  ].slice(0, 10);

  const effects = describePolicyPatch(patch);
  if (effects.length === 0 && unmappable.length === 0) {
    return NextResponse.json({
      patch: {},
      effects: [],
      summary: "Nothing in that text maps to a measurable policy setting.",
      unmappable: [],
    });
  }

  return NextResponse.json({
    patch,
    /** One plain-language line per proposed change — exactly what the user approves. */
    effects,
    summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 300) : "Proposed policy changes from your description.",
    unmappable,
  });
}
