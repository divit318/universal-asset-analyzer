import type { AiAnalysis, Filing, Quote } from "./types";
import { formatCurrency, formatMarketCap, formatPercent } from "./format";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral";

export interface AnalysisInput {
  quote: Quote;
  filings: Filing[];
}

/**
 * Build the LLM prompt from structured market data. Pure so it can be tested
 * without contacting Ollama.
 */
export function buildAnalysisPrompt({ quote, filings }: AnalysisInput): string {
  const recentFilings =
    filings.length > 0
      ? filings
          .slice(0, 5)
          .map((f) => `- ${f.form} filed ${f.filedAt}: ${f.description}`)
          .join("\n")
      : "No recent SEC filings available.";

  return [
    "You are a concise equity research assistant. Analyze the asset below using ONLY the data provided.",
    "Do not invent numbers. If data is missing, say so. Keep the response under 200 words.",
    "",
    `Symbol: ${quote.symbol} (${quote.name})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${formatPercent(quote.changePercent)} today)`,
    `Market cap: ${formatMarketCap(quote.marketCap)}`,
    `P/E ratio: ${quote.peRatio ?? "n/a"}`,
    `52-week range: ${formatCurrency(quote.fiftyTwoWeekLow, quote.currency)} – ${formatCurrency(quote.fiftyTwoWeekHigh, quote.currency)}`,
    "",
    "Recent SEC filings:",
    recentFilings,
    "",
    "Provide: (1) a one-sentence summary, (2) 2-3 notable observations, (3) one risk to watch.",
  ].join("\n");
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

/** Run an analysis through the local Ollama instance. */
export async function analyzeWithOllama(
  input: AnalysisInput,
): Promise<AiAnalysis> {
  const prompt = buildAnalysisPrompt(input);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
    });
  } catch {
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_HOST}. Is it running? (\`ollama serve\`)`,
    );
  }

  const data = (await res.json()) as OllamaGenerateResponse;
  if (!res.ok || data.error) {
    throw new Error(
      data.error ?? `Ollama request failed (${res.status}). Is "${OLLAMA_MODEL}" pulled?`,
    );
  }

  return { model: OLLAMA_MODEL, analysis: (data.response ?? "").trim() };
}
