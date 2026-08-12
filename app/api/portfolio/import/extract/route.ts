/**
 * POST /api/portfolio/import/extract — read brokerage screenshot(s) into a
 * reviewable reconciliation preview. NO WRITES happen here: the response is
 * everything the confirmation dialog shows, and nothing changes until the
 * user confirms through /api/portfolio/import/apply.
 *
 * multipart/form-data:
 *   images      1–6 image files (png/jpeg/webp/gif, ≤ 8MB each)
 *   complete    "complete" | "partial" | "unsure" — the user's own statement
 *               of whether the screenshots show the entire portfolio
 *   portfolioId optional, defaults to 1 (Main)
 */
import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/yahoo";
import { listLedgerPositionSummaries } from "@/lib/portfolio/store";
import { extractPortfolioScreenshots } from "@/lib/portfolio/import/extract";
import { validateExtraction, type QuoteCheck } from "@/lib/portfolio/import/validate";
import { reconcile, type ExistingPosition } from "@/lib/portfolio/import/reconcile";
import { classifyAiError } from "@/lib/ai/errors";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";
import type { ProviderImageAttachment } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGES = 6;
// 5MB is the per-image ceiling shared by the Anthropic API and the Devin CLI;
// accepting more here would only defer the failure to the provider.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with image files" }, { status: 400 });
  }

  const files = form.getAll("images").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Upload at least one screenshot" }, { status: 400 });
  }
  if (files.length > MAX_IMAGES) {
    return NextResponse.json({ error: `At most ${MAX_IMAGES} screenshots per import` }, { status: 400 });
  }
  for (const f of files) {
    if (!ALLOWED_TYPES.has(f.type)) {
      return NextResponse.json(
        { error: `"${f.name}" is ${f.type || "an unknown type"} — upload PNG, JPEG, WebP or GIF screenshots` },
        { status: 400 },
      );
    }
    if (f.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `"${f.name}" exceeds the 5MB per-image limit` }, { status: 400 });
    }
  }

  const completeRaw = form.get("complete");
  const assumeComplete = completeRaw === "complete";
  const portfolioIdRaw = Number(form.get("portfolioId") ?? 1);
  const portfolioId = Number.isInteger(portfolioIdRaw) && portfolioIdRaw > 0 ? portfolioIdRaw : 1;

  const images: ProviderImageAttachment[] = await Promise.all(
    files.map(async (f) => ({
      mediaType: f.type,
      base64: Buffer.from(await f.arrayBuffer()).toString("base64"),
    })),
  );

  try {
    const extraction = await extractPortfolioScreenshots(images);
    if (extraction.positions.length === 0 && !extraction.cash) {
      return NextResponse.json(
        {
          error:
            "No holdings could be read from the screenshots. Make sure the holdings table (symbols and quantities) is visible and not cut off.",
          warnings: extraction.warnings,
        },
        { status: 422 },
      );
    }

    // Live quotes for every extracted ticker — the ground truth the validation
    // pass checks tickers, names and prices against. Best-effort: a quote
    // provider outage degrades to "unverified" warnings, never a hard failure.
    const symbols = [...new Set(extraction.positions.map((p) => p.symbol).filter((s): s is string => !!s))];
    let quoteMap = new Map<string, QuoteCheck>();
    try {
      const quotes = await getQuotes(symbols);
      quoteMap = new Map(
        quotes.map((q) => [q.symbol.toUpperCase(), { symbol: q.symbol, name: q.name, price: q.price, currency: q.currency }]),
      );
    } catch {
      /* validation degrades gracefully without quotes */
    }

    const validation = validateExtraction(extraction, quoteMap);
    const existing: ExistingPosition[] = listLedgerPositionSummaries(portfolioId);
    const preview = reconcile(extraction, validation, existing, { assumeComplete });

    return NextResponse.json(preview);
  } catch (err) {
    // The Router's no-vision case deserves its own copy: the generic
    // "failed to answer, try again" advice cannot fix a missing capability.
    if (err instanceof Error && err.message.includes("no vision-capable model")) {
      return NextResponse.json(
        { error: `Reading screenshots needs a vision-capable AI provider. ${AI_RECOVERY_HINT}` },
        { status: 502 },
      );
    }
    const classified = classifyAiError(err);
    return NextResponse.json({ error: classified.message }, { status: 502 });
  }
}
