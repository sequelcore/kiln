import type { SessionReport, ContextGovernanceSummary } from "../wrapper/index.js";
import {
  formatContextUsageProjection,
  formatVerifiedEfficiencyEvidence,
} from "@kilnai/gateway-contracts";
import type { ProjectedContext, ProjectedContextBlockKind } from "./context-types.js";

type EvalScoreLabel = "excellent" | "good" | "fair" | "poor";
type LineWriter = (line?: string) => void;

function formatKindCounts(counts: Partial<Record<ProjectedContextBlockKind, number>>): string {
  return Object.entries(counts)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([kind, count]) => `${kind}:${count}`)
    .join(", ");
}

function formatSourceCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([source, count]) => `${source}:${count}`)
    .join(", ");
}

function inferDeferredReasons(projectedContext: ProjectedContext): string[] {
  const latestAuditEntry = projectedContext.auditTrail?.[projectedContext.auditTrail.length - 1];
  if (latestAuditEntry) {
    return [
      ...new Set(
        latestAuditEntry.blocks
          .filter((block) => block.decision === "deferred")
          .map((block) => block.reason),
      ),
    ];
  }

  const reasons = new Set<string>();
  const deferredBlocks = projectedContext.deferredBlocks ?? [];

  if (deferredBlocks.length === 0) {
    return [];
  }
  if (projectedContext.overflow) {
    reasons.add("required-overflow");
  }

  for (const block of deferredBlocks) {
    if (block.kind === "summary") {
      reasons.add("lower-priority-summary");
    } else if (block.kind === "memory") {
      reasons.add("lower-priority-memory");
    } else if (block.kind === "artifact") {
      reasons.add("artifact-budget-pressure");
    } else if (block.kind === "ledger") {
      reasons.add("ledger-budget-pressure");
    }
  }

  if (!projectedContext.overflow && deferredBlocks.length > 0) {
    reasons.add("budget-cap");
  }

  return [...reasons];
}

export function summarizeContextGovernance(projectedContext: ProjectedContext): ContextGovernanceSummary {
  const selectedKinds: Partial<Record<ProjectedContextBlockKind, number>> = {};
  const deferredKinds: Partial<Record<ProjectedContextBlockKind, number>> = {};
  const selectedSources: Record<string, number> = {};
  const deferredSources: Record<string, number> = {};

  for (const block of projectedContext.blocks) {
    selectedKinds[block.kind] = (selectedKinds[block.kind] ?? 0) + 1;
    selectedSources[block.source] = (selectedSources[block.source] ?? 0) + 1;
  }
  for (const block of projectedContext.deferredBlocks ?? []) {
    deferredKinds[block.kind] = (deferredKinds[block.kind] ?? 0) + 1;
    deferredSources[block.source] = (deferredSources[block.source] ?? 0) + 1;
  }

  return {
    selectedTokens: projectedContext.estimatedTokens,
    tokenBudget: projectedContext.tokenBudget,
    overflow: projectedContext.overflow ?? false,
    selectedCount: projectedContext.blocks.length,
    deferredCount: projectedContext.deferredBlocks?.length ?? 0,
    selectedKinds,
    deferredKinds,
    selectedSources,
    deferredSources,
    deferredReasons: inferDeferredReasons(projectedContext),
  };
}

export function formatContextGovernancePreview(summary: ContextGovernanceSummary): string[] {
  const selectedKinds = formatKindCounts(summary.selectedKinds);
  const deferredKinds = formatKindCounts(summary.deferredKinds);
  const selectedSources = formatSourceCounts(summary.selectedSources);
  const deferredSources = formatSourceCounts(summary.deferredSources);
  const lines = [
    "Context preview:",
    `  ${summary.selectedTokens}/${summary.tokenBudget ?? "?"} tok`
    + `, selected ${summary.selectedCount}`
    + `, deferred ${summary.deferredCount}`
    + (summary.overflow ? ", overflow" : ""),
  ];

  if (selectedKinds) {
    lines.push(`  selected kinds: ${selectedKinds}`);
  }
  if (deferredKinds) {
    lines.push(`  deferred kinds: ${deferredKinds}`);
  }
  if (selectedSources) {
    lines.push(`  selected src:   ${selectedSources}`);
  }
  if (deferredSources) {
    lines.push(`  deferred src:   ${deferredSources}`);
  }
  if (summary.deferredReasons.length > 0) {
    lines.push(`  deferred why:   ${summary.deferredReasons.join(", ")}`);
  }
  lines.push("");
  return lines;
}

export function printContextGovernancePreview(summary: ContextGovernanceSummary, writeLine: LineWriter = console.log): void {
  for (const line of formatContextGovernancePreview(summary)) {
    writeLine(line);
  }
}

