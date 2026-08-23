// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ToolExecutionSummary
} from "../../session/runtime-session-orchestrator.js";
import type { EffectiveTurnAuthoritySnapshot } from "@kilnai/core";
import {
  type RuntimeTurnDangerousCommandOutcome,
  type RuntimeTurnFileChange
} from "../../session/runtime-turn-record.js";
import {
  type RuntimeTurnAuthorityMutationViolation
} from "../../session/runtime-session-event-ledger.js";

export function dedupeByStableKey<T>(items: readonly T[], toKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = toKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function dangerousCommandOutcomeFromExecution(
  execution: ToolExecutionSummary,
): RuntimeTurnDangerousCommandOutcome | undefined {
  if (execution.success) {
    return undefined;
  }
  const summary = execution.resultSummary.trim();
  const denyPrefix = "Dangerous command blocked: ";
  const askPrefix = "Command requires approval: ";
  let action: "ask" | "deny";
  let details: string;
  if (summary.startsWith(denyPrefix)) {
    action = "deny";
    details = summary.slice(denyPrefix.length);
  } else if (summary.startsWith(askPrefix)) {
    action = "ask";
    details = summary.slice(askPrefix.length);
  } else {
    return undefined;
  }
  const match = /^(.*)\s+\(([^()]+)\)$/.exec(details);
  if (!match) {
    return undefined;
  }
  const reason = match[1]?.trim();
  const reasonCode = match[2]?.trim();
  if (!reason || !reasonCode) {
    return undefined;
  }
  return {
    toolName: execution.toolName,
    action,
    reasonCode,
    reason,
  };
}

export function buildAuthorityMutationViolation(
  effectiveTurnAuthority: EffectiveTurnAuthoritySnapshot | undefined,
  fileChanges: readonly RuntimeTurnFileChange[],
): RuntimeTurnAuthorityMutationViolation | undefined {
  if (!effectiveTurnAuthority || fileChanges.length === 0) {
    return undefined;
  }
  if (!turnAuthorityDisallowsMutation(effectiveTurnAuthority)) {
    return undefined;
  }
  return {
    errorCode: "AUTHORITY_MUTATION_VIOLATION",
    message: "Observed file changes outside admitted turn authority.",
    details: {
      executionMode: effectiveTurnAuthority.executionMode,
      requestedAuthority: effectiveTurnAuthority.requestedAuthority,
      admittedAuthority: effectiveTurnAuthority.admittedAuthority,
      fileChangeCount: fileChanges.length,
      paths: fileChanges.map((change) => change.path),
    },
  };
}

function turnAuthorityDisallowsMutation(
  authority: EffectiveTurnAuthoritySnapshot,
): boolean {
  return authority.executionMode === "plan"
    || authority.requestedAuthority === "planning"
    || authority.requestedAuthority === "read_only"
    || authority.admittedAuthority === "read_only"
    || authority.admittedAuthority === "fail_closed";
}
