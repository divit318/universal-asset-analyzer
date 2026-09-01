/**
 * IC Report API.
 *
 * POST /api/ic-report — start (or attach to) a report run for a symbol and
 * stream Server-Sent Events as the pipeline progresses. The run is owned by
 * the in-flight registry, not by the HTTP stream: closing the tab does not
 * kill the run, and a new request for the same symbol re-attaches and
 * replays the events so far.
 *
 * GET /api/ic-report?symbol=X — run status plus persisted report history,
 * used by the page to restore state on load.
 *
 * Pre-flight checks (Phase 5.6) fail in seconds, not minutes: ticker
 * resolvable, a model available for the agent task.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getFundamentals } from "@/lib/fundamentals";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";
import { getFinancialStatements, getFinancialStatementsYahoo } from "@/lib/statements";
import { getQuote } from "@/lib/yahoo";
import { getScreenerInCompany } from "@/lib/screener-in";
import { generateICReport, type ICProgressEvent } from "@/lib/ic-report";
import { getValuationCase } from "@/lib/db";
import { fetchValuationFacts, type ValuationFacts } from "@/lib/valuation/prefill";
import { getEnginePriorEnsured } from "@/lib/valuation/engine-prior";
import { pickModel } from "@/lib/ai/router";
import { getRun, startRun, recordEvent, finishRun, getReport, listReports, type InFlightRun } from "@/lib/ic/store";

/** Tickers are interpolated into prompts, URLs and filenames — allow only
 * exchange-symbol characters (Phase 9.5). */
const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/;

/* ── GET: status + history ──────────────────────────────────────────────── */

export async function GET(req: Request): Promise<Response> {
  const symbol = new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!SYMBOL_RE.test(symbol)) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }
  const generatedAt = new URL(req.url).searchParams.get("generatedAt") ?? undefined;
  const run = getRun(symbol);
  return Response.json({
    inFlight: run ? { status: run.status, startedAt: run.startedAt, events: run.events.length } : null,
    history: listReports(symbol),
    report: getReport(symbol, generatedAt),
  });
}

/* ── POST: start or attach ──────────────────────────────────────────────── */

