import { createHash } from "node:crypto";

/**
 * Content-free integrity projection for the post-fix context-efficiency
 * control. The collector owns row projection; this module only binds that
 * projection to a frozen cohort and reconciles its checkpointed attempts.
 */
export const CONTEXT_EFFICIENCY_REPORT_INTEGRITY_SCHEMA_VERSION =
  "kiln-context-efficiency-report-integrity-v1" as const;

export type ContextEfficiencyCondition = "cold" | "immediate_warm" | "long_session";

export interface ContextEfficiencyTrialIdentity {
  readonly taskId: string;
  readonly condition: ContextEfficiencyCondition;
  readonly repetition: number;
}

export interface ContextEfficiencyAttemptIdentity extends ContextEfficiencyTrialIdentity {
  readonly attempt: number;
}

export interface ContextEfficiencyFrozenScheduledTrial extends ContextEfficiencyTrialIdentity {
  /** The frozen full-attempt ceiling used for uncertain physical settlement. */
  readonly maximumProviderRequests: number;
}

/**
 * These are public identities or digests only. Configuration, prompts,
 * transcripts, tool results, and credentials are intentionally absent.
 */
export interface ContextEfficiencyFrozenReportIdentity {
  readonly manifestSchemaVersion: string;
  readonly startingCommit: string;
  readonly frozenManifestDigest: string;
  readonly sourceContractDigest: string;
  readonly inputContractDigest: string;
  readonly protocolContractDigest: string;
  readonly configurationRevisionId: string;
  readonly toolProjectionRecipeDigest: string;
  readonly executionIdentityDigest: string;
  readonly scheduleDigest: string;
  readonly targetId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly deliberationLevel: string;
}

export interface ContextEfficiencyFrozenSchedule {
  readonly entries: readonly ContextEfficiencyFrozenScheduledTrial[];
  readonly invalidRetryLimitPerCell: number;
}

export type ContextEfficiencyPhysicalRequestEvidence =
  | {
      readonly state: "observed";
      readonly physicalRequestCount: number;
    }
  | {
      /** A command can fail after dispatch. Reserve its bounded allocation. */
      readonly state: "unknown";
      /** Requests retained before the command envelope became unavailable. */
      readonly observedPhysicalRequestCount?: number;
      readonly reservedMaximumProviderRequests: number;
    };

export interface ContextEfficiencyCheckpointAttempt extends ContextEfficiencyAttemptIdentity {
  readonly validity: "valid" | "invalid";
  readonly physicalRequestEvidence: ContextEfficiencyPhysicalRequestEvidence;
}

export type ContextEfficiencyReconciliationStatus = "complete" | "partial" | "invalid";

export type ContextEfficiencyReconciliationFindingCode =
  | "duplicate_schedule_trial"
  | "unexpected_attempt_trial"
  | "duplicate_attempt"
  | "attempt_sequence_invalid"
  | "attempt_after_terminal"
  | "retry_without_invalid_predecessor"
  | "invalid_retry_limit_exceeded"
  | "provider_request_limit_exceeded";

export interface ContextEfficiencyReconciliationFinding {
  readonly code: ContextEfficiencyReconciliationFindingCode;
  readonly identity: ContextEfficiencyAttemptIdentity | ContextEfficiencyTrialIdentity;
}

export interface ContextEfficiencyReportIntegrityBlock {
  readonly schemaVersion: typeof CONTEXT_EFFICIENCY_REPORT_INTEGRITY_SCHEMA_VERSION;
  readonly identity: ContextEfficiencyFrozenReportIdentity;
  readonly reconciliation: {
    readonly status: ContextEfficiencyReconciliationStatus;
    readonly expectedScheduledTrialCount: number;
    readonly observedScheduledTrialCount: number;
    readonly validTerminalScheduledTrialCount: number;
    readonly missingScheduledTrials: readonly ContextEfficiencyTrialIdentity[];
    readonly missingValidTerminalTrials: readonly ContextEfficiencyTrialIdentity[];
    readonly findings: readonly ContextEfficiencyReconciliationFinding[];
  };
  /** Complete schedule reconciliation does not make unknown physical usage safe. */
  readonly physicalRequestAccounting: {
    readonly status: "complete" | "incomplete";
    readonly observedAttemptCount: number;
    readonly observedPhysicalRequestCount: number;
    readonly unknownAttemptCount: number;
    /** Portion of the observed lower bound already included in the unknown ceilings. */
    readonly unknownObservedPhysicalRequestCount: number;
    /** Total ceiling for unknown attempts, including their observed portion. */
    readonly reservedMaximumPhysicalRequestCount: number;
    /** Lower bound plus each unknown ceiling's unobserved remainder. */
    readonly maximumPhysicalRequestCount: number;
  };
}

