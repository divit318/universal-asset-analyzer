import type { AssetClassId, FilterValues } from "@/lib/assets/types";

/**
 * sessionStorage key the AI Assistant uses to hand a parsed natural-language
 * screen to the Screener page on arrival. A filter object is richer than a
 * clean query string, so this goes through storage rather than the URL —
 * written by ai-assistant.tsx right before navigating, read and cleared once
 * by app/screener/page.tsx on mount.
 */
export const PENDING_SCREEN_KEY = "uaa:pending-screen";

export interface PendingScreenHandoff {
  assetClass: AssetClassId;
  filters: FilterValues;
  templateId: string | null;
}