async function executeRun(
  run: InFlightRun,
  symbol: string,
  isIndian: boolean,
  model: string | undefined,
): Promise<void> {
  const emit = (event: ICProgressEvent) => recordEvent(run, event);
  try {
    emit({ stage: "signals", message: `Loading data for ${symbol}…`, at: new Date().toISOString() });

    // Load all data in parallel — fail gracefully on any individual source
    const [quoteResult, fundamentalsResult, statementsResult, screenerInResult, factsResult] =
      await Promise.allSettled([
        getQuote(symbol),
        getFundamentals(symbol),
        getFinancialStatements(symbol),
        isIndian ? getScreenerInCompany(symbol) : Promise.resolve(null),
        fetchValuationFacts(symbol),
      ]);

    const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
    const fundamentals = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : null;
    let statements = statementsResult.status === "fulfilled" ? statementsResult.value : null;
    let statementsProvider: "sec-edgar" | "yahoo-timeseries" = "sec-edgar";
    if (!statements) {
      statements = await getFinancialStatementsYahoo(symbol).catch(() => null);
      statementsProvider = "yahoo-timeseries";
    }
    const screenerIn = screenerInResult.status === "fulfilled" ? screenerInResult.value : null;
    const vFacts: ValuationFacts | null = factsResult.status === "fulfilled" ? factsResult.value : null;

    if (!quote && !fundamentals) {
      finishRun(run, null, `Could not load any data for ${symbol}. Check the ticker.`);
      emit({ stage: "error", message: `Could not load any data for ${symbol}. Check the ticker.`, at: new Date().toISOString() });
      return;
    }

    // ADR-class currency mismatch: fetch the FX rate so financial figures can
    // be converted into the trading currency instead of silently mixed.
    const financialCurrency = fundamentals?.snapshot?.financialCurrency ?? null;
    const tradingCurrency = quote?.currency ?? null;
    let fxToTrading: number | null = null;
    if (financialCurrency && tradingCurrency && financialCurrency !== tradingCurrency) {
      fxToTrading = await getQuote(`${financialCurrency}${tradingCurrency}=X`)
        .then((fxq) => (fxq.price > 0 ? fxq.price : null))
        .catch(() => null);
    }

    // Reconcile against the ValuationCase only when one already exists.
    // Generating a report must not manufacture a persisted case as a side
    // effect: five of the eight cases in a real database turned out to be
    // ic_report seeds the user never asked for — and this path's growth clamp
    // treated percent as fraction (Math.min(0.25, 18.9) → a 0.25% growth
    // seed), which is how a $102 stock got a $9.83 "fair value". No case →
    // the report renders "no saved case to reconcile against", which the
    // exporters already handle.
    const valuationCase = getValuationCase(symbol);

    const wacc = vFacts
      ? {
          value: vFacts.wacc.wacc,
          components: `CAPM: risk-free ${(vFacts.wacc.riskFree * 100).toFixed(1)}% + beta ${vFacts.wacc.beta?.toFixed(2) ?? "1.00"} × ERP ${(vFacts.wacc.erp * 100).toFixed(1)}%, debt weight ${(vFacts.wacc.debtWeight * 100).toFixed(0)}% (${vFacts.wacc.region})`,
        }
      : { value: 0.10, components: "platform default 10.0% (WACC inputs unavailable for this name)" };

    const report = await generateICReport(
      {
        symbol,
        canonical: {
          symbol,
          quote,
          snapshot: fundamentals?.snapshot ?? null,
          analyst: fundamentals?.analyst ?? null,
          insider: fundamentals?.insider ?? null,
          statements,
          statementsProvider,
          screenerIn,
          fxToTrading,
        },
        wacc,
        valuationCase,
        enginePriorP50: (await getEnginePriorEnsured(symbol).catch(() => null))?.p50 ?? null,
        model,
      },
      emit,
    );

    finishRun(run, report, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    finishRun(run, null, message);
    recordEvent(run, { stage: "error", message, at: new Date().toISOString() });
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: { symbol?: string; model?: string };
  try {
    body = (await req.json()) as { symbol?: string; model?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase() ?? "";
  if (!SYMBOL_RE.test(symbol)) {
    return Response.json({ error: "Invalid symbol: use exchange ticker characters only (A-Z, 0-9, dot, dash)" }, { status: 400 });
  }
  const model = typeof body.model === "string" && /^[\w.:\-\/]{1,64}$/.test(body.model) ? body.model : undefined;

  const isIndian = symbol.endsWith(".NS") || symbol.endsWith(".BO");

  // Pre-flight (Phase 5.6): fail in seconds. Quote resolution doubles as the
  // ticker check; pickModel confirms a model is installed and routable.
  let existing = getRun(symbol);
  if (!existing || existing.status !== "running") {
    const [quoteCheck, modelCheck] = await Promise.allSettled([
      getQuote(symbol),
      pickModel("ic-agent-analysis"),
    ]);
    if (quoteCheck.status === "rejected") {
      return Response.json(
        { error: `"${symbol}" did not resolve to a quotable ticker (${quoteCheck.reason instanceof Error ? quoteCheck.reason.message : "provider error"}). For NSE use SYMBOL.NS, for BSE SYMBOL.BO.` },
        { status: 422 },
      );
    }
    if (modelCheck.status === "rejected" || modelCheck.value == null) {
      return Response.json(
        { error: `No AI model is available for the agent task. ${AI_RECOVERY_HINT}` },
        { status: 503 },
      );
    }
    // Detached execution: the run outlives this request (Phase 7.4).
    existing = startRun(symbol);
    void executeRun(existing, symbol, isIndian, model);
  }

  const run = existing;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: ICProgressEvent & { report?: unknown }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true; // client went away; the run continues without us
        }
      };

      // Replay history so re-attaching clients see the full run.
      for (const e of run.events) send(e);
      if (run.status !== "running") {
        if (run.status === "done" && run.report) {
          send({ stage: "done", message: "Report complete", report: run.report, at: new Date().toISOString() });
        } else if (run.status === "error") {
          send({ stage: "error", message: run.error ?? "Unknown error", at: new Date().toISOString() });
        }
        controller.close();
        return;
      }

      const listener = (event: ICProgressEvent) => {
        if (event.stage === "done" && run.report) {
          send({ ...event, report: run.report });
        } else {
          send(event);
        }
        if (event.stage === "done" || event.stage === "error") {
          run.listeners.delete(listener);
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          }
        }
      };
      run.listeners.add(listener);
    },
    cancel() {
      // Stream cancelled by the client — the run itself keeps going.
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