export function digestContextEfficiencySchedule(schedule: ContextEfficiencyFrozenSchedule): string {
  return sha256(JSON.stringify({
    invalidRetryLimitPerCell: schedule.invalidRetryLimitPerCell,
    entries: schedule.entries.map((entry) => ({
      taskId: entry.taskId,
      condition: entry.condition,
      repetition: entry.repetition,
      maximumProviderRequests: entry.maximumProviderRequests,
    })),
  }));
}

/**
 * Builds a checkpoint-safe block to insert into the collector's existing
 * content-free report. It intentionally does not assign a readiness verdict.
 */
export function createContextEfficiencyReportIntegrity(input: {
  readonly identity: ContextEfficiencyFrozenReportIdentity;
  readonly schedule: ContextEfficiencyFrozenSchedule;
  readonly attempts: readonly ContextEfficiencyCheckpointAttempt[];
}): ContextEfficiencyReportIntegrityBlock {
  assertFrozenReportIdentity(input.identity);
  assertSchedule(input.schedule);
  if (digestContextEfficiencySchedule(input.schedule) !== input.identity.scheduleDigest) {
    throw new Error("Frozen report identity does not bind the supplied context-efficiency schedule.");
  }

  const scheduleByKey = new Map<string, ContextEfficiencyFrozenScheduledTrial>();
  const findings: ContextEfficiencyReconciliationFinding[] = [];
  for (const entry of input.schedule.entries) {
    const key = trialKey(entry);
    if (scheduleByKey.has(key)) {
      findings.push({ code: "duplicate_schedule_trial", identity: entry });
      continue;
    }
    scheduleByKey.set(key, entry);
  }

  const attemptsByTrial = new Map<string, ContextEfficiencyCheckpointAttempt[]>();
  let observedAttemptCount = 0;
  let observedPhysicalRequestCount = 0;
  let unknownAttemptCount = 0;
  let unknownObservedPhysicalRequestCount = 0;
  let reservedMaximumPhysicalRequestCount = 0;
  for (const attempt of input.attempts) {
    assertAttempt(attempt);
    if (attempt.physicalRequestEvidence.state === "observed") {
      observedAttemptCount += 1;
      observedPhysicalRequestCount += attempt.physicalRequestEvidence.physicalRequestCount;
    } else {
      unknownAttemptCount += 1;
      const knownRequestCount = attempt.physicalRequestEvidence.observedPhysicalRequestCount ?? 0;
      observedPhysicalRequestCount += knownRequestCount;
      unknownObservedPhysicalRequestCount += knownRequestCount;
      reservedMaximumPhysicalRequestCount += attempt.physicalRequestEvidence.reservedMaximumProviderRequests;
    }
    const key = trialKey(attempt);
    if (!scheduleByKey.has(key)) {
      findings.push({ code: "unexpected_attempt_trial", identity: attemptIdentity(attempt) });
      continue;
    }
    assertAttemptSettlementBound(attempt, scheduleByKey.get(key)!);
    if (attempt.physicalRequestEvidence.state === "observed"
      && attempt.physicalRequestEvidence.physicalRequestCount > scheduleByKey.get(key)!.maximumProviderRequests) {
      findings.push({ code: "provider_request_limit_exceeded", identity: attemptIdentity(attempt) });
    }
    const records = attemptsByTrial.get(key) ?? [];
    records.push(attempt);
    attemptsByTrial.set(key, records);
  }

  for (const records of attemptsByTrial.values()) {
    const ordered = [...records].sort((left, right) => left.attempt - right.attempt);
    let expectedAttempt = 1;
    let terminal = false;
    for (const record of ordered) {
      if (record.attempt !== expectedAttempt) {
        findings.push({ code: record.attempt < expectedAttempt ? "duplicate_attempt" : "attempt_sequence_invalid", identity: attemptIdentity(record) });
      }
      if (terminal) {
        findings.push({ code: "attempt_after_terminal", identity: attemptIdentity(record) });
      }
      if (record.attempt > 1) {
        const predecessor = ordered.find((candidate) => candidate.attempt === record.attempt - 1);
        if (!predecessor || predecessor.validity !== "invalid") {
          findings.push({ code: "retry_without_invalid_predecessor", identity: attemptIdentity(record) });
        }
      }
      if (record.validity === "valid") terminal = true;
      expectedAttempt += 1;
    }
  }

  const retryCountByCell = new Map<string, number>();
  for (const records of attemptsByTrial.values()) {
    const first = records[0];
    if (!first) continue;
    const retries = Math.max(0, records.length - 1);
    const cellKey = `${first.taskId}\0${first.condition}`;
    retryCountByCell.set(cellKey, (retryCountByCell.get(cellKey) ?? 0) + retries);
  }
  for (const [cellKey, retryCount] of retryCountByCell) {
    if (retryCount <= input.schedule.invalidRetryLimitPerCell) continue;
    const [taskId, condition] = cellKey.split("\0") as [string, ContextEfficiencyCondition];
    findings.push({
      code: "invalid_retry_limit_exceeded",
      identity: { taskId, condition, repetition: 1 },
    });
  }

  const missingScheduledTrials = [...scheduleByKey.entries()]
    .filter(([key]) => !attemptsByTrial.has(key))
    .map(([, entry]) => entry);
  const missingValidTerminalTrials = [...scheduleByKey.entries()]
    .filter(([key]) => !(attemptsByTrial.get(key)?.some((attempt) => attempt.validity === "valid")))
    .map(([, entry]) => entry);
  const status: ContextEfficiencyReconciliationStatus = findings.length > 0
    ? "invalid"
    : missingValidTerminalTrials.length > 0 ? "partial" : "complete";

  return {
    schemaVersion: CONTEXT_EFFICIENCY_REPORT_INTEGRITY_SCHEMA_VERSION,
    identity: input.identity,
    reconciliation: {
      status,
      expectedScheduledTrialCount: scheduleByKey.size,
      observedScheduledTrialCount: scheduleByKey.size - missingScheduledTrials.length,
      validTerminalScheduledTrialCount: scheduleByKey.size - missingValidTerminalTrials.length,
      missingScheduledTrials,
      missingValidTerminalTrials,
      findings,
    },
    physicalRequestAccounting: {
      status: unknownAttemptCount === 0 ? "complete" : "incomplete",
      observedAttemptCount,
      observedPhysicalRequestCount,
      unknownAttemptCount,
      unknownObservedPhysicalRequestCount,
      reservedMaximumPhysicalRequestCount,
      maximumPhysicalRequestCount: observedPhysicalRequestCount
        + reservedMaximumPhysicalRequestCount - unknownObservedPhysicalRequestCount,
    },
  };
}

