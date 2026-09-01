/**
 * The dismiss/restore ROUTES — the persistence half of "clicking Dismiss
 * actually dismisses".
 *
 * What broke in production and is pinned here:
 *   1. NULL BASELINES MUST STAY NULL. `Number(null)` is 0, and both dismiss
 *      routes stored a fabricated 0 where "no baseline" was meant — which the
 *      revival judgment could then measure growth against, silently expiring
 *      a considered "no" (engines/decision-memory.ts reason 2).
 *   2. DUPLICATE CLICKS ARE NO-OPS. `dismissed_at` feeds the report cache's
 *      memory version; re-upserting it per click busted the report being
 *      rebuilt for the FIRST click and restarted the ~20s build each time.
 *   3. SCOPE. A dismissal belongs to one (portfolio, thesis); dismissing or
 *      restoring one must not touch other portfolios or other theses.
 *   4. RESTORE IS AS WIDE AS THE ACT. Lifting a thesis lifts its Today story
 *      hides too — but only its own.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// DB isolation BEFORE lib/db's lazy getDb() first runs (same pattern as
// tests/portfolio-decision-memory.test.ts).
const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-dismiss-route-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { DELETE, POST } from "@/app/api/portfolio/decisions/dismiss/route";
import { POST as attentionPOST } from "@/app/api/home/attention/dismiss/route";
import { dismissAttention, listActiveDismissals, listDecisionDismissals, undismissDecisionThesis } from "@/lib/db";

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

const req = (body: unknown, method: "POST" | "DELETE" = "POST") =>
  new Request("http://localhost/api/portfolio/decisions/dismiss", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/portfolio/decisions/dismiss", () => {
  it("persists the dismissal, and a null revival baseline stays NULL — never a fabricated 0", async () => {
    const res = await POST(
      req({
        thesisKey: "gap:no_bonds",
        title: "Add intermediate US Treasury duration via IEF",
        policyUpdatedAt: "2026-08-15T15:58:16.424Z",
        themeId: "resilience",
        themeScore: 32,
        subjectWeightPct: null, // IEF is not held — there IS no weight baseline
      }),
    );
    expect(res.status).toBe(200);
    const d = listDecisionDismissals(1).find((x) => x.thesisKey === "gap:no_bonds")!;
    expect(d).toBeDefined();
    expect(d.subjectWeightPct).toBeNull();
    expect(d.themeScore).toBe(32);
    expect(d.policyUpdatedAt).toBe("2026-08-15T15:58:16.424Z");
    expect(d.title).toBe("Add intermediate US Treasury duration via IEF");
    undismissDecisionThesis(1, "gap:no_bonds");
  });

  it("a discovery dismissal with no theme context stores null across the board", async () => {
    await POST(req({ thesisKey: "discover:GLD", title: "Worth a look: GLD", policyUpdatedAt: null, themeId: null, themeScore: null, subjectWeightPct: null }));
    const d = listDecisionDismissals(1).find((x) => x.thesisKey === "discover:GLD")!;
    expect(d.policyUpdatedAt).toBeNull();
    expect(d.themeId).toBeNull();
    expect(d.themeScore).toBeNull();
    expect(d.subjectWeightPct).toBeNull();
    undismissDecisionThesis(1, "discover:GLD");
  });

  it("rejects a missing thesisKey", async () => {
    expect((await POST(req({ title: "no key" }))).status).toBe(400);
  });

  it("is idempotent per (portfolio, thesis): a duplicate click does not move dismissed_at", async () => {
    const payload = {
      thesisKey: "reduce:QQQM",
      title: "Trim QQQM from 25.4% to 20%",
      policyUpdatedAt: "2026-08-15T15:58:16.424Z",
      themeId: "concentration",
      themeScore: 65,
      subjectWeightPct: 25.4,
    };
    await POST(req(payload));
    const before = listDecisionDismissals(1).find((d) => d.thesisKey === "reduce:QQQM")!;
    await new Promise((r) => setTimeout(r, 5)); // let the clock move between clicks
    await POST(req(payload));
    const after = listDecisionDismissals(1).find((d) => d.thesisKey === "reduce:QQQM")!;
    expect(after.dismissedAt).toBe(before.dismissedAt);
    undismissDecisionThesis(1, "reduce:QQQM");
  });

  it("dismissals are scoped to their portfolio", async () => {
    await POST(req({ portfolioId: 2, thesisKey: "exit:XYZ", title: "Exit XYZ" }));
    expect(listDecisionDismissals(2).map((d) => d.thesisKey)).toContain("exit:XYZ");
    expect(listDecisionDismissals(1).map((d) => d.thesisKey)).not.toContain("exit:XYZ");
    undismissDecisionThesis(2, "exit:XYZ");
  });
});

describe("DELETE /api/portfolio/decisions/dismiss (restore)", () => {
  it("restores ONE (portfolio, thesis) and lifts only that thesis's Today story hides", async () => {
    await POST(req({ thesisKey: "reduce:QQQM", title: "Trim QQQM" }));
    await POST(req({ thesisKey: "gap:no_bonds", title: "Add bonds via IEF" }));
    await POST(req({ portfolioId: 2, thesisKey: "reduce:QQQM", title: "Trim QQQM" }));

    const now = Date.now();
    dismissAttention("action:QQQM:50", now, now + 86_400_000); // the thesis's banded story
    dismissAttention("concentration:qqqm", now, now + 86_400_000); // its merged cross-kind twin
    dismissAttention("action:IEF:70", now, now + 86_400_000); // unrelated — must survive

    const res = await DELETE(req({ thesisKey: "reduce:QQQM" }, "DELETE"));
    expect(res.status).toBe(200);

    // The thesis is restored for portfolio 1 only; unrelated theses and other
    // portfolios keep their memory.
    expect(listDecisionDismissals(1).map((d) => d.thesisKey)).toEqual(["gap:no_bonds"]);
    expect(listDecisionDismissals(2).map((d) => d.thesisKey)).toEqual(["reduce:QQQM"]);

    const left = listActiveDismissals(now).map((d) => d.dedupeKey);
    expect(left).toContain("action:IEF:70");
    expect(left).not.toContain("action:QQQM:50");
    expect(left).not.toContain("concentration:qqqm");

    undismissDecisionThesis(1, "gap:no_bonds");
    undismissDecisionThesis(2, "reduce:QQQM");
  });

  it("rejects a missing thesisKey", async () => {
    expect((await DELETE(req({}, "DELETE"))).status).toBe(400);
  });
});

describe("POST /api/home/attention/dismiss — the Today surface writes the same memory", () => {
  it("thesis baselines stay null (not 0) through the attention route too", async () => {
    const res = await attentionPOST(
      new Request("http://localhost/api/home/attention/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dedupeKey: "signal:GLD:50",
          kind: "signal",
          thesis: { key: "discover:GLD", title: "Worth a look: GLD", policyUpdatedAt: null, themeId: null, themeScore: null, subjectWeightPct: null },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const d = listDecisionDismissals(1).find((x) => x.thesisKey === "discover:GLD")!;
    expect(d).toBeDefined();
    expect(d.themeScore).toBeNull();
    expect(d.subjectWeightPct).toBeNull();
    undismissDecisionThesis(1, "discover:GLD");
  });
});
