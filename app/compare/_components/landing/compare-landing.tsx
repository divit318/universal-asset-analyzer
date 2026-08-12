import { getAssetClass } from "@/lib/assets/registry";
import type { BaseAssetClassId } from "@/lib/assets/types";
import { QuickStarts } from "./quick-starts";
import { FeatureCards } from "./feature-cards";
import { LivePreview } from "./live-preview";

interface Props {
  assetClass: BaseAssetClassId;
  onQuickStart: (symbols: string[]) => void;
  max: number;
  disabled?: boolean;
}

/**
 * The Compare landing state — everything shown before any asset is added.
 * Composes the three redesigned pieces (quick starts, flip preview cards,
 * blurred live preview) around the one instruction the user actually needs.
 * Separate from the comparison engine itself — this never renders once
 * symbols.length > 0.
 */
export function CompareLanding({ assetClass, onQuickStart, max, disabled }: Props) {
  const def = getAssetClass(assetClass);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3h4v12H3zM11 3h4v12h-4z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold">Add 2–{max} {def.noun} to compare side by side</p>
          <p className="mt-1 text-xs text-muted">Fundamentals, momentum, and a ranked AI verdict across every pick</p>
        </div>
        <QuickStarts assetClass={assetClass} onQuickStart={onQuickStart} disabled={disabled} />
      </div>

      <FeatureCards assetClass={assetClass} />

      <LivePreview />
    </div>
  );
}
