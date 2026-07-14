import { describe, it, expect, beforeEach } from "vitest";
import { cacheKey, dependencyClosure, policyFor, DATASETS } from "@/lib/platform/registry";
import { dedupe, dedupStats, resetDedup, inflightKeys } from "@/lib/platform/dedup";
import { runPlan, mapLimit, stepValue, stepError } from "@/lib/platform/orchestrator";
import type { PlanStep } from "@/lib/platform/types";

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

describe("registry: cacheKey", () => {
  it("is stable regardless of param order", () => {
    expect(cacheKey("history", { symbol: "AAPL", days: 180 })).toBe(
      cacheKey("history", { days: 180, symbol: "AAPL" }),
    );
  });

  it("drops null/undefined/empty params so optional args don't fork the key", () => {
    expect(cacheKey("history", { symbol: "AAPL", days: undefined })).toBe("history:symbol=AAPL");
    expect(cacheKey("history", { symbol: "AAPL", days: null })).toBe("history:symbol=AAPL");
  });

  it("distinguishes genuinely different work", () => {
    expect(cacheKey("history", { symbol: "AAPL", days: 180 })).not.toBe(
      cacheKey("history", { symbol: "AAPL", days: 1825 }),
    );
    expect(cacheKey("history", { symbol: "AAPL" })).not.toBe(cacheKey("quote", { symbol: "AAPL" }));
  });
});

describe("registry: dataset policies", () => {
  it("gives every dataset a policy (no dataset falls through to a default TTL)", () => {
    for (const [id, policy] of Object.entries(DATASETS)) {
      expect(policy.ttlMs, `${id} ttl`).toBeGreaterThan(0);
      expect(policy.swrMs, `${id} swr`).toBeGreaterThanOrEqual(0);
      expect(policy.label, `${id} label`).toBeTruthy();
    }
  });

  it("never serves a stale quote: quotes get the shortest TTL and no SWR window", () => {
    const quote = policyFor("quote");
    expect(quote.swrMs).toBe(0);
    expect(quote.persist).toBe(false);
    // A quote must not outlive any slower-moving dataset.
    expect(quote.ttlMs).toBeLessThan(policyFor("history").ttlMs);
    expect(quote.ttlMs).toBeLessThan(policyFor("statements").ttlMs);
  });

  it("persists what is expensive to rebuild, not what is live", () => {
    expect(policyFor("statements").persist).toBe(true);
    expect(policyFor("aiVerdict").persist).toBe(true);
    expect(policyFor("quote").persist).toBe(false);
    expect(policyFor("quotes.batch").persist).toBe(false);
  });
});

