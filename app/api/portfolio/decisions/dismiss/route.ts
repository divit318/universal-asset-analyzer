/**
 * POST   /api/portfolio/decisions/dismiss — record "I considered this thesis; stop repeating it."
 * DELETE /api/portfolio/decisions/dismiss — explicit restore.
 *
 * The dismissal is SEMANTIC, not cosmetic: it stores the underlying thesis key
 * (reduce:QQQM, gap:no_bonds) plus the context it was declined in (policy
 * version, subject weight, owning theme's score), and the recommendation
 * PIPELINE consults it on every build — so the same idea disappears from
 * Decisions, Today's queue, the home spotlight and the digest at once, and
 * returns only on material change (see engines/decision-memory.ts).
 *
 * The revival context arrives from the client because the client is holding
 * the exact report the card came from; the server clamps shapes. Worst case a
 * tampered value skews the investor's own revival baseline — their data,
 * their card, no cross-user surface.
 */
import { NextResponse } from "next/server";
import { dismissDecisionThesis, undismissDecisionThesis, undismissAttentionByPrefix } from "@/lib/db";
import { invalidateDataset } from "@/lib/platform";

/**
 * The Today-queue story keys a restored thesis must also lift. Symbol-bearing
 * theses (reduce:/exit:/discover:SYM) map to `action:SYM:<band>` stories; the
 * band is unknowable here, hence prefix deletion. Gap theses have no stable
 * symbol in the key — their stories return on the attention TTL (≤3d), which
 * is the acceptable residual, not a contradiction the user can act on.
 */
function attentionPrefixesFor(thesisKey: string): string[] {
  const m = thesisKey.match(/^(?:reduce|exit|discover):([A-Z0-9.\-]{1,12})$/);
  if (!m) return [];
  // The story hide plus its merged cross-kind twin (the concentration threat
  // a REDUCE action absorbs shares `concentration:<slug>` — attention.ts).
  return [`action:${m[1]}:`, `concentration:${m[1].toLowerCase()}`];
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `null` must stay null: `Number(null)` is 0, and storing a fabricated 0 as a
// revival baseline (subject weight, theme score) made "no baseline" look like
// "dismissed at 0%" — which reason 2 of revivalReason could then measure
// growth against, spuriously reviving a considered "no".
const num = (v: unknown, lo: number, hi: number): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const thesisKey = str(body.thesisKey, 80);
    if (!thesisKey) return NextResponse.json({ error: "thesisKey is required" }, { status: 400 });
    const portfolioId = num(body.portfolioId, 1, 1_000_000) ?? 1;

    dismissDecisionThesis(portfolioId, {
      thesisKey,
      dismissedAt: new Date().toISOString(),
      policyUpdatedAt: str(body.policyUpdatedAt, 40),
      themeId: str(body.themeId, 30),
      themeScore: num(body.themeScore, 0, 100),
      subjectWeightPct: num(body.subjectWeightPct, 0, 100),
      title: str(body.title, 160) ?? thesisKey,
    });

    // The report (and everything derived from it — attention, digest, home)
    // must rebuild without the dismissed thesis.
    invalidateDataset("portfolioReport");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dismiss failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const thesisKey = str(body.thesisKey, 80);
    if (!thesisKey) return NextResponse.json({ error: "thesisKey is required" }, { status: 400 });
    const portfolioId = num(body.portfolioId, 1, 1_000_000) ?? 1;

    undismissDecisionThesis(portfolioId, thesisKey);
    // The reversal is as wide as the act: a dismissal hid the thesis
    // everywhere, so a restore lifts the Today story hide too — otherwise
    // Decisions shows the card while Today keeps hiding it for up to 3 days.
    undismissAttentionByPrefix(attentionPrefixesFor(thesisKey));
    invalidateDataset("portfolioReport");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restore failed" },
      { status: 500 },
    );
  }
}
