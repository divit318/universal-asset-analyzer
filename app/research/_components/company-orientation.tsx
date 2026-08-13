"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FundamentalsData } from "@/lib/types";
import type { CompanyBrief } from "@/lib/ai-company-brief";
import { deriveInvestmentCharacteristics } from "@/lib/scoring";
import { firstSentence, shortCompanyName } from "@/lib/company-text";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { LoadingMark } from "@/app/_components/loading-mark";
import { TAG_STYLE } from "./investment-personality-badge";

/**
 * Company orientation — the layer between the stock's identity/price and the
 * market-stats strip that answers, in order: what does this company do?
 * (one-liner, visible by default), what kind of investment is it?
 * (deterministic characteristics — descriptive, not a recommendation), and
 * "tell me more" (the expandable About).
 *
 * Renders inside the masthead card so orientation reads as part of the
 * company's identity, not as yet another card competing with the verdict.
 */

/** The bundle's `profile` step is Yahoo's raw quoteSummary — unwrap it defensively. */
export function readAssetProfile(raw: unknown): {
  sector: string | null;
  industry: string | null;
  description: string | null;
} {
  const empty = { sector: null, industry: null, description: null };
  if (raw == null || typeof raw !== "object") return empty;
  const ap = (raw as Record<string, unknown>).assetProfile;
  if (ap == null || typeof ap !== "object") return empty;
  const o = ap as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    sector: str(o.sector),
    industry: str(o.industry),
    description: str(o.longBusinessSummary),
  };
}

async function fetchBrief(symbol: string, signal: AbortSignal): Promise<CompanyBrief> {
  const res = await fetch(`/api/company-brief?symbol=${encodeURIComponent(symbol)}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Company brief failed (${res.status})`);
  }
  return res.json() as Promise<CompanyBrief>;
}

interface Props {
  symbol: string;
  companyName: string | null;
  fundamentals: FundamentalsData | null;
  fundamentalsLoading: boolean;
  /** First-paint fallbacks from the research bundle's `profile` step. */
  profileSector: string | null;
  profileIndustry: string | null;
  profileDescription: string | null;
}

export function CompanyOrientation({
  symbol,
  companyName,
  fundamentals,
  fundamentalsLoading,
  profileSector,
  profileIndustry,
  profileDescription,
}: Props) {
  const [aboutOpen, setAboutOpen] = useState(false);
  // Which characteristic's explanation is expanded inline. Rendered inline —
  // not as the badge component's absolute popover — because the masthead card
  // is overflow-hidden and would clip anything positioned outside the band.
  const [explainedTag, setExplainedTag] = useState<string | null>(null);

  const briefEntry = useDataset<CompanyBrief>("companyBrief", symbol, (signal) =>
    fetchBrief(symbol, signal),
  );
  const brief = briefEntry.data;

  // Descriptive characteristics from the SAME ScoreResult the Conviction tab
  // renders — no parallel scoring system, no AI (lib/scoring.ts).
  const characteristics = useMemo(
    () =>
      fundamentals
        ? deriveInvestmentCharacteristics(fundamentals.score, fundamentals.snapshot, fundamentals.momentum)
        : [],
    [fundamentals],
  );

  // The one-liner must be visible by default: the AI wording when it has
  // arrived, the profile's own first sentence while it hasn't.
  const description = brief?.description ?? profileDescription;
  const oneLiner = brief?.oneLiner ?? firstSentence(profileDescription);
  const about = brief?.about ?? null;

  const sector = brief?.sector ?? profileSector;
  const industry = brief?.industry ?? profileIndustry;

  const factsLine = [
    sector,
    industry,
    brief?.employees != null ? `${brief.employees.toLocaleString("en-US")} employees` : null,
    brief?.country ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  const loadingAnything = briefEntry.isInitialLoading || fundamentalsLoading;
  const hasAnything = oneLiner != null || characteristics.length > 0 || description != null;
  if (!hasAnything && !loadingAnything) return null;

  const name = shortCompanyName(companyName, symbol);

  const aboutRows: [string, string | null][] = about
    ? [
        ["What it sells", about.whatItSells],
        ["How it makes money", about.businessModel],
        ["Who buys it", about.customers],
        ["Where it operates", about.geography],
      ]
    : [];

  return (
    <div className="flex flex-col border-t border-border px-5 py-3">
      {/* 1. What does it do? — the five-second answer, never behind a click */}
      {oneLiner ? (
        <p className="max-w-4xl text-sm leading-relaxed text-muted">
          <span className="font-medium text-foreground">What does {name} do?</span>{" "}
          {oneLiner}
        </p>
      ) : briefEntry.isInitialLoading ? (
        <div className="flex items-center gap-2 text-caption text-muted">
          <LoadingMark size={13} label="Loading company description" />
          Loading company description…
        </div>
      ) : null}

      {/* 2. What kind of investment is it? + 3. Tell me more */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {characteristics.length > 0 && (
          <>
            <span className="mr-1 text-micro font-semibold uppercase tracking-widest text-faint">
              Investment characteristics
            </span>
            {characteristics.map((c) => (
              <button
                key={c.tag}
                type="button"
                onClick={() => setExplainedTag((t) => (t === c.tag ? null : c.tag))}
                aria-expanded={explainedTag === c.tag}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold tracking-wide transition-transform active:scale-[0.97] ${TAG_STYLE[c.tag]}`}
              >
                {c.tag}
                <span className="text-[10px] opacity-60">ⓘ</span>
              </button>
            ))}
          </>
        )}
        {characteristics.length === 0 && fundamentalsLoading && (
          <div className="inline-flex h-7 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3">
            <LoadingMark size={13} label="Classifying investment characteristics" />
            <span className="text-micro uppercase tracking-widest text-muted">Classifying</span>
          </div>
        )}
        {description != null && (
          <button
            type="button"
            onClick={() => setAboutOpen((o) => !o)}
            aria-expanded={aboutOpen}
            className="ml-auto inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            About the company
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${aboutOpen ? "rotate-180" : ""}`}
              strokeWidth={2}
            />
          </button>
        )}
      </div>

      {/* Inline explanation for the selected characteristic — descriptive
          evidence from the deterministic scorer, not an AI take. */}
      {(() => {
        const explained = characteristics.find((c) => c.tag === explainedTag);
        return explained ? (
          <p className="animate-fade-rise mt-1.5 max-w-3xl text-[11px] leading-5 text-muted">
            {explained.explanation}
          </p>
        ) : null;
      })()}

      {aboutOpen && (
        <div className="animate-fade-rise mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
          {aboutRows.some(([, v]) => v != null) ? (
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {aboutRows.map(([label, value]) =>
                value != null ? (
                  <div key={label} className="flex flex-col gap-1">
                    <dt className="text-micro font-semibold uppercase tracking-widest text-faint">{label}</dt>
                    <dd className="text-xs leading-5 text-muted">{value}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : (
            <p className="text-xs leading-5 text-muted">{description}</p>
          )}
          {factsLine && <p className="text-micro text-faint">{factsLine}</p>}
          {brief?.source === "ai" && (
            <p className="text-micro text-faint">
              Plain-English summary of the company&apos;s official business profile — descriptive context, not a recommendation.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
