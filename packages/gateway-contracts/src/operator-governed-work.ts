import type { OperatorSessionEvent } from "./frames.js";

export interface OperatorGovernedWorkPauseRequirement {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly status: "pending" | "resolved" | "superseded";
  readonly supersededByRequirementId?: string;
  readonly supersededAt?: string;
  readonly supersededBy?: string;
  readonly reason?: string;
}

export interface OperatorGovernedWorkExecutionAttempt {
  readonly id: string;
  readonly status: string;
  readonly executionMode: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly managedInvocationId?: string;
  readonly boundedWorkContractRevisionDigest?: string;
  readonly candidateDigest?: string;
}

export interface OperatorBoundedWorkCountUtilization {
  readonly used: number;
  readonly limit: number;
  readonly active?: number;
}

export type OperatorBoundedWorkMeasuredUtilization =
  | { readonly kind: "observed" | "estimated"; readonly value: number; readonly limit: number }
  | { readonly kind: "unknown" | "unavailable"; readonly limit: number };

export interface OperatorBoundedWorkProjection {
  readonly contractRevisionDigest: string;
  readonly candidateDigest?: string;
  readonly accounting: {
    readonly revision: number;
    readonly executionAttempts?: OperatorBoundedWorkCountUtilization;
    readonly managedInvocations?: OperatorBoundedWorkCountUtilization;
    readonly reviewRounds?: OperatorBoundedWorkCountUtilization;
    readonly remediationRounds?: OperatorBoundedWorkCountUtilization;
    readonly toolCalls?: OperatorBoundedWorkMeasuredUtilization;
    readonly activeDurationMs?: OperatorBoundedWorkMeasuredUtilization;
  };
  readonly decision: {
    readonly kind: string;
    readonly exhaustedLimits?: readonly string[];
    readonly unavailableMetrics?: readonly string[];
    readonly continuation?: {
      readonly action: string;
      readonly accountingRevision: number;
    };
  };
}

export interface OperatorGovernedWorkItemProjection {
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly id: string;
  readonly resourceUri: string;
  readonly summary: string;
  readonly status: string;
  readonly workflowProfile: string;
  readonly risk?: string;
  readonly surface?: string;
  readonly authorityProfile?: string;
  readonly assignedAgentProfile?: string;
  readonly referenceRoots: readonly string[];
  readonly expectedEvidence: readonly string[];
  readonly providedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly pauseRequirements: readonly OperatorGovernedWorkPauseRequirement[];
  readonly executionAttempts: readonly OperatorGovernedWorkExecutionAttempt[];
  readonly boundedWork?: OperatorBoundedWorkProjection;
  readonly latestAttemptStatus?: string;
  readonly latestAttemptMode?: string;
  readonly latestManagedInvocationId?: string;
  readonly pendingPauseRequirementCount: number;
  readonly missingEvidence: readonly string[];
  readonly missingGoalEvidence: readonly string[];
  readonly missingVerificationGates: readonly string[];
  readonly failedVerificationGates: readonly string[];
  readonly missingResidualRisk: boolean;
  readonly updatedAt: string;
}

export interface OperatorGovernedWorkItemSnapshotInput {
  readonly workItem: unknown;
  readonly evidence?: unknown;
  readonly previous?: OperatorGovernedWorkItemProjection;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly observedAt: string;
}

