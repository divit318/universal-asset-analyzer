import { describe, expect, it } from "vitest";
import { deployBlockedReason } from "@/app/portfolio/_components/universal/cash/deploy-guard";

/**
 * B2: after a successful deployment the executed plan stayed on screen with a
 * live, re-clickable "Deploy Cash" button and a footer still reading
 * "$X of $X deployed". A second click deposited the same cash again and re-bought
 * the same plan — on the live book the top recommendation was $277,841, so this
 * was a material financial event reachable from one stray click with nothing on
 * screen indicating the plan had already executed.
 */
describe("deployBlockedReason — a plan can never be deployed twice", () => {
  const plan = { cashAmount: 3000 };

  it("blocks the exact plan that was already deployed", () => {
    expect(deployBlockedReason(plan, plan, false)).toBe("already-executed");
  });

  it("allows a plan that has not been deployed", () => {
    expect(deployBlockedReason(plan, null, false)).toBeNull();
  });

  it("allows a FRESH plan even when its contents are identical to the deployed one", () => {
    // The user deploys $3,000, changes the amount, then changes it back. That
    // re-fetch is a genuinely different plan — computed against the POST-trade
    // portfolio — and is legitimately deployable. A key derived from the inputs
    // ("3000|maximize_sharpe") would wrongly keep blocking it, which is why the
    // guard compares object identity.
    const refetched = { cashAmount: 3000 };
    expect(refetched).toEqual(plan);
    expect(deployBlockedReason(refetched, plan, false)).toBeNull();
  });

  it("blocks while a re-simulation is in flight, because the plan on screen is the previous one", () => {
    expect(deployBlockedReason(plan, null, true)).toBe("recomputing");
  });

  it("reports already-executed in preference to recomputing", () => {
    // Both are blocking, but the message the user sees must be the accurate one:
    // "this has been deployed", not "hold on, recomputing".
    expect(deployBlockedReason(plan, plan, true)).toBe("already-executed");
  });

  it("re-allows the plan after a successful undo clears the executed marker", () => {
    // The undo route reverts the write, so the plan genuinely is un-spent again.
    // Leaving it blocked would be a different falsehood than the one B2 fixed.
    expect(deployBlockedReason(plan, plan, false)).toBe("already-executed");
    expect(deployBlockedReason(plan, null, false)).toBeNull();
  });

  it("is inert when there is no plan at all", () => {
    expect(deployBlockedReason(null, null, false)).toBeNull();
    expect(deployBlockedReason(null, null, true)).toBeNull();
    expect(deployBlockedReason(undefined, undefined, false)).toBeNull();
  });

  it("does not treat two distinct un-deployed plans as executed", () => {
    expect(deployBlockedReason({ cashAmount: 5000 }, { cashAmount: 3000 }, false)).toBeNull();
  });
});
