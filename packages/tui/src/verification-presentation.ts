import type { ToolResultVerificationPresentation } from "@kilnai/gateway-contracts";

export function formatVerificationPresentationAsText(
  verification: ToolResultVerificationPresentation,
): string {
  if (verification.kind === "formal") return formatFormal(verification);
  if (verification.kind === "static") return formatStatic(verification);
  if (verification.kind === "quality") return formatQuality(verification);
  return formatInferential(verification);
}

function formatFormal(
  verification: Extract<ToolResultVerificationPresentation, { readonly kind: "formal" }>,
): string {
  const totalResourceCount = verification.checks.reduce((total, check) => total + check.resourceCount, 0);
  const lines = [
    `${verification.outcome} · ${engineLabel(verification.engine.name)} ${verification.engine.version}`,
    candidateLine(verification),
    `${verification.totals.proved}/${verification.totals.total} obligations proved · ${formatNumber(totalResourceCount)} RU`,
  ];
  for (const check of verification.checks) {
    lines.push(`${outcomeMark(check.outcome)} ${check.label} · ${formatNumber(check.resourceCount)} RU · ${formatNumber(check.durationMs)} ms`);
    if (check.detail) lines.push(`  ${check.detail}`);
  }
  lines.push(assuranceLine());
  return lines.join("\n");
}

function formatStatic(
  verification: Extract<ToolResultVerificationPresentation, { readonly kind: "static" }>,
): string {
  const count = verification.diagnostics.length;
  const lines = [
    `${verification.outcome} · ${engineLabel(verification.engine.name)} ${verification.engine.version}`,
    candidateLine(verification),
    `${count} diagnostic${count === 1 ? "" : "s"} · ${formatNumber(verification.profile.rulesAnalyzed)} rules`,
  ];
  for (const diagnostic of verification.diagnostics) {
    lines.push(`${diagnostic.severity === "error" ? "✗" : "!"} ${diagnostic.rule ?? diagnostic.severity} · ${diagnosticLocation(diagnostic)} · ${diagnostic.message}`);
  }
  lines.push(assuranceLine());
  return lines.join("\n");
}

function formatInferential(
  verification: Extract<ToolResultVerificationPresentation, { readonly kind: "inferential" }>,
): string {
  const lines = [
    `${humanize(verification.outcome.applicability)} · ${engineLabel(verification.engine.name)} ${verification.engine.version}`,
    candidateLine(verification),
    `state ${verification.transaction.state} · action ${verification.outcome.action} · replay ${verification.outcome.replayability}`,
    `lineage ${verification.transaction.lineageId}`,
  ];
  if (verification.outcome.nextTransition) {
    lines.push(`next ${verification.outcome.nextTransition.kind} · ${verification.outcome.nextTransition.reasonCode}`);
  }
  lines.push(assuranceLine());
  return lines.join("\n");
}

function formatQuality(
  verification: Extract<ToolResultVerificationPresentation, { readonly kind: "quality" }>,
): string {
  const diagnosticCount = verification.profiles.reduce((count, profile) => count + profile.diagnostics.length, 0);
  const lines = [
    `${verification.outcome} · Kiln Quality ${verification.engine.version}`,
    candidateLine(verification),
    diagnosticCount === 0 ? "No configured quality diagnostics" : `${diagnosticCount} configured quality diagnostic${diagnosticCount === 1 ? "" : "s"}`,
    `parser ${verification.engine.parser.name} ${verification.engine.parser.version}`,
  ];
  for (const profile of verification.profiles) {
    lines.push(`${profile.name}/${profile.revision} · ${profile.rules.length} rules`);
    lines.push(`  ${profile.rules.map((rule) => `${rule.name}/${rule.revision}`).join(", ")}`);
    for (const diagnostic of profile.diagnostics) {
      lines.push(`! ${diagnostic.rule.name}/${diagnostic.rule.revision} · ${verification.candidate.subjects[0]?.path}:${diagnostic.line}:${diagnostic.column} · ${diagnostic.message}`);
    }
  }
  lines.push(assuranceLine());
  return lines.join("\n");
}

function candidateLine(verification: ToolResultVerificationPresentation): string {
  const paths = verification.candidate.subjects.map((subject) => subject.path).join(", ");
  return `candidate ${compactDigest(verification.candidate.digest)}${paths ? ` · ${paths}` : ""}`;
}

function compactDigest(value: string): string {
  return value.length > 28 ? `${value.slice(0, 19)}…${value.slice(-8)}` : value;
}

function assuranceLine(): string {
  return "Assurance: separate decision · evidence only";
}

function engineLabel(value: string): string {
  if (value === "dafny") return "Dafny";
  if (value === "oxlint") return "Oxlint";
  if (value === "gentle-ai") return "Gentle AI";
  return value;
}

function outcomeMark(value: "proved" | "refuted" | "unresolved"): string {
  if (value === "proved") return "✓";
  if (value === "refuted") return "✗";
  return "?";
}

function humanize(value: string): string {
  return value.replace(/_/gu, " ");
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function diagnosticLocation(
  diagnostic: Extract<ToolResultVerificationPresentation, { readonly kind: "static" }>["diagnostics"][number],
): string {
  if (diagnostic.line === undefined) return diagnostic.file;
  return `${diagnostic.file}:${diagnostic.line}${diagnostic.column === undefined ? "" : `:${diagnostic.column}`}`;
}
