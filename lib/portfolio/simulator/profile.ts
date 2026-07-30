/**
 * Intake profile validation — the one place raw client input becomes a
 * `SimProfile`. API routes call this and never assemble profiles by hand.
 */

import { OBJECTIVES, type Objective } from "@/lib/portfolio/engines/optimize";
import { PORTFOLIO_ASSET_CLASSES, type PortfolioAssetClass } from "@/lib/portfolio/model/types";
import {
  PREFERENCE_QUESTIONS,
  type PreferenceTopic,
  type SimPreferences,
} from "./preferences";
import {
  drawdownForRiskAppetite,
  type SimFollowUp,
  type SimHolding,
  type SimHorizon,
  type SimProfile,
  type SimRole,
} from "./types";

const HORIZONS: SimHorizon[] = ["short", "medium", "long"];
const ROLES: SimRole[] = ["standalone", "complement"];
const CURRENCY_RE = /^[A-Z]{3}$/;

export interface SimProfileInput {
  cash?: unknown;
  currency?: unknown;
  horizon?: unknown;
  targetDate?: unknown;
  objective?: unknown;
  riskAppetite?: unknown;
  maxDrawdownPct?: unknown;
  role?: unknown;
  complementRef?: unknown;
  preferences?: unknown;
}

const OTHER_MAX = 300;

/**
 * Validate the fixed multiple-choice answers against the question catalogue.
 *
 * Unknown topics and unknown option ids are DROPPED rather than rejected: an
 * option removed in a later revision of the catalogue would otherwise make every
 * saved profile containing it unloadable, and a stale id is a question the user
 * effectively did not answer — which is already a supported state with a
 * documented default. A genuinely malformed payload (wrong types) is still an
 * error, because that is a bug in the caller rather than a stale answer.
 */
export function parseSimPreferences(input: unknown): { preferences: SimPreferences } | { error: string } {
  if (input === undefined || input === null) return { preferences: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "preferences must be an object" };
  }
  const raw = input as Record<string, unknown>;
  const preferences: SimPreferences = {};

  for (const q of PREFERENCE_QUESTIONS) {
    const entry = raw[q.topic];
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== "object" || Array.isArray(entry)) {
      return { error: `preferences.${q.topic} must be an object` };
    }
    const a = entry as { optionIds?: unknown; other?: unknown };
    if (a.optionIds !== undefined && !Array.isArray(a.optionIds)) {
      return { error: `preferences.${q.topic}.optionIds must be an array` };
    }
    if (a.other !== undefined && a.other !== null && typeof a.other !== "string") {
      return { error: `preferences.${q.topic}.other must be a string or null` };
    }

    const valid = new Set(q.options.map((o) => o.id));
    const optionIds = [...new Set((a.optionIds ?? []).filter((id): id is string => typeof id === "string" && valid.has(id)))];
    // A single-select topic cannot hold two answers. Keeping the first is
    // arbitrary but bounded; keeping both would let the prompt state two
    // contradictory implications for one question.
    const trimmed = q.multi ? optionIds : optionIds.slice(0, 1);
    // The exclusive option ("No exclusions") wins outright, matching what the
    // form does when it is clicked — otherwise a stale payload could apply a
    // filter the user believes they cleared.
    const final = q.exclusiveId && trimmed.includes(q.exclusiveId) ? [q.exclusiveId] : trimmed;

    const other = q.allowOther && typeof a.other === "string" && a.other.trim()
      ? a.other.trim().slice(0, OTHER_MAX)
      : null;

    if (final.length > 0 || other) preferences[q.topic as PreferenceTopic] = { optionIds: final, other };
  }
  return { preferences };
}

