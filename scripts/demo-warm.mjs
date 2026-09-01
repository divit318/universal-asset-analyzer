/**
 * Pre-demo warm-up: pay every cold cost BEFORE anyone is watching.
 *
 * UAA is fast warm and slow cold, and the gap is not small. Measured on a
 * freshly restarted dev server (2026-09-01):
 *
 *   /api/home                     13 ms   (all inputs were persisted L2 hits)
 *   /api/portfolio/report         40 ms   (portfolioReport is persist:true)
 *   /api/home/brief               20 ms cached  vs  37.8 s on a real generation
 *   /api/research/bundle?MU      3.5 s cold      vs  ~0.3 s warm
 *   screener equity universe     ~9.6 min cold   vs  ~10 ms once built
 *
 * The screener is the one that ends a demo: its universe lives in process
 * memory, is built only when the first request arrives, and enriches ~1,100
 * uncached symbols from Yahoo at ~2.7 symbols/sec. Until it finishes, the
 * screener renders an empty table with a progress bar. Nothing about that is
 * broken — it is simply work that must happen once, and the only question is
 * whether it happens now or in front of the audience.
 *
 * So: run this, watch it go green, then start the demo.
 *
 *   node scripts/demo-warm.mjs                 # full warm, waits for screener
 *   node scripts/demo-warm.mjs --skip-screener # everything except the long pole
 *   node scripts/demo-warm.mjs --symbols=MU,NVDA
 *   node scripts/demo-warm.mjs --base=http://localhost:3111
 *
 * In `next dev` this ALSO forces Turbopack to compile each route, which is a
 * separate 0.4-5.2 s per-route cost the first time a page is visited. Note that
 * editing a file afterwards invalidates the module graph and drops the
 * in-memory universe — if you touch the code, run this again.
 *
 * Exits non-zero if a stage the demo depends on could not be warmed, so this
 * can gate a demo the way a preflight check gates a flight.
 */

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = opt("base", "http://localhost:3000").replace(/\/$/, "");
const SYMBOLS = opt("symbols", "MU").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const SKIP_SCREENER = flag("skip-screener");
/** The screener build is minutes long by nature; give it room but never hang forever. */
const SCREENER_BUDGET_MS = Number(opt("screener-budget", 15 * 60 * 1000));

const results = [];
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const now = () => performance.now();

const C = {
  reset: "\u001b[0m", dim: "\u001b[2m", bold: "\u001b[1m",
  green: "\u001b[32m", yellow: "\u001b[33m", red: "\u001b[31m", cyan: "\u001b[36m",
};

function record(stage, label, status, elapsed, detail = "") {
  results.push({ stage, label, status, elapsed, detail });
  const mark = status === "ok" ? `${C.green}ok${C.reset}`
    : status === "warn" ? `${C.yellow}warn${C.reset}`
    : `${C.red}FAIL${C.reset}`;
  const time = elapsed == null ? "" : ` ${C.dim}${ms(elapsed).padStart(7)}${C.reset}`;
  console.log(`  ${mark.padEnd(18)} ${label.padEnd(42)}${time} ${C.dim}${detail}${C.reset}`);
}

/**
 * One warm request. Streaming bodies (the research bundle, the brief) must be
 * drained, not just opened — the server does the work as it writes, so
 * abandoning the body would leave the cache half-filled and report a fast lie.
 */
