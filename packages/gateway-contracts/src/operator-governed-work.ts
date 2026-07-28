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
    }];
  });
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