/**
 * Normalize a profile deserialized from storage.
 *
 * ## The bug this exists for
 *
 * `preferences` was added to `SimProfile` as a REQUIRED field after simulations
 * had already been saved. `rowToSimulation()` deserializes with a bare
 * `JSON.parse` and a cast, so every row written before that change yields
 * `preferences === undefined` at runtime while the type insists otherwise — and
 * `generatePortfolio()` dereferences it on its first two lines
 * (`allowedClassesFor`, `candidateFilterFor`). The result was a `TypeError` on
 * the very first statement of generation for any pre-existing simulation, with a
 * "Try again" button that could never succeed.
 *
 * ## Why the boundary and not a migration
 *
 * A migration would have to be re-run for every future field, and would still
 * leave a `JSON.parse`-and-cast that lies about its output type. Normalizing
 * where the JSON becomes a `SimProfile` fixes the whole class once: every read
 * path in the app goes through `rowToSimulation`, so no caller can observe an
 * un-normalized profile. Nothing is written back, so no data is rewritten or
 * lost, and users never regenerate anything.
 *
 * ## What it does and deliberately does not default
 *
 * Only fields whose default INVENTS NOTHING are filled:
 *
 *   - `preferences` → delegated to `parseSimPreferences`, which returns `{}` for
 *     a missing value. `{}` is the canonical default: every consumer already
 *     treats an absent topic as "not answered" and applies the documented
 *     `defaultLabel`, which is exactly true of a row that predates the question
 *     being asked. `ProfileSummary` therefore shows all eight as "Assumed",
 *     which is honest rather than fabricated. Delegating keeps one source of
 *     truth for what a valid `SimPreferences` is.
 *   - `followUps` → `[]` only when it is not an array. A valid array is passed
 *     through UNTOUCHED rather than re-validated, because dropping a whole
 *     interview history over one malformed entry would lose real user data to
 *     fix a crash that never happened. Same failure class as `preferences`
 *     (`profileFacts`, `buildIntakePrompt`, `nextGap` and two components all
 *     dereference it unguarded), and an empty history is invention-free.
 *
 * The scalars — `cash`, `currency`, `horizon`, `objective`, `riskAppetite`,
 * `maxDrawdownPct`, `role` — are deliberately NOT defaulted. A row missing one
 * is genuinely corrupt, and substituting `cash: 0` or `objective: "balanced"`
 * would invent an investment mandate the user never stated and then design a
 * portfolio against it. Failing loudly is the correct behaviour there; quietly
 * coercing a missing financial input to a plausible-looking value is the exact
 * mistake `positionPerformance(lots, price ?? 0)` made.
 *
 * Idempotent by construction, so a modern row round-trips unchanged.
 */
export function normalizeStoredProfile(stored: SimProfile): SimProfile {
  // Cast to reflect what a historical row can actually contain, which is the
  // whole point: the declared type is what this function makes true.
  const raw = stored as SimProfile & { preferences?: unknown; followUps?: unknown };
  const prefs = parseSimPreferences(raw.preferences);
  return {
    ...stored,
    // A corrupt blob falls back to the canonical default rather than throwing —
    // an unreadable answer is an unanswered question, not a broken simulation.
    preferences: "error" in prefs ? {} : prefs.preferences,
    followUps: Array.isArray(raw.followUps) ? stored.followUps : [],
  };
}

/** Validate Step A quick-form input. Returns an error message or the profile. */
export function parseSimProfile(input: SimProfileInput): { profile: SimProfile } | { error: string } {
  const cash = Number(input.cash);
  if (!Number.isFinite(cash) || cash <= 0) return { error: "Investable cash must be a positive amount" };

  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "USD";
  if (!CURRENCY_RE.test(currency)) return { error: "Currency must be a 3-letter code (e.g. USD)" };

  const horizon = input.horizon as SimHorizon;
  if (!HORIZONS.includes(horizon)) return { error: "Time horizon must be short, medium or long" };

  const targetDate =
    typeof input.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.targetDate) ? input.targetDate : null;

  const objective = input.objective as Objective;
  if (!(objective in OBJECTIVES)) return { error: "Unknown objective" };

  const riskAppetite = Number(input.riskAppetite);
  if (!Number.isFinite(riskAppetite) || riskAppetite < 1 || riskAppetite > 10) {
    return { error: "Risk appetite must be between 1 and 10" };
  }

  const maxDrawdownPct = Number.isFinite(Number(input.maxDrawdownPct)) && Number(input.maxDrawdownPct) > 0
    ? Math.min(90, Number(input.maxDrawdownPct))
    : drawdownForRiskAppetite(riskAppetite);

  const role = ROLES.includes(input.role as SimRole) ? (input.role as SimRole) : "standalone";

  let complementRef: SimProfile["complementRef"] = null;
  if (role === "complement" && input.complementRef && typeof input.complementRef === "object") {
    const ref = input.complementRef as { kind?: unknown; id?: unknown };
    if ((ref.kind === "real" || ref.kind === "simulation") && typeof ref.id === "string") {
      complementRef = { kind: ref.kind, id: ref.id };
    }
  }

  const prefs = parseSimPreferences(input.preferences);
  if ("error" in prefs) return { error: prefs.error };

  return {
    profile: {
      cash,
      currency,
      horizon,
      targetDate,
      objective,
      riskAppetite: Math.round(riskAppetite),
      maxDrawdownPct,
      role,
      complementRef,
      preferences: prefs.preferences,
      followUps: [],
      intakeComplete: false,
    },
  };
}

