/**
 * Company orientation brief — the "what is this company, in plain English?"
 * layer at the top of the Research Hub, answering the questions the page used
 * to skip straight past (identity → straight to market stats → BUY/SELL).
 *
 * Follows the codebase's standing convention: one small prompt builder per
 * feature (see ai-financial-insight.ts, ai-watchlist.ts), runAnalysis() for
 * inference through the provider chain, ai_result caching keyed on the
 * dossier. A company's business description changes essentially never, so
 * the cache window is a week.
 *
 * The AI is grounded exclusively in the Yahoo business profile and is asked
 * to describe, never to judge — no directional language, no invented facts,
 * null for anything the description doesn't support. When AI is unavailable
 * the brief degrades to the profile's own first sentence: everything renders
 * without AI, just less plainly worded.
 */

import { getCompanyProfile } from "./profile";
import { runAnalysis } from "./ai/analysis";
import {
  CompanyBriefAnalysisSchema,
  CompanyBriefWireSchema,
  COMPANY_BRIEF_SCHEMA_VERSION,
} from "./ai/schemas/company-brief";
import { firstSentence } from "./company-text";
import type { CompanyProfile } from "./ai/types";

export interface CompanyBriefAbout {
  whatItSells: string | null;
  businessModel: string | null;
  customers: string | null;
  geography: string | null;
}

export interface CompanyBrief {
  symbol: string;
  sector: string | null;
  industry: string | null;
  /** One plain-English sentence; the profile's first sentence when AI is unavailable. */
  oneLiner: string | null;
  /** Structured expansion for "About the company" — null when AI is unavailable. */
  about: CompanyBriefAbout | null;
  /** The full official business description (Yahoo assetProfile), for the expanded fallback. */
  description: string | null;
  employees: number | null;
  country: string | null;
  website: string | null;
  /** "ai" when oneLiner/about are AI-written; "profile" when deterministic. */
  source: "ai" | "profile";
}

export function buildCompanyBriefPrompt(profile: CompanyProfile): string {
  const facts = [
    profile.sector ? `- Sector: ${profile.sector}` : null,
    profile.industry ? `- Industry: ${profile.industry}` : null,
    profile.country ? `- Country: ${profile.country}` : null,
    profile.employees != null ? `- Full-time employees: ${profile.employees.toLocaleString("en-US")}` : null,
  ].filter(Boolean).join("\n");

  return `You are orienting an investor who knows nothing about ${profile.symbol}. Rewrite the company's official business description below in plain English. Use ONLY the description and facts provided — no outside knowledge, no invented products, customers, or figures. If the description does not support a field, return null for that field.

OFFICIAL BUSINESS DESCRIPTION (the only source of truth):
${profile.description}

FACTS:
${facts || "- (none)"}

Return:
- oneLiner: ONE sentence a reader can absorb in five seconds answering "what does this company actually do, and for whom?". Plain English — translate the description's own marketing phrasing rather than repeating it.
- whatItSells: the concrete products or services, 1-2 short sentences.
- businessModel: how it makes money (subscriptions, transaction fees, product sales…), 1 short sentence.
- customers: who buys it, 1 short sentence.
- geography: where it operates or sells, 1 short sentence.

This is descriptive orientation only: no investment opinion, no buy/sell/quality language, no adjectives like "leading" unless the description states market position.`;
}

/**
 * Build (or replay from the ai_result cache) the orientation brief for a
 * symbol. Never throws for a missing description or unavailable AI — the
 * brief degrades to whatever the profile honestly supports.
 */
export async function getCompanyBrief(symbol: string): Promise<CompanyBrief> {
  const profile = await getCompanyProfile(symbol);

  const base: CompanyBrief = {
    symbol,
    sector: profile.sector,
    industry: profile.industry,
    oneLiner: firstSentence(profile.description),
    about: null,
    description: profile.description,
    employees: profile.employees,
    country: profile.country,
    website: profile.website,
    source: "profile",
  };
  if (!profile.description) return base;

  try {
    const result = await runAnalysis(
      {
        taskType: "quick-summary",
        subjectKey: `company-brief:${symbol}`,
        prompt: buildCompanyBriefPrompt(profile),
        schema: CompanyBriefAnalysisSchema,
        wireSchema: CompanyBriefWireSchema,
        schemaVersion: COMPANY_BRIEF_SCHEMA_VERSION,
      },
      { maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
    );
    const d = result.data;
    const about: CompanyBriefAbout = {
      whatItSells: d.whatItSells,
      businessModel: d.businessModel,
      customers: d.customers,
      geography: d.geography,
    };
    const hasAbout = Object.values(about).some((v) => v != null);
    return { ...base, oneLiner: d.oneLiner, about: hasAbout ? about : null, source: "ai" };
  } catch {
    return base; // AI unavailable — the deterministic brief is the product, not an error
  }
}
