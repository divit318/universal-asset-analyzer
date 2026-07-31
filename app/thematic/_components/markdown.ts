import type { ThematicReport } from "@/lib/thematic-engine";

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
  if (r.tierCompanies.length > 0) {
    lines.push(
      "", "## Companies", "",
      "| Symbol | Tier | Role | Quality | Why |",
      "| --- | --- | --- | --- | --- |",
      ...r.tierCompanies.map(
        (c) => `| ${c.symbol} | T${c.tier} | ${c.strategicImportance} | ${c.qualityScore ?? "—"} | ${c.relevanceRationale.replace(/\|/g, "/")} |`,
      ),
    );
  }
  lines.push("", "## Analyst checklist", ...r.opportunity.analystChecklist.map(
    (q, i) => `${i + 1}. **${q.question}** (${q.signal})\n   ${q.answer}`,
  ));
  return lines.join("\n");
}