/** Validate an intake follow-up history. Returns an error message or the list. */
export function parseSimFollowUps(input: unknown): { followUps: SimFollowUp[] } | { error: string } {
  if (input === undefined || input === null) return { followUps: [] };
  if (!Array.isArray(input)) return { error: "followUps must be an array" };
  const followUps: SimFollowUp[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { error: "Each follow-up must be an object" };
    const f = raw as { question?: unknown; answer?: unknown; assumption?: unknown; options?: unknown };
    if (typeof f.question !== "string" || !f.question.trim()) {
      return { error: "Each follow-up needs a question" };
    }
    if (f.answer !== null && typeof f.answer !== "string") {
      return { error: "A follow-up answer must be a string or null (skipped)" };
    }
    if (f.assumption !== null && f.assumption !== undefined && typeof f.assumption !== "string") {
      return { error: "A follow-up assumption must be a string or null" };
    }
    if (f.options !== undefined && !Array.isArray(f.options)) {
      return { error: "A follow-up's options must be an array" };
    }
    // Absent rather than empty when there were none: `options?: string[]` reads
    // as "this was multiple-choice", and an empty array would claim a choice was
    // offered with nothing in it.
    const options = Array.isArray(f.options)
      ? f.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim())
      : [];

    followUps.push({
      question: f.question,
      answer: f.answer ?? null,
      assumption: f.assumption ?? null,
      ...(options.length > 0 ? { options } : {}),
    });
  }
  return { followUps };
}

const HOLDING_SOURCES = new Set(["ai", "user"]);
const SYMBOL_RE = /^[A-Z0-9.\-=^]{1,12}$/;

/**
 * Validate a hypothetical holdings list. Returns an error message or the
 * normalized list. Quantities must be positive and finite — a persisted NaN
 * would poison every downstream evaluation silently.
 */
export function parseSimHoldings(input: unknown): { holdings: SimHolding[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "holdings must be an array" };
  const holdings: SimHolding[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { error: "Each holding must be an object" };
    const h = raw as Record<string, unknown>;

    const symbol =
      h.symbol === null ? null : typeof h.symbol === "string" ? h.symbol.trim().toUpperCase() : undefined;
    if (symbol === undefined || (symbol !== null && !SYMBOL_RE.test(symbol))) {
      return { error: `Invalid symbol on holding: ${String(h.symbol)}` };
    }
    const assetClass = h.assetClass as PortfolioAssetClass;
    if (!PORTFOLIO_ASSET_CLASSES.includes(assetClass)) {
      return { error: `Unknown asset class: ${String(h.assetClass)}` };
    }
    if (symbol === null && assetClass !== "cash") {
      return { error: "Only the cash sleeve may omit a symbol" };
    }
    const name = typeof h.name === "string" ? h.name.trim() : "";
    if (!name) return { error: "Each holding needs a name" };
    const currency = typeof h.currency === "string" ? h.currency.trim().toUpperCase() : "";
    if (!CURRENCY_RE.test(currency)) return { error: `Invalid currency on ${name}` };
    const quantity = Number(h.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `Quantity must be a positive number on ${name}` };
    }
    const targetWeight = Number(h.targetWeight);
    if (!Number.isFinite(targetWeight) || targetWeight < 0 || targetWeight > 100) {
      return { error: `Target weight must be 0-100 on ${name}` };
    }
    const rationale = typeof h.rationale === "string" ? h.rationale : null;
    const addedBy = HOLDING_SOURCES.has(h.addedBy as string) ? (h.addedBy as "ai" | "user") : "user";

    holdings.push({ symbol, name, assetClass, currency, quantity, targetWeight, rationale, addedBy });
  }
  return { holdings };
}
