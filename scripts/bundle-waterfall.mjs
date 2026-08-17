#!/usr/bin/env node
/** Measure /api/research/bundle step arrival times. Temporary diagnostic. */
const symbol = process.argv[2] ?? "AAPL";
const base = process.argv[3] ?? "http://localhost:3000";
const t0 = performance.now();
const ms = () => (performance.now() - t0).toFixed(0).padStart(6);
const res = await fetch(`${base}/api/research/bundle?symbol=${encodeURIComponent(symbol)}`);
console.log(`${ms()}ms  headers (${res.status})`);
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
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "step") console.log(`${ms()}ms  step ${String(ev.id).padEnd(16)} ${ev.status}`);
    else if (ev.type === "done") console.log(`${ms()}ms  done durationMs=${ev.durationMs}`);
    else console.log(`${ms()}ms  ${ev.type}`);
  }
}