export function projectOperatorGovernedWorkItemSnapshot(
  input: OperatorGovernedWorkItemSnapshotInput,
): OperatorGovernedWorkItemProjection | null {
  const workItem = asRecord(input.workItem);
  const evidence = asRecord(input.evidence);
  const id = readString(workItem.id);
  const summary = readString(workItem.summary);
  const status = readString(workItem.status);
  const workflowProfile = readString(workItem.workflowProfile);
  if (!id || !summary || !status || !workflowProfile) {
    return null;
  }

  const expectedEvidence = readStringArrayField(workItem, "expectedEvidence", input.previous?.expectedEvidence);
  const providedEvidence = readStringArrayField(workItem, "providedEvidence", input.previous?.providedEvidence);
  const executionAttempts = hasOwn(workItem, "executionAttempts")
    ? readExecutionAttempts(workItem.executionAttempts)
    : (input.previous?.executionAttempts ?? []);
  const latestAttempt = executionAttempts.at(-1);
  const missingEvidence = hasOwn(workItem, "missingEvidence") || hasOwn(evidence, "missingEvidence")
    ? uniqueStrings([
      ...readStringArray(workItem.missingEvidence),
      ...readStringArray(evidence.missingEvidence),
      ...expectedEvidence.filter((entry) => !providedEvidence.includes(entry)),
    ])
    : (input.previous?.missingEvidence ?? expectedEvidence.filter((entry) => !providedEvidence.includes(entry)));
  const missingGoalEvidence = readCombinedStringArrayFields(
    workItem,
    evidence,
    "missingGoalEvidence",
    input.previous?.missingGoalEvidence,
  );
  const missingVerificationGates = readCombinedStringArrayFields(
    workItem,
    evidence,
    "missingVerificationGates",
    input.previous?.missingVerificationGates,
  );
  const failedVerificationGates = readCombinedStringArrayFields(
    workItem,
    evidence,
    "failedVerificationGates",
    input.previous?.failedVerificationGates,
  );
  const pauseRequirements = hasOwn(workItem, "pauseRequirements")
    ? readPauseRequirements(workItem.pauseRequirements)
    : (input.previous?.pauseRequirements ?? []);
  const resourceUri = readString(workItem.resourceUri)
    ?? input.previous?.resourceUri
    ?? `kiln://session/work-items/${encodeURIComponent(id)}`;
  const authorityProfile = readString(workItem.authorityProfile) ?? input.previous?.authorityProfile;
  const assignedAgentProfile = readString(workItem.assignedAgentProfile) ?? input.previous?.assignedAgentProfile;
  const risk = readString(workItem.risk) ?? input.previous?.risk;
  const surface = readString(workItem.surface) ?? input.previous?.surface;
  const boundedWork = hasOwn(workItem, "boundedWork")
    ? readBoundedWorkProjection(workItem.boundedWork)
    : input.previous?.boundedWork;

  return {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    id,
    resourceUri,
    summary,
    status,
    workflowProfile,
    ...(risk ? { risk } : {}),
    ...(surface ? { surface } : {}),
    ...(authorityProfile ? { authorityProfile } : {}),
    ...(assignedAgentProfile ? { assignedAgentProfile } : {}),
    referenceRoots: readStringArrayField(workItem, "referenceRoots", input.previous?.referenceRoots),
    expectedEvidence,
    providedEvidence,
    verificationGates: readStringArrayField(workItem, "verificationGates", input.previous?.verificationGates),
    pauseRequirements,
    executionAttempts,
    ...(boundedWork ? { boundedWork } : {}),
    ...(readString(workItem.latestAttemptStatus) ?? latestAttempt?.status
      ? { latestAttemptStatus: (readString(workItem.latestAttemptStatus) ?? latestAttempt!.status) }
      : {}),
    ...(readString(workItem.latestAttemptMode) ?? latestAttempt?.executionMode
      ? { latestAttemptMode: (readString(workItem.latestAttemptMode) ?? latestAttempt!.executionMode) }
      : {}),
    ...(readString(workItem.latestManagedInvocationId) ?? latestAttempt?.managedInvocationId
      ? { latestManagedInvocationId: (readString(workItem.latestManagedInvocationId) ?? latestAttempt!.managedInvocationId!) }
      : {}),
    pendingPauseRequirementCount: pauseRequirements.filter((entry) => entry.status === "pending").length,
    missingEvidence,
    missingGoalEvidence,
    missingVerificationGates,
    failedVerificationGates,
    missingResidualRisk: hasOwn(workItem, "missingResidualRisk") || hasOwn(evidence, "missingResidualRisk")
      ? workItem.missingResidualRisk === true || evidence.missingResidualRisk === true
      : (input.previous?.missingResidualRisk ?? false),
    updatedAt: readString(workItem.updatedAt) ?? input.observedAt,
  };
}

