import type { AssetClassId, FilterValues } from "@/lib/assets/types";

/**
 * sessionStorage key the AI Assistant uses to hand a natural-language screen
 * to the Screener page on arrival — written by ai-assistant.tsx right before
 * navigating, read and cleared once by app/screener/page.tsx on mount.
 *
 * Since 2026-08-10 the handoff carries the RAW `nlQuery` and the Screener
 * parses it on arrival (via /api/screener/nl), concurrently with its own
 * initial data load. Parsing it inside the assistant's turn made every
 * screener request two SEQUENTIAL model calls (~16.6s measured) while the
 * user stared at the chat panel. The parsed-`filters` shape is still
 * accepted for compatibility.
 */
export const PENDING_SCREEN_KEY = "uaa:pending-screen";

export interface PendingScreenHandoff {
  assetClass: AssetClassId;
  /** The user's own filter description, parsed by the Screener on arrival. */
  nlQuery?: string;
  /** Pre-parsed filters (legacy shape) — applied directly when present. */
  filters?: FilterValues;
  templateId?: string | null;
}