async function warm(label, path, { method = "GET", body = null, timeoutMs = 300_000, stage } = {}) {
  const t0 = now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const text = await res.text(); // drains streams to completion
    const elapsed = now() - t0;
    if (!res.ok) {
      record(stage, label, "fail", elapsed, `HTTP ${res.status}`);
      return { ok: false, text, status: res.status };
    }
    record(stage, label, "ok", elapsed, `${(text.length / 1024).toFixed(0)} KB`);
    return { ok: true, text, status: res.status };
  } catch (err) {
    const elapsed = now() - t0;
    const why = err?.name === "AbortError" ? `timed out after ${ms(timeoutMs)}` : String(err?.message ?? err);
    record(stage, label, "fail", elapsed, why);
    return { ok: false, text: "", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer() {
  console.log(`\n${C.bold}0. Server${C.reset}`);
  const t0 = now();
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        record("server", `reachable at ${BASE}`, "ok", now() - t0);
        return true;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  record("server", `reachable at ${BASE}`, "fail", now() - t0, "no response in 60s — is the dev server running?");
  return false;
}

/**
 * Page shells. In dev this is the Turbopack compile pass; in prod it is nearly
 * free but still primes the module graph. Sequential on purpose: Turbopack
 * compiles one entry at a time, and firing these in parallel only makes the
 * per-route numbers unreadable without making the total faster.
 */
async function warmRoutes() {
  console.log(`\n${C.bold}1. Route compile / page shells${C.reset} ${C.dim}(the demo path)${C.reset}`);
  const routes = [
    "/", "/portfolio", `/research?symbol=${SYMBOLS[0]}`, "/valuation",
    "/ic-report", "/screener", "/wire", "/engine", "/watchlist", "/compare",
  ];
  for (const r of routes) await warm(r, r, { timeoutMs: 120_000, stage: "routes" });
}

/** The data behind the first two beats — portfolio, then the dashboard digest. */
async function warmData() {
  console.log(`\n${C.bold}2. Data endpoints${C.reset}`);
  await warm("/api/portfolio/report", "/api/portfolio/report?objective=maximize_sharpe&portfolioId=1", { stage: "data" });
  await warm("/api/home", "/api/home", { stage: "data" });
  await warm("/api/watchlist", "/api/watchlist", { stage: "data" });
  await warm("/api/sector-rotation", "/api/sector-rotation", { stage: "data" });

  for (const sym of SYMBOLS) {
    await warm(`/api/research/bundle ${sym}`, `/api/research/bundle?symbol=${encodeURIComponent(sym)}`, { stage: "data" });
  }
}

/**
 * The AI brief. Cached in scanner_cache under a key that includes the HOUR, so
 * it regenerates at least hourly and on any real change to the facts it
 * narrates — a 16.7 s p50 / 43.5 s max generation (task `daily-briefing` in the
 * ai_call ledger). It never blocks the page (the deterministic briefing ships
 * inside the digest), but the AI panel visibly filling in late is worth
 * avoiding. Warming it now also means the demo shows the AI copy, not the
 * fallback.
 */
async function warmBrief() {
  console.log(`\n${C.bold}3. AI brief${C.reset}`);
  const res = await warm("/api/home/brief", "/api/home/brief", { timeoutMs: 240_000, stage: "brief" });
  if (res.ok) {
    const aiGenerated = /"aiGenerated"\s*:\s*true/.test(res.text);
    record("brief", "brief is AI-generated (not fallback)", aiGenerated ? "ok" : "warn", null,
      aiGenerated ? "" : "serving deterministic fallback — AI provider unavailable?");
  }
}

/**
 * The screener universe. `stats=1` is enough to trigger `ensureBuild()`; from
 * there we poll the same status the UI polls and report a real ETA from the
 * observed enrichment rate, because a silent ten-minute wait is indistinguishable
 * from a hang.
 */
async function warmScreener() {
  console.log(`\n${C.bold}4. Screener universe${C.reset} ${C.dim}(the long pole)${C.reset}`);
  if (SKIP_SCREENER) {
    record("screener", "equity universe", "warn", null, "skipped via --skip-screener");
    return;
  }

  const t0 = now();
  const status = async () => {
    try {
      const res = await fetch(`${BASE}/api/screener?class=equity&stats=1`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      return (await res.json()).status ?? null;
    } catch {
      return null;
    }
  };

  await status(); // kicks ensureBuild()
  let last = -1;
  let lastLogged = 0;

  while (now() - t0 < SCREENER_BUDGET_MS) {
    const s = await status();
    if (s?.stage === "ready") {
      record("screener", "equity universe", "ok", now() - t0, `${s.ready}/${s.total} symbols`);
      return;
    }
    if (s && s.ready !== last) {
      last = s.ready;
      const elapsed = now() - t0;
      // Only speak every ~15s; the build emits progress far faster than a human
      // needs it, and a wall of lines hides the one number that matters.
      if (elapsed - lastLogged > 15_000 && s.ready > 0 && s.total > 0) {
        lastLogged = elapsed;
        const rate = s.ready / (elapsed / 1000);
        const etaS = rate > 0 ? (s.total - s.ready) / rate : 0;
        console.log(`  ${C.dim}building ${s.ready}/${s.total} (${(100 * s.ready / s.total).toFixed(0)}%) · ${rate.toFixed(1)}/s · ETA ~${Math.round(etaS / 60)}m${C.reset}`);
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  record("screener", "equity universe", "fail", now() - t0,
    `still building after ${ms(SCREENER_BUDGET_MS)} — screener will show a progress bar on camera`);
}

/* ------------------------------------------------------------------ */

console.log(`${C.bold}${C.cyan}UAA demo warm-up${C.reset} ${C.dim}→ ${BASE}${C.reset}`);

if (!(await waitForServer())) {
  console.log(`\n${C.red}${C.bold}NOT WARM${C.reset} — server unreachable. Start it with: scripts/ops/uaa start\n`);
  process.exit(1);
}

await warmRoutes();
await warmData();
await warmBrief();
await warmScreener();

/* ---- Verify the warm claim rather than asserting it ---------------- */

console.log(`\n${C.bold}5. Re-check (proves the caches are actually hot)${C.reset}`);

/**
 * For a progressive NDJSON endpoint, total drain time is the wrong number to
 * judge. The research bundle deliberately emits `quote` first so the page shell
 * paints, then fills sections in as they resolve; its last step landing at 3.7 s
 * is the design working, not a stall. What the user actually waits for is the
 * FIRST chunk, so measure that and report the drain alongside it as context.
 *
 * It will also never be a pure cache hit: the bundle carries a live quote
 * (15 s TTL) and news (15 min, not persisted), which is correct — nobody should
 * demo a stale price. Warming removes the multi-second cold cost, not the
 * deliberate freshness.
 */
async function recheckStream(label, path) {
  const t0 = now();
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) {
      record("recheck", label, "fail", now() - t0, `HTTP ${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    let first = null;
    for (;;) {
      const { done } = await reader.read();
      if (first == null) first = now() - t0;
      if (done) break;
    }
    const total = now() - t0;
    record("recheck", `${label} ${C.dim}(first chunk)${C.reset}`, first < 1500 ? "ok" : "warn", first,
      `full stream ${ms(total)}`);
  } catch (err) {
    record("recheck", label, "fail", now() - t0, String(err?.message ?? err));
  }
}

for (const [label, path] of [
  ["/api/home", "/api/home"],
  ["/api/portfolio/report", "/api/portfolio/report?objective=maximize_sharpe&portfolioId=1"],
  ["/api/home/brief", "/api/home/brief"],
]) {
  const t0 = now();
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(120_000) });
    await res.text();
    const elapsed = now() - t0;
    // 1.5s is the threshold where a human notices a page is waiting on something.
    record("recheck", label, elapsed < 1500 ? "ok" : "warn", elapsed,
      elapsed < 1500 ? "" : "still slow warm — investigate before demoing");
  } catch (err) {
    record("recheck", label, "fail", now() - t0, String(err?.message ?? err));
  }
}
await recheckStream(`/api/research/bundle ${SYMBOLS[0]}`, `/api/research/bundle?symbol=${SYMBOLS[0]}`);

/* ---- Verdict ------------------------------------------------------- */

const fails = results.filter((r) => r.status === "fail");
const warns = results.filter((r) => r.status === "warn");

console.log(`\n${"─".repeat(76)}`);
if (fails.length === 0 && warns.length === 0) {
  console.log(`${C.green}${C.bold}DEMO WARM${C.reset} — every stage green. Open ${BASE} and go.`);
} else if (fails.length === 0) {
  console.log(`${C.yellow}${C.bold}DEMO WARM (with ${warns.length} warning${warns.length === 1 ? "" : "s"})${C.reset}`);
  for (const w of warns) console.log(`  ${C.yellow}·${C.reset} ${w.label} — ${w.detail}`);
} else {
  console.log(`${C.red}${C.bold}NOT WARM${C.reset} — ${fails.length} stage${fails.length === 1 ? "" : "s"} failed:`);
  for (const f of fails) console.log(`  ${C.red}·${C.reset} ${f.label} — ${f.detail}`);
}
console.log(`${C.dim}Warm numbers above are what the audience will experience. Re-run after any code edit:${C.reset}`);
console.log(`${C.dim}  dev-mode HMR drops the in-memory screener universe on every file change.${C.reset}`);
console.log(`${"─".repeat(76)}\n`);

process.exit(fails.length > 0 ? 1 : 0);
