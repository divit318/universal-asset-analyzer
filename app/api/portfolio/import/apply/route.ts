/**
 * POST /api/portfolio/import/apply — persist a CONFIRMED screenshot import.
 *
 * Only ever called after the user has reviewed the reconciliation preview
 * (/api/portfolio/import/extract) and confirmed the exact rows. Every action
 * is re-validated here — the preview is a client artifact and cannot be
 * trusted as authorization — and the whole batch commits atomically through
 * lib/db.ts:applyPortfolioImport.
 *
 * Provenance: every written lot carries meta identifying it as a screenshot
 * import (source, importedAt, extraction confidence, whether it is a
 * synthetic balancing transaction or an assumed cost basis), so downstream
 * analytics can always distinguish imported state from hand-entered trades.
 */
import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { applyPortfolioImport, type PortfolioImportWrite } from "@/lib/db";
import { invalidateDataset } from "@/lib/platform";
import { getClassAdapter, hasClassAdapter } from "@/lib/portfolio/model/adapter";
import "@/lib/portfolio/classes";
import type { ImportApplyAction } from "@/lib/portfolio/import/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  actions?: ImportApplyAction[];
  /** The user's assertion that the screenshots showed the complete portfolio — required for any "remove". */
  confirmedComplete?: boolean;
  portfolioId?: number;
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Validate one confirmed action into a ledger write. Returns an error string when it cannot be honored. */
function toWrite(
  a: ImportApplyAction,
  confirmedComplete: boolean,
  importedAt: string,
): { write: PortfolioImportWrite } | { error: string } {
  const symbol = normalizeSymbol(a.symbol);
  if (!symbol) return { error: `Invalid symbol "${a.symbol}"` };
  const name = typeof a.name === "string" && a.name.trim() ? a.name.trim() : symbol;
  const assetClass = typeof a.assetClass === "string" && hasClassAdapter(a.assetClass) ? a.assetClass : "equity";
  const unit = getClassAdapter(assetClass as Parameters<typeof getClassAdapter>[0]).unit;
  const currency = typeof a.currency === "string" && /^[A-Z]{3}$/.test(a.currency) ? a.currency : "USD";
  const confidence = a.confidence === "high" || a.confidence === "medium" ? a.confidence : "low";
  const provenance = {
    source: "screenshot-import",
    importedAt,
    confidence,
    ...(a.costAssumed ? { costBasisAssumed: true } : {}),
  };

  switch (a.action) {
    case "add":
    case "rebaseline":
    case "set-cash": {
      const quantity = a.quantity;
      const avgCost = a.action === "set-cash" ? 1 : a.avgCost;
      if (!isPositive(quantity)) return { error: `${symbol}: quantity must be a positive number` };
      if (!isPositive(avgCost)) return { error: `${symbol}: avg cost must be a positive number` };
      if (a.action === "add") {
        // A new position is an opening lot — additive, and honest about being
        // an aggregate: the screenshot proves the position, not the trades.
        return {
          write: {
            type: "lot",
            symbol,
            name,
            shares: quantity,
            price: avgCost,
            kind: "buy",
            assetClass,
            currency,
            unit,
            meta: { ...provenance, aggregateImport: true },
          },
        };
      }
      return {
        write: {
          type: "rebaseline",
          symbol,
          name,
          quantity,
          avgCost,
          assetClass: a.action === "set-cash" ? "cash" : assetClass,
          currency,
          unit: a.action === "set-cash" ? "currency" : unit,
          meta: { ...provenance, aggregateImport: true },
        },
      };
    }
    case "append-buy":
    case "append-sell": {
      const delta = a.delta;
      if (!delta || !isPositive(delta.quantity) || !isPositive(delta.price)) {
        return { error: `${symbol}: a balancing transaction needs a positive quantity and price` };
      }
      const kind = a.action === "append-buy" ? "buy" : "sell";
      if (delta.kind !== kind) return { error: `${symbol}: transaction direction doesn't match the action` };
      return {
        write: {
          type: "lot",
          symbol,
          name,
          shares: delta.quantity,
          price: delta.price,
          kind,
          assetClass,
          currency,
          unit,
          // `synthetic` marks this as a reconciliation artifact, NOT a real
          // trade — its price was solved to land the aggregate on the
          // screenshot, and no purchase date is claimed beyond "imported today".
          meta: { ...provenance, synthetic: true },
        },
      };
    }
    case "remove": {
      if (!confirmedComplete) {
        return { error: `${symbol}: removal requires confirming the screenshots show the complete portfolio` };
      }
      return { write: { type: "remove", symbol } };
    }
    default:
      return { error: `Unknown action "${String(a.action)}"` };
  }
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const actions = Array.isArray(body.actions) ? body.actions : [];
  if (actions.length === 0) {
    return NextResponse.json({ error: "No confirmed changes to apply" }, { status: 400 });
  }
  if (actions.length > 200) {
    return NextResponse.json({ error: "Too many actions in one import" }, { status: 400 });
  }
  const portfolioId = Number.isInteger(body.portfolioId) && (body.portfolioId as number) > 0 ? (body.portfolioId as number) : 1;
  const confirmedComplete = body.confirmedComplete === true;
  const importedAt = new Date().toISOString();

  const writes: PortfolioImportWrite[] = [];
  for (const action of actions) {
    const result = toWrite(action, confirmedComplete, importedAt);
    if ("error" in result) {
      // All-or-nothing: one invalid action rejects the batch rather than
      // silently applying a subset of what the user confirmed.
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    writes.push(result.write);
  }

  try {
    applyPortfolioImport(writes, portfolioId);
    // The cached report now describes a pre-import book — same invalidation
    // cascade as every other portfolio write path.
    invalidateDataset("portfolioReport");
    const counts = {
      added: actions.filter((a) => a.action === "add").length,
      updated: actions.filter((a) => a.action === "append-buy" || a.action === "append-sell" || a.action === "rebaseline" || a.action === "set-cash").length,
      removed: actions.filter((a) => a.action === "remove").length,
    };
    return NextResponse.json({ ok: true, ...counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply the import";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
