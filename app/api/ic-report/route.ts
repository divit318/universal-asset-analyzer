/**
 * IC Report API — POST /api/ic-report
 *
 * Streams Server-Sent Events as the pipeline progresses through each stage.
 * Client receives one JSON event per stage completion.
 *
 * Request body: { symbol: string, exchange?: "IN" | "US" }
 * Each SSE event: data: <JSON>\n\n
 * Final event: data: {"stage":"done","report":{...}}\n\n
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements } from "@/lib/statements";
import { getQuote } from "@/lib/yahoo";
import { getScreenerInCompany } from "@/lib/screener-in";
import { generateICReport, type ICProgressEvent } from "@/lib/ic-report";
import { appendValuationEvent, getValuationCase } from "@/lib/db";
import { computeCaseResult, seedAssumptions } from "@/lib/valuation/case";
import { canValue, fetchValuationFacts } from "@/lib/valuation/prefill";
import { getEnginePriorEnsured } from "@/lib/valuation/engine-prior";

export async function POST(req: Request) {
  let body: { symbol?: string; exchange?: string; model?: string };
  try {
    body = (await req.json()) as { symbol?: string; exchange?: string; model?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol) {
    return Response.json({ error: "symbol is required" }, { status: 400 });
  }

  const isIndian = body.exchange === "IN" ||
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BO");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: ICProgressEvent & { report?: unknown }) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      try {
        send({ stage: "signals", message: `Loading data for ${symbol}…` });

        // Load all data in parallel — fail gracefully on any individual source
        const [quoteResult, fundamentalsResult, statementsResult, screenerInResult] =
          await Promise.allSettled([
            getQuote(symbol),
            getFundamentals(symbol),
            getFinancialStatements(symbol),
            isIndian ? getScreenerInCompany(symbol) : Promise.resolve(null),
          ]);

        const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
        const fundamentals = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : null;
        const statements = statementsResult.status === "fulfilled" ? statementsResult.value : null;
        const screenerIn = screenerInResult.status === "fulfilled" ? screenerInResult.value : null;

        if (!quote && !fundamentals) {
          send({ stage: "error", message: `Could not load any data for ${symbol}. Check the ticker.` });
          controller.close();
          return;
        }

        const companyName = quote?.name ?? screenerIn?.name ?? symbol;

        // The report adjudicates a valuation case rather than inventing a fair
        // value, so it needs one to exist. Seeding here (rather than inside the
        // pipeline) keeps lib/ic-report.ts free of database access. Non-fatal:
        // without a case the stage falls back to cross-checks only.
        let valuationCase = getValuationCase(symbol);
        if (!valuationCase) {
          try {
            const facts = await fetchValuationFacts(symbol);
            if (canValue(facts)) {
              const assumptions = seedAssumptions({
                baseFcf: facts.baseFcf!,
                sharesOutstanding: facts.sharesOutstanding!,
                netDebt: facts.netDebt ?? 0,
                price: facts.price,
                discountRate: facts.wacc.waccPercent,
                terminalGrowth: facts.terminalGrowth,
                deliveredGrowth: facts.deliveredGrowth.value,
                deliveredGrowthLabel: facts.deliveredGrowth.label,
              });
              valuationCase = appendValuationEvent({
                symbol,
                currency: facts.currency,
                author: "reverse",
                kind: "seeded",
                assumptions,
                result: computeCaseResult(assumptions, facts.price),
                priceAt: facts.price,
                triggerSource: "ic_report",
              });
            }
          } catch {
            /* non-fatal — the report runs its cross-checks without a case */
          }
        }

        const report = await generateICReport(
          {
            symbol,
            companyName,
            currentPrice: quote?.price ?? null,
            currency: quote?.currency === "INR" ? "₹" : "$",
            snapshot: fundamentals?.snapshot,
            statements,
            analyst: fundamentals?.analyst,
            insider: fundamentals?.insider,
            screenerIn,
            valuationCase,
            // Reconciling the case against the engine's Monte Carlo median is the
            // engine-vs-judgment comparison; null when the engine has not scored
            // this name, in which case the stage simply omits it.
            enginePriorP50: (await getEnginePriorEnsured(symbol).catch(() => null))?.p50 ?? null,
            model: body.model ?? undefined,
          },
          (event) => {
            send(event);
          },
        );

        send({ stage: "done", message: "Report complete", report });
      } catch (err) {
        send({
          stage: "error",
          message: err instanceof Error ? err.message : "Unexpected error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