/** Verifies the report uses precisely the identity pre-registered for its cohort. */
export function verifyContextEfficiencyReportIdentity(
  report: ContextEfficiencyReportIntegrityBlock,
  expected: ContextEfficiencyFrozenReportIdentity,
): void {
  assertFrozenReportIdentity(expected);
  for (const key of frozenIdentityKeys) {
    if (report.identity[key] !== expected[key]) {
      throw new Error(`Context-efficiency report identity mismatch for '${key}'.`);
    }
  }
}

const frozenIdentityKeys = [
  "manifestSchemaVersion",
  "startingCommit",
  "frozenManifestDigest",
  "sourceContractDigest",
  "inputContractDigest",
  "protocolContractDigest",
  "configurationRevisionId",
  "toolProjectionRecipeDigest",
  "executionIdentityDigest",
  "scheduleDigest",
  "targetId",
  "providerId",
  "modelId",
  "deliberationLevel",
] as const satisfies readonly (keyof ContextEfficiencyFrozenReportIdentity)[];

function assertFrozenReportIdentity(identity: ContextEfficiencyFrozenReportIdentity): void {
  if (!/^[a-f0-9]{40}$/iu.test(identity.startingCommit)) {
    throw new Error("Context-efficiency report identity requires a 40-character starting commit.");
  }
  for (const key of frozenIdentityKeys) {
    if (key === "startingCommit" || key === "manifestSchemaVersion" || key === "targetId"
      || key === "providerId" || key === "modelId" || key === "deliberationLevel") continue;
    if (!/^sha256:[a-f0-9]{64}$/iu.test(identity[key])) {
      throw new Error(`Context-efficiency report identity requires a SHA-256 digest for '${key}'.`);
    }
  }
  for (const key of ["manifestSchemaVersion", "targetId", "providerId", "modelId", "deliberationLevel"] as const) {
    if (identity[key].trim().length === 0) {
      throw new Error(`Context-efficiency report identity requires '${key}'.`);
    }
  }
}

