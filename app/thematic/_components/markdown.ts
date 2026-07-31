import type { ThematicReport } from "@/lib/thematic-engine";

function pct(v: number | null | undefined, digits = 1): string {
  return v != null && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%` : "—";
}

/** The whole report as pasteable Markdown — for a memo, an email, or a note. */
export function toMarkdown(r: ThematicReport): string {
  const lines: string[] = [
    `# ${r.theme} — Thematic Report`,
    "",
    `**Opportunity score:** ${r.opportunity.themeScore}/100 (${r.opportunity.verdict.toUpperCase()})`,
    `**Generated:** ${new Date(r.generatedAt).toLocaleString()} · ${r.model}`,
    `**Evidence:** ${r.integrity.stagesEvidenced}/${r.integrity.stagesTotal} AI stages evidenced · ${r.integrity.evidenceScore}% of the score weight`,
    "",
    r.opportunity.verdictRationale,
  ];
  if (r.opportunity.verdictCaveat) lines.push("", `> ${r.opportunity.verdictCaveat}`);
  if (r.integrity.caveats.length > 0) {
    lines.push("", "## Caveats", ...r.integrity.caveats.map((c) => `- ${c}`));
  }
  lines.push("", "## Score factors", ...r.opportunity.factors.map(
    (f) => `- **${f.label}** ${Math.round(f.score)}/100 (weight ${Math.round(f.weight * 100)}%)${f.evidenced ? "" : " — unevidenced"}`,
  ));
  if (r.opportunity.riskFlags.length > 0) {
    lines.push("", "## What could break this", ...r.opportunity.riskFlags.map((f) => `- **${f.label}** (${f.severity}) — ${f.detail}`));
  }
  if (r.dependencyChain.length > 0) {
    lines.push("", "## Dependency chain", ...r.dependencyChain.map(
      (n) => `- **T${n.tier} ${n.tierLabel}**${n.isBottleneck ? " *(bottleneck)*" : ""} — ${n.description}`,
    ));
  }

  // Supply-demand cycle — the export used to omit the whole section, so a
  // memo built from this file lost the timing half of the framework.
  const sd = r.supplyDemand;
  lines.push(
    "", "## Supply–demand cycle",
    `Demand **${sd.demandTrajectory}** · Supply **${sd.supplyTrajectory}** · Cycle phase **${sd.capitalCyclePhase}** · Entry signal **${sd.investmentSignal}** (score ${sd.score}/10)`,
  );
  if (sd.demandDrivers.length > 0) lines.push("", "**Demand drivers**", ...sd.demandDrivers.map((d) => `- ${d}`));
  if (sd.supplyConstraints.length > 0) lines.push("", "**Supply constraints**", ...sd.supplyConstraints.map((c) => `- ${c}`));
  if (sd.commodityProxies.length > 0) {
    const drawdownByTicker = new Map((r.proxyPerformance?.proxies ?? []).map((p) => [p.ticker, p.maxDrawdown1Y]));
    lines.push(
      "",
      "| Proxy | Price | 1M | 3M | 1Y | Max drawdown (1Y) |",
      "| --- | --- | --- | --- | --- | --- |",
      ...sd.commodityProxies.map((p) =>
        `| ${p.ticker} | ${p.price != null ? `$${p.price.toFixed(2)}` : "—"} | ${pct(p.priceChange1M)} | ${pct(p.priceChange3M)} | ${pct(p.priceChange1Y)} | ${pct(drawdownByTicker.get(p.ticker))} |`,
      ),
    );
  }

  // Policy table + geopolitics — previously dropped from the export entirely.
  if (r.policy.relevantPolicies.length > 0) {
    lines.push(
      "", "## Policy & geopolitics", "",
      "| Country | Policy | Capital | Impact |",
      "| --- | --- | --- | --- |",
      ...r.policy.relevantPolicies.map(
        (p) => `| ${p.country} | ${p.policy.replace(/\|/g, "/")} | ${p.estimatedCapitalUSD ?? "—"} | ${p.impact} |`,
      ),
    );
    if (r.policy.geopoliticalFactors.length > 0) lines.push("", ...r.policy.geopoliticalFactors.map((f) => `- ${f}`));
  }

  // Regional structural advantages — same omission.
  if (r.structuralAdvantage.regions.length > 0) {
    lines.push(
      "", "## Global structural advantage",
      `Leads: **${r.structuralAdvantage.currentLeader}** · Closing fastest: **${r.structuralAdvantage.fastestImproving}**`,
      "",
      r.structuralAdvantage.longTermImplications,
      "",
      ...r.structuralAdvantage.regions.map((reg) => {
        const adv = reg.advantages.length > 0 ? ` Advantages: ${reg.advantages.join("; ")}.` : "";
        const dis = reg.disadvantages.length > 0 ? ` Disadvantages: ${reg.disadvantages.join("; ")}.` : "";
        return `- **${reg.region}**${adv}${dis}`;
      }),
    );
  }
  if (r.tierCompanies.length > 0) {
    lines.push(
      "", "## Companies", "",
      "| Symbol | Tier | Role | Quality | Fwd P/E | vs 52w high | Why |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...r.tierCompanies.map(
        (c) => `| ${c.symbol} | T${c.tier} | ${c.strategicImportance} | ${c.qualityScore ?? "—"} | ${c.forwardPE != null ? c.forwardPE.toFixed(1) : "—"} | ${pct(c.distanceFrom52WkHigh)} | ${c.relevanceRationale.replace(/\|/g, "/")} |`,
      ),
    );
  }
  lines.push("", "## Analyst checklist", ...r.opportunity.analystChecklist.map(
    (q, i) => `${i + 1}. **${q.question}** (${q.signal})\n   ${q.answer}`,
  ));

  // The "why now" evidence — headlines used to stay behind in the app.
  if (r.newsItems.length > 0) {
    lines.push("", "## Recent headlines", ...r.newsItems.slice(0, 10).map(
      (n) => `- [${n.source}] ${n.headline}`,
    ));
  }
  return lines.join("\n");
}