describe("registry: dependency closure", () => {
  it("cascades a new filing down the analytical chain", () => {
    const closure = dependencyClosure("filings");
    expect(closure).toContain("filings");
    expect(closure).toContain("statements");
    expect(closure).toContain("fundamentals");
    expect(closure).toContain("aiVerdict");
  });

  it("does NOT touch unrelated datasets — the whole point of dependency-awareness", () => {
    const closure = dependencyClosure("filings");
    // A new 10-Q says nothing about where the company is headquartered or what
    // its stock did last year.
    expect(closure).not.toContain("profile");
    expect(closure).not.toContain("history");
    expect(closure).not.toContain("macro");
  });

  it("a price tick does not invalidate the business analysis", () => {
    const closure = dependencyClosure("quote");
    expect(closure).not.toContain("statements");
    expect(closure).not.toContain("filings");
    expect(closure).not.toContain("profile");
  });

  it("is cycle-safe", () => {
    // companyContext → aiVerdict, and several roots reach both.
    expect(() => dependencyClosure("companyContext")).not.toThrow();
    expect(dependencyClosure("companyContext")).toEqual(
      expect.arrayContaining(["companyContext", "aiVerdict"]),
    );
  });

  it("a refreshed India company invalidates its analysis but not the US chain", () => {
    // screener.in is the whole fundamentals chain for an Indian name, so it must
    // reach the derived analysis...
    const closure = dependencyClosure("screenerIn");
    expect(closure).toContain("screenerIn");
    expect(closure).toContain("companyContext");
    expect(closure).toContain("aiVerdict");
    // ...without dragging in the Yahoo/EDGAR datasets it has nothing to do with.
    expect(closure).not.toContain("statements");
    expect(closure).not.toContain("filings");
  });

  it("the CIK index is a leaf: refreshing it re-analyses nothing", () => {
    // The ticker→CIK index changes when a company lists, not when it files. It
    // must never cascade into the analytical chain.
    expect(dependencyClosure("cikMap")).toEqual(["cikMap"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Deduplication                                                               */
/* -------------------------------------------------------------------------- */

describe("dedup", () => {
  beforeEach(() => resetDedup());

  it("executes identical concurrent work exactly once and fans the result out", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "AAPL-quote";
    };

    // Five modules ask for the same thing at the same moment — the exact
    // research-page stampede this exists to kill.
    const results = await Promise.all([
      dedupe("quote:AAPL", fetcher),
      dedupe("quote:AAPL", fetcher),
      dedupe("quote:AAPL", fetcher),
      dedupe("quote:AAPL", fetcher),
      dedupe("quote:AAPL", fetcher),
    ]);

    expect(executions).toBe(1);
    expect(results).toEqual(Array(5).fill("AAPL-quote"));
    expect(dedupStats().coalesced).toBe(4);
    expect(dedupStats().executed).toBe(1);
  });

  it("does NOT coalesce genuinely different work", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions += 1;
      return "x";
    };
    await Promise.all([
      dedupe("history:AAPL:180", fetcher),
      dedupe("history:AAPL:1825", fetcher),
      dedupe("history:MSFT:180", fetcher),
    ]);
    expect(executions).toBe(3);
  });

  it("propagates a rejection to every subscriber — nobody hangs", async () => {
    const fetcher = async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("Yahoo is down");
    };
    const results = await Promise.allSettled([
      dedupe("quote:FAIL", fetcher),
      dedupe("quote:FAIL", fetcher),
      dedupe("quote:FAIL", fetcher),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason.message).toBe("Yahoo is down");
    }
  });

  it("clears the in-flight slot after failure so a retry can execute", async () => {
    const failing = async () => { throw new Error("transient"); };
    await expect(dedupe("k", failing)).rejects.toThrow("transient");
    expect(inflightKeys()).not.toContain("k");

    const ok = async () => "recovered";
    await expect(dedupe("k", ok)).resolves.toBe("recovered");
  });

  it("one consumer cancelling does not cancel the request others still need", async () => {
    let aborted = false;
    let resolved = false;
    const fetcher = async (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      await new Promise((r) => setTimeout(r, 40));
      resolved = true;
      return "shared-value";
    };

    const controller = new AbortController();
    const leaver = dedupe("shared", fetcher, { signal: controller.signal });
    const stayer = dedupe("shared", fetcher);

    controller.abort();
    await expect(leaver).rejects.toThrow();

    // The remaining consumer must still get its data.
    await expect(stayer).resolves.toBe("shared-value");
    expect(aborted).toBe(false);
    expect(resolved).toBe(true);
  });

  it("aborts the provider call when the LAST consumer cancels", async () => {
    let aborted = false;
    const fetcher = async (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      await new Promise((r) => setTimeout(r, 50));
      return "v";
    };

    const controller = new AbortController();
    const only = dedupe("solo", fetcher, { signal: controller.signal });
    controller.abort();
    await expect(only).rejects.toThrow();

    expect(aborted).toBe(true);
    expect(dedupStats().cancelled).toBe(1);
  });

  it("a foreground request subscribes to an in-flight background refresh", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "v";
    };

    const background = dedupe("k", fetcher, { background: true });
    const foreground = dedupe("k", fetcher);

    await Promise.all([background, foreground]);
    expect(executions).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Orchestrator                                                                */
/* -------------------------------------------------------------------------- */

describe("orchestrator: runPlan", () => {
  it("runs independent steps concurrently, not serially", async () => {
    const step = (id: string): PlanStep => ({
      id,
      run: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return id;
      },
    });

    const started = Date.now();
    const plan = await runPlan([step("a"), step("b"), step("c"), step("d")]);
    const elapsed = Date.now() - started;

    expect(Object.values(plan.steps).every((s) => s.status === "ok")).toBe(true);
    // Serial would be ~200ms. Concurrent is ~50ms. Generous bound for CI noise.
    expect(elapsed).toBeLessThan(140);
  });

  it("keeps real dependency chains strictly ordered", async () => {
    const order: string[] = [];
    const plan = await runPlan([
      { id: "statements", run: async () => { order.push("statements"); return { revenue: 100 }; } },
      {
        id: "ratios",
        dependsOn: ["statements"],
        run: async (deps) => {
          order.push("ratios");
          const s = deps.statements as { revenue: number };
          return { margin: s.revenue / 200 };
        },
      },
      {
        id: "ai",
        dependsOn: ["ratios"],
        run: async (deps) => {
          order.push("ai");
          return { verdict: "ok", margin: (deps.ratios as { margin: number }).margin };
        },
      },
    ]);

    expect(order).toEqual(["statements", "ratios", "ai"]);
    expect(stepValue<{ margin: number }>(plan, "ratios")).toEqual({ margin: 0.5 });
    expect(stepValue<{ verdict: string }>(plan, "ai")?.verdict).toBe("ok");
  });

  it("a failed step never cancels unrelated work — partial data beats a blank page", async () => {
    const plan = await runPlan([
      { id: "quote", run: async () => "AAPL $190" },
      { id: "news", run: async () => { throw new Error("RSS timeout"); } },
      { id: "filings", run: async () => ["10-Q"] },
      { id: "history", run: async () => [1, 2, 3] },
    ]);

    expect(plan.steps.news.status).toBe("failed");
    expect(stepError(plan, "news")).toBe("RSS timeout");

    // Everything else still landed.
    expect(plan.steps.quote.status).toBe("ok");
    expect(plan.steps.filings.status).toBe("ok");
    expect(plan.steps.history.status).toBe("ok");
    expect(plan.partial).toBe(true);
  });

  it("skips only the dependents of a failed step", async () => {
    const plan = await runPlan([
      { id: "statements", run: async () => { throw new Error("EDGAR down"); } },
      { id: "ratios", dependsOn: ["statements"], run: async () => "never" },
      { id: "valuation", dependsOn: ["ratios"], run: async () => "never" },
      { id: "news", run: async () => "news ok" },
    ]);

    expect(plan.steps.statements.status).toBe("failed");
    expect(plan.steps.ratios.status).toBe("skipped");
    expect(plan.steps.valuation.status).toBe("skipped");
    // Unrelated branch is untouched.
    expect(plan.steps.news.status).toBe("ok");
    expect(stepValue<string>(plan, "news")).toBe("news ok");
  });

  it("throws only when a REQUIRED step fails", async () => {
    await expect(
      runPlan([
        { id: "quote", required: true, run: async () => { throw new Error("no such symbol"); } },
        { id: "news", run: async () => "ok" },
      ]),
    ).rejects.toThrow(/Required step "quote" failed/);
  });

  it("retries a transient failure and succeeds", async () => {
    let attempts = 0;
    const plan = await runPlan([
      {
        id: "flaky",
        retries: 2,
        run: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("transient");
          return "recovered";
        },
      },
    ]);
    expect(attempts).toBe(3);
    expect(stepValue<string>(plan, "flaky")).toBe("recovered");
  });

  it("honours the concurrency limit so a big screen can't exhaust the provider", async () => {
    let inFlight = 0;
    let peak = 0;
    const steps: PlanStep[] = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      run: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return i;
      },
    }));

    await runPlan(steps, { concurrency: 4 });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("times out a slow provider and aborts it, without failing the plan", async () => {
    let aborted = false;
    const plan = await runPlan([
      {
        id: "slow",
        timeoutMs: 30,
        run: async (_deps, signal) => {
          signal.addEventListener("abort", () => { aborted = true; });
          await new Promise((r) => setTimeout(r, 500));
          return "too late";
        },
      },
      { id: "fast", run: async () => "on time" },
    ]);

    expect(plan.steps.slow.status).toBe("failed");
    expect(plan.steps.slow.error).toMatch(/timed out/);
    expect(aborted).toBe(true);
    // The slow step did not take the fast one down with it.
    expect(stepValue<string>(plan, "fast")).toBe("on time");
  });

  it("cancels the whole plan when the user navigates away", async () => {
    const controller = new AbortController();
    const plan = runPlan(
      [
        { id: "a", run: async () => { await new Promise((r) => setTimeout(r, 200)); return "a"; } },
        { id: "b", run: async () => { await new Promise((r) => setTimeout(r, 200)); return "b"; } },
      ],
      { signal: controller.signal },
    );
    controller.abort();
    const result = await plan;
    expect(Object.values(result.steps).every((s) => s.status === "cancelled")).toBe(true);
  });

  it("rejects a cyclic plan rather than deadlocking", async () => {
    await expect(
      runPlan([
        { id: "a", dependsOn: ["b"], run: async () => 1 },
        { id: "b", dependsOn: ["a"], run: async () => 2 },
      ]),
    ).rejects.toThrow(/Cyclic dependency/);
  });

  it("rejects a plan referencing an unknown step", async () => {
    await expect(
      runPlan([{ id: "a", dependsOn: ["ghost"], run: async () => 1 }]),
    ).rejects.toThrow(/unknown step "ghost"/);
  });
});

describe("orchestrator: mapLimit", () => {
  it("caps concurrency across a large batch", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    await mapLimit(items, 6, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(6);
  });

  it("isolates failures: one bad symbol doesn't sink the batch", async () => {
    const results = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("bad symbol");
      return n;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("preserves input order regardless of completion order", async () => {
    const results = await mapLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results.map((r) => (r as PromiseFulfilledResult<number>).value)).toEqual([30, 10, 20]);
  });
});
