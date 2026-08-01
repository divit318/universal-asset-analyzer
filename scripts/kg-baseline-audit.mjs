// Phase 0 audit: fetch every scope from the running app and compute data-quality stats.
const BASE = process.env.BASE ?? "http://localhost:3000";

const scopes = [
  ["symbol", "AAPL"],
  ["symbol", "SKHY"],
  ["symbol", "USDCHF=X"],
  ["portfolio", "portfolio"],
  ["watchlist", "watchlist"],
  ["sector", "Technology"],
];

for (const [scope, id] of scopes) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/knowledge-graph?scope=${scope}&id=${encodeURIComponent(id)}`);
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`\n=== ${scope}:${id} -> HTTP ${res.status} (${ms}ms)`, (await res.text()).slice(0, 200));
    continue;
  }
  const g = await res.json();
  const degree = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const orphans = g.nodes.filter((n) => (degree.get(n.id) ?? 0) === 0);
  const ids = new Set();
  const dupes = [];
  for (const n of g.nodes) { if (ids.has(n.id)) dupes.push(n.id); ids.add(n.id); }
  const byType = {};
  for (const n of g.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const edgeTypes = {};
  for (const e of g.edges) edgeTypes[e.type] = (edgeTypes[e.type] ?? 0) + 1;
  const danglingEdges = g.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
  const eventOrphans = orphans.filter((n) => n.type === "timeline_event" || n.type === "market_event");
  const sectors = g.nodes.filter((n) => n.type === "sector").map((n) => n.label).sort();
  const labelDupes = {};
  for (const n of g.nodes) { labelDupes[n.label] = (labelDupes[n.label] ?? 0) + 1; }
  const dupLabels = Object.entries(labelDupes).filter(([, c]) => c > 1);
  console.log(`\n=== ${scope}:${id} (${ms}ms) nodes=${g.nodes.length} edges=${g.edges.length}`);
  console.log("  types:", JSON.stringify(byType));
  console.log("  edgeTypes:", JSON.stringify(edgeTypes));
  console.log(`  orphans=${orphans.length} (${orphans.map((n) => n.id).slice(0, 20).join(", ")})`);
  console.log(`  eventOrphans=${eventOrphans.length} dupIds=${dupes.length} danglingEdges=${danglingEdges.length}`);
  console.log("  sectors:", sectors.join(" | "));
  if (dupLabels.length) console.log("  duplicate labels:", dupLabels.map(([l, c]) => `${l} x${c}`).slice(0, 10).join("; "));
  console.log("  insights.correlationClusters:", JSON.stringify(g.insights.correlationClusters));
  console.log("  insights.concentrationRisks:", JSON.stringify(g.insights.concentrationRisks));
  const sample = g.nodes.filter((n) => n.type === "timeline_event").slice(0, 4).map((n) => n.label);
  if (sample.length) console.log("  sample event labels:", JSON.stringify(sample));
}
