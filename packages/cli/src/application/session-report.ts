import type { SessionReport } from "../wrapper/index.js";

type EvalScoreLabel = "excellent" | "good" | "fair" | "poor";

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

export function printReport(report: SessionReport, appName: string): void {
  const costParts = Object.entries(report.cost.byRoleModel)
    .map(([role, value]) => `${role}: $${value.toFixed(2)}`)
    .join(", ");

  const durationSec = (report.duration / 1000).toFixed(1);
  const appLabel = appName.charAt(0).toUpperCase() + appName.slice(1);

  console.log(`\n--- ${appLabel} Session Complete ---`);
  console.log(`Task:     ${report.task}`);
  console.log(`Domain:   ${report.domain}`);
  console.log(`Phase:    ${report.phaseReached}`);
  console.log(`Cost:     $${report.cost.total.toFixed(2)}${costParts ? ` (${costParts})` : ""}`);
  console.log(`Duration: ${durationSec}s`);
  if ((report as { resumedFrom?: string }).resumedFrom) {
    console.log(`Resumed:  from session ${(report as { resumedFrom: string }).resumedFrom}`);
  }
  if (report.verificationResult) {
    const v = report.verificationResult;
    console.log(`Gates:    ${v.passed ? "all passed" : "FAILED"}`);
    for (const check of v.checks) {
      const icon = check.passed ? "✓" : "✗";
      console.log(`  ${icon} ${check.name} (${check.duration}ms)`);
      if (!check.passed) {
        console.log(`    ${check.output.slice(0, 300)}`);
      }
    }
  }
  if (report.evalScore) {
    console.log(`Score:    ${report.evalScore.label} (${(report.evalScore.score * 100).toFixed(0)}%)`);
  }
  console.log("");
}
