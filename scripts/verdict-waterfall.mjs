#!/usr/bin/env node
/**
 * Measure the /api/ai/report NDJSON waterfall: time from request start to each
 * frame (manifest, each section, done). Temporary diagnostic for the Research
 * verdict latency investigation.
 *
 * Usage: node scripts/verdict-waterfall.mjs SYMBOL [--refresh] [--params k=v,...] [--base URL]
 */
const args = process.argv.slice(2);
const symbol = args[0] ?? "AAPL";
const refresh = args.includes("--refresh");
const baseIdx = args.indexOf("--base");
const base = baseIdx !== -1 ? args[baseIdx + 1] : "http://localhost:3000";
const paramsIdx = args.indexOf("--params");
const extra = new URLSearchParams();
if (paramsIdx !== -1) {
  for (const kv of (args[paramsIdx + 1] ?? "").split(",")) {
    const [k, v] = kv.split("=");
    if (k && v != null) extra.set(k, v);
  }
}
extra.set("symbol", symbol);
if (refresh) extra.set("refresh", "1");

const url = `${base}/api/ai/report?${extra.toString()}`;
const t0 = performance.now();
const ms = () => (performance.now() - t0).toFixed(0).padStart(6);

console.log(`GET ${url}`);
const res = await fetch(url);
console.log(`${ms()}ms  headers (status ${res.status})`);
if (!res.ok || !res.body) {
  console.log(await res.text());
  process.exit(1);
}
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "manifest") {
      console.log(`${ms()}ms  manifest  cache=${ev.cache} timings=${JSON.stringify(ev.timings)}`);
    } else if (ev.type === "section") {
      const preview = typeof ev.data === "string" ? ev.data.slice(0, 60) : JSON.stringify(ev.data)?.slice(0, 60);
      console.log(`${ms()}ms  section   ${ev.id.padEnd(12)} ${preview}`);
    } else if (ev.type === "done") {
      console.log(`${ms()}ms  done      model=${ev.model} durationMs=${ev.durationMs} fromCache=${ev.fromCache ?? false}`);
    } else if (ev.type === "error") {
      console.log(`${ms()}ms  error     ${ev.error}`);
    }
  }
}
console.log(`${ms()}ms  stream closed`);