export function computeEvalScore(opts: {
  succeeded: boolean;
  durationMs: number;
  costUsd: number;
  verificationPassed: boolean | undefined;
  toolCallCount: number;
}): { score: number; label: EvalScoreLabel; signals: string[] } {
  let score = 0.5;
  const signals: string[] = [];

  if (opts.succeeded) {
    score += 0.2;
    signals.push("session succeeded");
  }

  if (opts.verificationPassed === true) {
    score += 0.1;
    signals.push("gates passed");
  } else if (opts.verificationPassed === false) {
    score -= 0.2;
    signals.push("gates failed");
  }

  if (opts.costUsd > 0.5) {
    score -= 0.1;
    signals.push("high cost");
  }

  if (opts.toolCallCount > 0) {
    score += 0.1;
    signals.push("agent used tools");
  }

  if (opts.durationMs > 120_000) {
    score -= 0.1;
    signals.push("slow session");
  }

  const clamped = Math.max(0, Math.min(1, score));
  const label: EvalScoreLabel = clamped >= 0.8
    ? "excellent"
    : clamped >= 0.6
      ? "good"
      : clamped >= 0.4
        ? "fair"
        : "poor";

  return { score: clamped, label, signals };
}

export function formatReport(report: SessionReport, appName: string): string[] {
  const costParts = Object.entries(report.cost.byRoleModel)
    .map(([role, value]) => `${role}: $${value.toFixed(2)}`)
    .join(", ");

  const durationSec = (report.duration / 1000).toFixed(1);
  const appLabel = appName.charAt(0).toUpperCase() + appName.slice(1);
  const lines = [
    `\n--- ${appLabel} Session Complete ---`,
    `Task:     ${report.task}`,
    `Domain:   ${report.domain}`,
    `Phase:    ${report.phaseReached}`,
    `Cost:     $${report.cost.total.toFixed(2)}${costParts ? ` (${costParts})` : ""}`,
    `Duration: ${durationSec}s`,
  ];

  if ((report as { resumedFrom?: string }).resumedFrom) {
    lines.push(`Resumed:  from session ${(report as { resumedFrom: string }).resumedFrom}`);
  }
  if (report.resumeStrategy && report.resumeStrategy !== "none") {
    lines.push(`Resume:   ${report.resumeStrategy}`);
  }
  if (report.resumeFeedback && report.resumeStrategy && report.resumeStrategy !== "none") {
    const preferred = report.resumeFeedback.preferredStrategy
      ? `, prefer ${report.resumeFeedback.preferredStrategy}`
      : "";
    const source = report.resumeFeedback.influencedChoice ? "applied" : "observed";
    lines.push(`Resumeƒ:  ${source}${preferred}, ${report.resumeFeedback.sampleSize} samples`);
  }
  if (report.resumeOutcome && report.resumeStrategy && report.resumeStrategy !== "none") {
    lines.push(
      `Resume→   ${report.resumeOutcome.succeeded ? "success" : "failure"}`
      + `, $${report.resumeOutcome.costUsd.toFixed(2)}`
      + `, ${report.resumeOutcome.toolCallCount} tools`
      + (report.resumeOutcome.finalProvider ? `, ${report.resumeOutcome.finalProvider}` : ""),
    );
  }
  if (report.contextGovernance) {
    const selectedKinds = formatKindCounts(report.contextGovernance.selectedKinds);
    const deferredKinds = formatKindCounts(report.contextGovernance.deferredKinds);
    const selectedSources = formatSourceCounts(report.contextGovernance.selectedSources);
    const deferredSources = formatSourceCounts(report.contextGovernance.deferredSources);
    lines.push(
      `Context:  ${report.contextGovernance.selectedTokens}/${report.contextGovernance.tokenBudget ?? "?"} tok`
      + `, selected ${report.contextGovernance.selectedCount}`
      + `, deferred ${report.contextGovernance.deferredCount}`
      + (report.contextGovernance.overflow ? ", overflow" : "")
    );
    if (selectedKinds) {
      lines.push(`Context✓: ${selectedKinds}`);
    }
    if (deferredKinds) {
      lines.push(`Context…: ${deferredKinds}`);
    }
    if (selectedSources) {
      lines.push(`Context+: ${selectedSources}`);
    }
    if (deferredSources) {
      lines.push(`Context-: ${deferredSources}`);
    }
    if (report.contextGovernance.deferredReasons.length > 0) {
      lines.push(`Context?: ${report.contextGovernance.deferredReasons.join(", ")}`);
    }
  }
  if (report.contextUsage) {
    lines.push(`Context usage: ${formatContextUsageProjection(report.contextUsage)}`);
  }
  if (report.efficiencyEvidence) {
    lines.push(formatVerifiedEfficiencyEvidence(report.efficiencyEvidence));
  }
  if (report.verificationResult) {
    const v = report.verificationResult;
    lines.push(`Gates:    ${v.passed ? "all passed" : "FAILED"}`);
    for (const check of v.checks) {
      const icon = check.passed ? "✓" : "✗";
      lines.push(`  ${icon} ${check.name} (${check.duration}ms)`);
      if (!check.passed) {
        lines.push(`    ${check.output.slice(0, 300)}`);
      }
    }
  }
  if (report.evalScore) {
    lines.push(`Score:    ${report.evalScore.label} (${(report.evalScore.score * 100).toFixed(0)}%)`);
  }
  lines.push("");
  return lines;
}

export function printReport(report: SessionReport, appName: string, writeLine: LineWriter = console.log): void {
  for (const line of formatReport(report, appName)) {
    writeLine(line);
  }
}