function assertSchedule(schedule: ContextEfficiencyFrozenSchedule): void {
  if (!Number.isSafeInteger(schedule.invalidRetryLimitPerCell) || schedule.invalidRetryLimitPerCell < 0) {
    throw new Error("Context-efficiency schedule has an invalid retry limit.");
  }
  if (schedule.entries.length === 0) {
    throw new Error("Context-efficiency schedule must contain at least one trial.");
  }
  for (const entry of schedule.entries) assertTrialIdentity(entry);
  for (const entry of schedule.entries) {
    if (!Number.isSafeInteger(entry.maximumProviderRequests) || entry.maximumProviderRequests < 1) {
      throw new Error("Context-efficiency schedule maximum provider requests must be a positive integer.");
    }
  }
}

function assertAttemptSettlementBound(
  attempt: ContextEfficiencyCheckpointAttempt,
  scheduledTrial: ContextEfficiencyFrozenScheduledTrial,
): void {
  const evidence = attempt.physicalRequestEvidence;
  if (evidence.state === "unknown"
    && evidence.reservedMaximumProviderRequests !== scheduledTrial.maximumProviderRequests) {
    throw new Error("Unknown physical request evidence must reserve the frozen per-trial provider-request ceiling.");
  }
}

function assertAttempt(attempt: ContextEfficiencyCheckpointAttempt): void {
  assertTrialIdentity(attempt);
  if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1) {
    throw new Error("Context-efficiency attempt number must be a positive integer.");
  }
  if (attempt.validity !== "valid" && attempt.validity !== "invalid") {
    throw new Error("Context-efficiency attempt validity is invalid.");
  }
  const evidence = attempt.physicalRequestEvidence;
  if (evidence.state === "observed") {
    if (!Number.isSafeInteger(evidence.physicalRequestCount) || evidence.physicalRequestCount < 0) {
      throw new Error("Observed physical request count must be a non-negative integer.");
    }
  } else if (evidence.state === "unknown") {
    const observedPhysicalRequestCount = evidence.observedPhysicalRequestCount ?? 0;
    if (!Number.isSafeInteger(observedPhysicalRequestCount) || observedPhysicalRequestCount < 0) {
      throw new Error("Unknown physical request evidence must retain a non-negative observed lower bound.");
    }
    if (!Number.isSafeInteger(evidence.reservedMaximumProviderRequests)
      || evidence.reservedMaximumProviderRequests < 1) {
      throw new Error("Unknown physical request evidence must reserve a positive bounded maximum.");
    }
    if (observedPhysicalRequestCount > evidence.reservedMaximumProviderRequests) {
      throw new Error("Unknown physical request evidence cannot exceed its reserved maximum.");
    }
  } else {
    throw new Error("Context-efficiency physical request evidence is invalid.");
  }
}

function assertTrialIdentity(identity: ContextEfficiencyTrialIdentity): void {
  if (identity.taskId.trim().length === 0) throw new Error("Context-efficiency trial requires a task identity.");
  if (identity.condition !== "cold" && identity.condition !== "immediate_warm" && identity.condition !== "long_session") {
    throw new Error("Context-efficiency trial has an unknown condition.");
  }
  if (!Number.isSafeInteger(identity.repetition) || identity.repetition < 1) {
    throw new Error("Context-efficiency trial repetition must be a positive integer.");
  }
}

function trialKey(identity: ContextEfficiencyTrialIdentity): string {
  return `${identity.taskId}\0${identity.condition}\0${identity.repetition}`;
}

function attemptIdentity(attempt: ContextEfficiencyAttemptIdentity): ContextEfficiencyAttemptIdentity {
  return {
    taskId: attempt.taskId,
    condition: attempt.condition,
    repetition: attempt.repetition,
    attempt: attempt.attempt,
  };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