export function projectOperatorGovernedWorkItems(
  events: readonly OperatorSessionEvent[],
): readonly OperatorGovernedWorkItemProjection[] {
  const items = new Map<string, OperatorGovernedWorkItemProjection>();
  for (const event of [...events].sort(compareEvents)) {
    if (!isWorkItemEvent(event)) {
      continue;
    }
    const payload = asRecord(event.payload);
    const keySessionId = readString(payload.sessionId) ?? event.kilnSessionId;
    const keyWorkItemId = readString(asRecord(payload.workItem).id);
    const previous = keyWorkItemId
      ? items.get(`${keySessionId}\u001f${keyWorkItemId}`)
      : undefined;
    const item = projectOperatorGovernedWorkItemSnapshot({
      workItem: payload.workItem,
      evidence: payload,
      ...(previous ? { previous } : {}),
      sessionId: keySessionId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      observedAt: event.timestamp,
    });
    if (item) {
      items.set(`${item.sessionId ?? ""}\u001f${item.id}`, item);
    }
  }
  return [...items.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function isOperatorGovernedWorkItemBlocking(
  item: OperatorGovernedWorkItemProjection,
): boolean {
  const knownStatus = item.status === "pending"
    || item.status === "in_progress"
    || item.status === "blocked"
    || item.status === "completed"
    || item.status === "cancelled";
  return !knownStatus
    || !item.authorityProfile
    || item.authorityProfile === "unknown"
    || item.status === "blocked"
    || item.pendingPauseRequirementCount > 0
    || item.missingEvidence.length > 0
    || item.missingGoalEvidence.length > 0
    || item.missingVerificationGates.length > 0
    || item.failedVerificationGates.length > 0
    || item.missingResidualRisk;
}

function readPauseRequirements(value: unknown): readonly OperatorGovernedWorkPauseRequirement[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const id = readString(record.id);
    const kind = readString(record.kind);
    const summary = readString(record.summary);
    if (!id || !kind || !summary) {
      return [];
    }
    const rawStatus = readString(record.status);
    const status = rawStatus === "resolved" || rawStatus === "superseded"
      ? rawStatus
      : "pending";
    return [{
      id,
      kind,
      summary,
      status,
      ...(readString(record.supersededByRequirementId)
        ? { supersededByRequirementId: readString(record.supersededByRequirementId)! }
        : {}),
      ...(readString(record.supersededAt) ? { supersededAt: readString(record.supersededAt)! } : {}),
      ...(readString(record.supersededBy) ? { supersededBy: readString(record.supersededBy)! } : {}),
      ...(readString(record.reason) ? { reason: readString(record.reason)! } : {}),
    }];
  });
}

function readExecutionAttempts(value: unknown): readonly OperatorGovernedWorkExecutionAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const id = readString(record.id);
    const status = readString(record.status);
    const executionMode = readString(record.executionMode);
    if (!id || !status || !executionMode) {
      return [];
    }
    return [{
      id,
      status,
      executionMode,
      ...(readString(record.startedAt) ? { startedAt: readString(record.startedAt)! } : {}),
      ...(readString(record.completedAt) ? { completedAt: readString(record.completedAt)! } : {}),
      ...(readString(record.managedInvocationId)
        ? { managedInvocationId: readString(record.managedInvocationId)! }
        : {}),
      ...(readDigest(record.boundedWorkContractRevisionDigest)
        ? { boundedWorkContractRevisionDigest: readDigest(record.boundedWorkContractRevisionDigest)! }
        : {}),
      ...(readDigest(asRecord(record.candidate).candidateDigest)
        ? { candidateDigest: readDigest(asRecord(record.candidate).candidateDigest)! }
        : {}),
    }];
  });
}

