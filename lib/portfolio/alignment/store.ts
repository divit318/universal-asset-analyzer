/**
 * Investor-policy persistence — the server-only bridge between lib/db.ts and
 * the validated InvestorPolicy object. Every read goes through
 * parseInvestorPolicy, so no caller can observe an unvalidated policy; every
 * write invalidates the cached portfolio report, because the report's alignment
 * section is a function of the policy.
 */

import { getInvestorPolicyRaw, saveInvestorPolicyRaw } from "../../db";
import { invalidateDataset } from "../../platform";
import { DEFAULT_POLICY, parseInvestorPolicy, type InvestorPolicy } from "./policy";

/** The portfolio's policy, or the labelled assumed defaults when unset. */
export function loadInvestorPolicy(portfolioId = 1): InvestorPolicy {
  const raw = getInvestorPolicyRaw(portfolioId);
  if (raw == null) return DEFAULT_POLICY;
  const parsed = parseInvestorPolicy(raw);
  return "error" in parsed ? DEFAULT_POLICY : parsed.policy;
}

export function saveInvestorPolicy(policy: InvestorPolicy, portfolioId = 1): InvestorPolicy {
  const stamped: InvestorPolicy = { ...policy, confirmed: true, updatedAt: new Date().toISOString() };
  saveInvestorPolicyRaw(JSON.stringify(stamped), portfolioId);
  // The alignment score is policy × facts; a stale report would keep scoring
  // the investor against the policy they just replaced.
  invalidateDataset("portfolioReport");
  return stamped;
}