function readBoundedWorkProjection(value: unknown): OperatorBoundedWorkProjection | undefined {
  const record = asRecord(value);
  const contractRevisionDigest = readDigest(record.contractRevisionDigest);
  const accounting = asRecord(record.accounting);
  const decision = asRecord(record.decision);
  const revision = readNonNegativeInteger(accounting.revision);
  const decisionKind = readString(decision.kind);
  if (!contractRevisionDigest || revision === undefined || !decisionKind) return undefined;
  const executionAttempts = readCountUtilization(accounting.executionAttempts);
  const managedInvocations = readCountUtilization(accounting.managedInvocations, true);
  const reviewRounds = readCountUtilization(accounting.reviewRounds);
  const remediationRounds = readCountUtilization(accounting.remediationRounds);
  const toolCalls = readMeasuredUtilization(accounting.toolCalls);
  const activeDurationMs = readMeasuredUtilization(accounting.activeDurationMs);
  if (
    (accounting.executionAttempts !== undefined && !executionAttempts)
    || (accounting.managedInvocations !== undefined && !managedInvocations)
    || (accounting.reviewRounds !== undefined && !reviewRounds)
    || (accounting.remediationRounds !== undefined && !remediationRounds)
    || (accounting.toolCalls !== undefined && !toolCalls)
    || (accounting.activeDurationMs !== undefined && !activeDurationMs)
  ) return undefined;
  const continuation = asRecord(decision.continuation);
  const action = readString(continuation.action);
  const accountingRevision = readNonNegativeInteger(continuation.accountingRevision);
  return {
    contractRevisionDigest,
    ...(readDigest(record.candidateDigest) ? { candidateDigest: readDigest(record.candidateDigest)! } : {}),
    accounting: {
      revision,
      ...(executionAttempts ? { executionAttempts } : {}),
      ...(managedInvocations ? { managedInvocations } : {}),
      ...(reviewRounds ? { reviewRounds } : {}),
      ...(remediationRounds ? { remediationRounds } : {}),
      ...(toolCalls ? { toolCalls } : {}),
      ...(activeDurationMs ? { activeDurationMs } : {}),
    },
    decision: {
      kind: decisionKind,
      ...(readStringArray(decision.exhaustedLimits).length > 0
        ? { exhaustedLimits: readStringArray(decision.exhaustedLimits) }
        : {}),
      ...(readStringArray(decision.unavailableMetrics).length > 0
        ? { unavailableMetrics: readStringArray(decision.unavailableMetrics) }
        : {}),
      ...(action && accountingRevision !== undefined
        ? { continuation: { action, accountingRevision } }
        : {}),
    },
  };
}

function readCountUtilization(value: unknown, allowActive = false): OperatorBoundedWorkCountUtilization | undefined {
  const record = asRecord(value);
  const used = readNonNegativeInteger(record.used);
  const limit = readNonNegativeInteger(record.limit);
  const active = readNonNegativeInteger(record.active);
  if (used === undefined || limit === undefined || used > limit) return undefined;
  if (record.active !== undefined && (!allowActive || active === undefined || active > used)) return undefined;
  return { used, limit, ...(active === undefined ? {} : { active }) };
}

function readMeasuredUtilization(value: unknown): OperatorBoundedWorkMeasuredUtilization | undefined {
  const record = asRecord(value);
  const kind = readString(record.kind);
  const limit = readNonNegativeInteger(record.limit);
  if (limit === undefined) return undefined;
  if (kind === "unknown" || kind === "unavailable") {
    if (record.value !== undefined) return undefined;
    return { kind, limit };
  }
  const measured = readNonNegativeInteger(record.value);
  return (kind === "observed" || kind === "estimated") && measured !== undefined
    ? { kind, value: measured, limit }
    : undefined;
}

function readDigest(value: unknown): string | undefined {
  const text = readString(value);
  return text && /^sha256:[a-f0-9]{64}$/u.test(text) ? text : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isWorkItemEvent(event: OperatorSessionEvent): boolean {
  return event.kind === "work_item_updated"
    || event.kind === "work_item_execution_started"
    || event.kind === "work_item_execution_finished";
}

function compareEvents(left: OperatorSessionEvent, right: OperatorSessionEvent): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  const timestamp = left.timestamp.localeCompare(right.timestamp);
  return timestamp === 0 ? left.eventId.localeCompare(right.eventId) : timestamp;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function readStringArrayField(
  record: Record<string, unknown>,
  field: string,
  previous: readonly string[] | undefined,
): readonly string[] {
  return hasOwn(record, field) ? readStringArray(record[field]) : (previous ?? []);
}

function readCombinedStringArrayFields(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  field: string,
  previous: readonly string[] | undefined,
): readonly string[] {
  return hasOwn(first, field) || hasOwn(second, field)
    ? uniqueStrings([...readStringArray(first[field]), ...readStringArray(second[field])])
    : (previous ?? []);
}

function hasOwn(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
