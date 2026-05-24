import { compareSessionEvents, type CanonicalSessionEvent } from "../events/session-event.js";
import type { ManagedAgentResultHandoff } from "../agents/managed-invocation/index.js";

export type WorkItemStatus = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";

export type WorkItemRecommendedReasoningEffort = "low" | "medium" | "high";

export interface WorkItemRoutingRecommendation {
  readonly routeId?: string;
  readonly agentProfile?: string;
  readonly reasoningEffort: WorkItemRecommendedReasoningEffort;
  readonly modelTaskSuitability: string;
  readonly rationale: string;
}

export type WorkItemExecutionMode = "direct" | "managed_delegation";
export type WorkItemExecutionAttemptStatus = "started" | "completed" | "blocked" | "failed" | "cancelled";
export type WorkItemExecutionFailureReason =
  | "failed"
  | "denied"
  | "unavailable"
  | "timed_out"
  | "cancelled"
  | "skipped";
export type WorkItemPauseRequirementKind = "operator_input" | "credentials" | "approval" | "authority_elevation";
export type WorkItemPauseRequirementStatus = "pending" | "resolved";
export type VerificationGateResultStatus = "passed" | "failed" | "skipped";

export const MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET = "slice-6-handoff-review-adoption";
export const MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE = "managed-orchestration:adoption-gate";
export const MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE = "managed-orchestration:result-handoff";

export interface WorkItemManagedOrchestrationExpectedEvidence {
  readonly kind: string;
  readonly label: string;
  readonly required: boolean;
}

export interface WorkItemManagedOrchestrationIsolationPolicy {
  readonly required: boolean;
  readonly reason: string;
  readonly workingDirectoryMode?: string;
}

export interface WorkItemManagedOrchestrationMergePolicy {
  readonly mode: string;
  readonly adoptionRequired: boolean;
}

export interface WorkItemManagedOrchestrationAdoptionGate {
  readonly required: boolean;
  readonly target: typeof MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET;
  readonly reason: string;
}

export interface WorkItemManagedOrchestrationAdoptionResolution {
  readonly target: typeof MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET;
  readonly adoptedBy: string;
  readonly adoptedAt: string;
  readonly resourceUris: readonly string[];
}

export interface WorkItemManagedOrchestrationResultHandoff {
  readonly orchestrationId: string;
  readonly childId: string;
  readonly workItemId: string;
  readonly summary: string;
  readonly completedAt: string;
  readonly resourceUris: readonly string[];
}

export type WorkItemManagedOrchestrationResultHandoffStatus =
  | "not_required"
  | "pending"
  | "recorded"
  | "blocked";

export interface WorkItemManagedOrchestrationResultHandoffProjection {
  readonly required: boolean;
  readonly status: WorkItemManagedOrchestrationResultHandoffStatus;
  readonly orchestrationId?: string;
  readonly childId?: string;
  readonly workItemId?: string;
  readonly summary?: string;
  readonly completedAt?: string;
  readonly resourceUris: readonly string[];
  readonly blockingEvidence: readonly string[];
}

export type WorkItemManagedOrchestrationAdoptionGateStatus =
  | "not_required"
  | "pending_review"
  | "adopted"
  | "rejected"
  | "blocked";

export interface WorkItemManagedOrchestrationAdoptionGateRejection {
  readonly gate: string;
  readonly summary?: string;
  readonly evidence: readonly string[];
  readonly completedAt?: string;
}

export interface WorkItemManagedOrchestrationAdoptionGateProjection {
  readonly required: boolean;
  readonly status: WorkItemManagedOrchestrationAdoptionGateStatus;
  readonly target?: WorkItemManagedOrchestrationAdoptionGate["target"];
  readonly reason?: string;
  readonly orchestrationId?: string;
  readonly childId?: string;
  readonly mergePolicyMode?: string;
  readonly adoptedBy?: string;
  readonly adoptedAt?: string;
  readonly resourceUris: readonly string[];
  readonly rejection?: WorkItemManagedOrchestrationAdoptionGateRejection;
  readonly blockingEvidence: readonly string[];
}

export interface WorkItemManagedOrchestrationPolicy {
  readonly orchestrationId: string;
  readonly mode: string;
  readonly childId: string;
  readonly ordinal: number;
  readonly roleIntent: string;
  readonly expectedEvidence: readonly WorkItemManagedOrchestrationExpectedEvidence[];
  readonly isolation: WorkItemManagedOrchestrationIsolationPolicy;
  readonly mergePolicy: WorkItemManagedOrchestrationMergePolicy;
  readonly adoptionGate: WorkItemManagedOrchestrationAdoptionGate;
}

export interface VerificationGateResult {
  readonly gate: string;
  readonly status: VerificationGateResultStatus;
  readonly summary?: string;
  readonly evidence?: readonly string[];
  readonly completedAt?: string;
}

export interface WorkItemPauseRequirement {
  readonly id: string;
  readonly kind: WorkItemPauseRequirementKind;
  readonly summary: string;
  readonly status: WorkItemPauseRequirementStatus;
  readonly resolvedBy?: string;
  readonly resolvedAt?: string;
  readonly resolution?: string;
}

export interface WorkItemExecutionAttempt {
  readonly id: string;
  readonly workItemId: string;
  readonly goalRunId: string;
  readonly status: WorkItemExecutionAttemptStatus;
  readonly executionMode: WorkItemExecutionMode;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly summary?: string;
  readonly failureReason?: WorkItemExecutionFailureReason;
  readonly managedInvocationId?: string;
  readonly providedEvidence: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly missingResidualRisk: boolean;
  readonly skippedVerificationGates: readonly string[];
  readonly verificationGateResults: readonly VerificationGateResult[];
  readonly residualRisk?: string;
}

export interface WorkItemUpsertInput {
  readonly id?: string;
  readonly summary: string;
  readonly status?: WorkItemStatus;
  readonly workflowProfile: string;
  readonly risk?: string;
  readonly triggers: readonly string[];
  readonly surface?: string;
  readonly assignedAgentProfile?: string;
  readonly routeId?: string;
  readonly phaseRoutes?: Readonly<Record<string, string>>;
  readonly authorityProfile?: string;
  readonly expectedEvidence: readonly string[];
  readonly providedEvidence?: readonly string[];
  readonly verificationGates: readonly string[];
  readonly skippedVerificationGates?: readonly string[];
  readonly verificationGateResults?: readonly VerificationGateResult[];
  readonly dependencies?: readonly string[];
  readonly residualRisk?: string;
  readonly pauseRequirements?: readonly WorkItemPauseRequirement[];
  readonly planId?: string;
  readonly planHash?: string;
  readonly goalRunId?: string;
  readonly sourceWorkItemId?: string;
  readonly routingRecommendation?: WorkItemRoutingRecommendation;
  readonly managedOrchestration?: WorkItemManagedOrchestrationPolicy;
  readonly managedOrchestrationResultHandoff?: WorkItemManagedOrchestrationResultHandoff;
  readonly managedOrchestrationAdoption?: WorkItemManagedOrchestrationAdoptionResolution;
  readonly executionAttempts?: readonly WorkItemExecutionAttempt[];
}

export interface WorkItem extends WorkItemUpsertInput {
  readonly id: string;
  readonly status: WorkItemStatus;
  readonly providedEvidence: readonly string[];
  readonly skippedVerificationGates: readonly string[];
  readonly verificationGateResults: readonly VerificationGateResult[];
  readonly dependencies: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sequence: number;
  readonly executionAttempts: readonly WorkItemExecutionAttempt[];
}

export interface WorkItemCompletionInput {
  readonly id: string;
  readonly providedEvidence?: readonly string[];
  readonly skippedVerificationGates?: readonly string[];
  readonly verificationGateResults?: readonly VerificationGateResult[];
  readonly residualRisk?: string;
  readonly managedOrchestrationAdoption?: WorkItemManagedOrchestrationAdoptionResolution;
}

export interface WorkItemCompletionResult {
  readonly item: WorkItem;
  readonly missingEvidence: readonly string[];
  readonly missingVerificationGates: readonly string[];
  readonly missingResidualRisk: boolean;
  readonly failedVerificationGates: readonly string[];
}

export interface WorkItemStartExecutionAttemptInput {
  readonly id: string;
  readonly goalRunId: string;
  readonly executionMode: WorkItemExecutionMode;
  readonly summary?: string;
  readonly managedInvocationId?: string;
}

export interface WorkItemStartExecutionAttemptResult {
  readonly item: WorkItem;
  readonly attempt: WorkItemExecutionAttempt;
}

export interface WorkItemFinishExecutionAttemptInput {
  readonly id: string;
  readonly attemptId: string;
  readonly providedEvidence?: readonly string[];
  readonly skippedVerificationGates?: readonly string[];
  readonly verificationGateResults?: readonly VerificationGateResult[];
  readonly residualRisk?: string;
  readonly summary?: string;
  readonly managedInvocationResultHandoff?: ManagedAgentResultHandoff;
  readonly managedOrchestrationAdoption?: WorkItemManagedOrchestrationAdoptionResolution;
}

export interface WorkItemFinishExecutionAttemptResult extends WorkItemCompletionResult {
  readonly attempt: WorkItemExecutionAttempt;
}

export interface WorkItemFailExecutionAttemptInput {
  readonly id: string;
  readonly attemptId: string;
  readonly terminalStatus?: Extract<WorkItemExecutionAttemptStatus, "failed" | "cancelled">;
  readonly failureReason: WorkItemExecutionFailureReason;
  readonly summary: string;
}

export interface WorkItemFailExecutionAttemptResult extends WorkItemCompletionResult {
  readonly attempt: WorkItemExecutionAttempt;
}

export interface WorkItemSnapshot {
  readonly items: readonly WorkItem[];
  readonly updatedAt?: string;
  readonly sequence: number;
}

export interface WorkItemResourceChangeNotifier {
  notifyResourceUpdated(uri: string): void;
}

export interface WorkItemStoreOptions {
  readonly resourceNotifications?: WorkItemResourceChangeNotifier;
  readonly now?: () => string;
}

export class WorkItemStore {
  private readonly items = new Map<string, WorkItem>();
  private readonly now: () => string;
  private sequence = 0;
  private resourceNotifications?: WorkItemResourceChangeNotifier;

  constructor(options: WorkItemStoreOptions = {}) {
    this.resourceNotifications = options.resourceNotifications;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  setResourceChangeNotifier(resourceNotifications: WorkItemResourceChangeNotifier): void {
    this.resourceNotifications = resourceNotifications;
  }

  upsert(input: WorkItemUpsertInput): WorkItem {
    const now = this.now();
    const existing = input.id ? this.items.get(input.id) : undefined;
    const id = input.id ?? `work-${this.sequence + 1}`;
    const item: WorkItem = {
      id,
      summary: input.summary,
      status: input.status ?? existing?.status ?? "pending",
      workflowProfile: input.workflowProfile,
      risk: input.risk,
      triggers: unique(input.triggers),
      surface: input.surface,
      assignedAgentProfile: input.assignedAgentProfile,
      routeId: input.routeId,
      phaseRoutes: normalizeTextRecord(input.phaseRoutes ?? existing?.phaseRoutes),
      authorityProfile: input.authorityProfile,
      expectedEvidence: normalizeWorkItemExpectedEvidence({
        expectedEvidence: input.expectedEvidence,
        managedOrchestration: input.managedOrchestration ?? existing?.managedOrchestration,
      }),
      providedEvidence: unique(input.providedEvidence ?? existing?.providedEvidence ?? []),
      verificationGates: unique(input.verificationGates),
      skippedVerificationGates: unique(input.skippedVerificationGates ?? existing?.skippedVerificationGates ?? []),
      verificationGateResults: normalizeVerificationGateResults(input.verificationGateResults ?? existing?.verificationGateResults ?? []),
      dependencies: unique(input.dependencies ?? existing?.dependencies ?? []),
      residualRisk: input.residualRisk ?? existing?.residualRisk,
      pauseRequirements: normalizePauseRequirements(input.pauseRequirements ?? existing?.pauseRequirements ?? []),
      planId: input.planId ?? existing?.planId,
      planHash: input.planHash ?? existing?.planHash,
      goalRunId: input.goalRunId ?? existing?.goalRunId,
      sourceWorkItemId: input.sourceWorkItemId ?? existing?.sourceWorkItemId,
      routingRecommendation: input.routingRecommendation ?? existing?.routingRecommendation,
      managedOrchestration: normalizeManagedOrchestrationPolicy(input.managedOrchestration ?? existing?.managedOrchestration),
      managedOrchestrationResultHandoff: normalizeManagedOrchestrationResultHandoff(
        input.managedOrchestrationResultHandoff ?? existing?.managedOrchestrationResultHandoff,
        input.managedOrchestration ?? existing?.managedOrchestration,
        id,
      ),
      managedOrchestrationAdoption: normalizeManagedOrchestrationAdoption(input.managedOrchestrationAdoption ?? existing?.managedOrchestrationAdoption),
      executionAttempts: input.executionAttempts ?? existing?.executionAttempts ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      sequence: ++this.sequence,
    };
    this.items.set(id, item);
    this.notifyChanged(item.id);
    return item;
  }

  list(status?: WorkItemStatus): readonly WorkItem[] {
    const items = [...this.items.values()].sort((left, right) => left.sequence - right.sequence);
    return status ? items.filter((item) => item.status === status) : items;
  }

  get(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  snapshot(status?: WorkItemStatus): WorkItemSnapshot {
    const items = this.list(status);
    return {
      items,
      updatedAt: items.at(-1)?.updatedAt,
      sequence: this.sequence,
    };
  }

  complete(input: WorkItemCompletionInput): WorkItemCompletionResult | undefined {
    const existing = this.items.get(input.id);
    if (!existing) {
      return undefined;
    }

    const providedEvidence = unique([
      ...existing.providedEvidence,
      ...(input.providedEvidence ?? []),
    ]);
    const skippedVerificationGates = unique([
      ...existing.skippedVerificationGates,
      ...(input.skippedVerificationGates ?? []),
    ]);
    const verificationGateResults = mergeVerificationGateResults(
      existing.verificationGateResults,
      input.verificationGateResults ?? [],
    );
    const allSkippedVerificationGates = unique([
      ...skippedVerificationGates,
      ...verificationGateResults
        .filter((result) => result.status === "skipped")
        .map((result) => result.gate),
    ]);
    const failedVerificationGates = failedGates(verificationGateResults);
    const missingVerificationGates = missingRequiredVerificationGates(existing, verificationGateResults, allSkippedVerificationGates);
    const managedOrchestrationAdoption = normalizeManagedOrchestrationAdoption(
      input.managedOrchestrationAdoption ?? existing.managedOrchestrationAdoption,
    );
    const missingEvidence = missingExpectedEvidence({
      ...existing,
      managedOrchestrationAdoption,
    }, providedEvidence);
    const residualRisk = input.residualRisk ?? existing.residualRisk;
    const missingResidualRisk = requiresResidualRisk(existing.expectedEvidence, allSkippedVerificationGates) && !residualRisk;
    const status: WorkItemStatus = missingEvidence.length === 0
      && missingVerificationGates.length === 0
      && !missingResidualRisk
      && failedVerificationGates.length === 0
      ? "completed"
      : "blocked";

    const item = this.upsert({
      ...existing,
      status,
      providedEvidence,
      skippedVerificationGates: allSkippedVerificationGates,
      verificationGateResults,
      residualRisk,
      managedOrchestrationAdoption,
    });

    return {
      item,
      missingEvidence,
      missingVerificationGates,
      missingResidualRisk,
      failedVerificationGates,
    };
  }

  startExecutionAttempt(input: WorkItemStartExecutionAttemptInput): WorkItemStartExecutionAttemptResult | undefined {
    const existing = this.items.get(input.id);
    if (!existing) {
      return undefined;
    }
    const startedAt = this.now();
    const attempt: WorkItemExecutionAttempt = {
      id: `${input.goalRunId}:${existing.id}:attempt:${existing.executionAttempts.length + 1}`,
      workItemId: existing.id,
      goalRunId: input.goalRunId,
      status: "started",
      executionMode: input.executionMode,
      startedAt,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.managedInvocationId ? { managedInvocationId: input.managedInvocationId } : {}),
      providedEvidence: [],
      missingEvidence: [],
      missingResidualRisk: false,
      skippedVerificationGates: [],
      verificationGateResults: [],
    };
    const item = this.upsert({
      ...existing,
      status: "in_progress",
      executionAttempts: [...existing.executionAttempts, attempt],
    });
    return { item, attempt };
  }

  finishExecutionAttempt(input: WorkItemFinishExecutionAttemptInput): WorkItemFinishExecutionAttemptResult | undefined {
    const existing = this.items.get(input.id);
    if (!existing) {
      return undefined;
    }
    const attempt = existing.executionAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) {
      return undefined;
    }
    const providedEvidence = unique([
      ...existing.providedEvidence,
      ...attempt.providedEvidence,
      ...(input.providedEvidence ?? []),
    ]);
    const skippedVerificationGates = unique([
      ...existing.skippedVerificationGates,
      ...attempt.skippedVerificationGates,
      ...(input.skippedVerificationGates ?? []),
    ]);
    const verificationGateResults = mergeVerificationGateResults(
      existing.verificationGateResults,
      attempt.verificationGateResults,
      input.verificationGateResults ?? [],
    );
    const allSkippedVerificationGates = unique([
      ...skippedVerificationGates,
      ...verificationGateResults
        .filter((result) => result.status === "skipped")
        .map((result) => result.gate),
    ]);
    const failedVerificationGates = failedGates(verificationGateResults);
    const missingVerificationGates = missingRequiredVerificationGates(existing, verificationGateResults, allSkippedVerificationGates);
    const managedOrchestrationAdoption = normalizeManagedOrchestrationAdoption(
      input.managedOrchestrationAdoption ?? existing.managedOrchestrationAdoption,
    );
    const synthesizedHandoff = synthesizeManagedOrchestrationResultHandoff({
      item: existing,
      attempt,
      managedInvocationResultHandoff: input.managedInvocationResultHandoff,
      completedAt: this.now(),
    });
    const managedOrchestrationResultHandoff = normalizeManagedOrchestrationResultHandoff(
      synthesizedHandoff ?? existing.managedOrchestrationResultHandoff,
      existing.managedOrchestration,
      existing.id,
    );
    const missingEvidence = missingExpectedEvidence({
      ...existing,
      managedOrchestrationResultHandoff,
      managedOrchestrationAdoption,
    }, providedEvidence);
    const residualRisk = input.residualRisk ?? existing.residualRisk ?? attempt.residualRisk;
    const missingResidualRisk = requiresResidualRisk(existing.expectedEvidence, allSkippedVerificationGates) && !residualRisk;
    const status: WorkItemStatus = missingEvidence.length === 0
      && missingVerificationGates.length === 0
      && !missingResidualRisk
      && failedVerificationGates.length === 0
      ? "completed"
      : "blocked";
    const completedAttempt: WorkItemExecutionAttempt = {
      ...attempt,
      status: status === "completed" ? "completed" : "blocked",
      completedAt: this.now(),
      ...(input.summary ? { summary: input.summary } : {}),
      providedEvidence,
      missingEvidence,
      missingResidualRisk,
      skippedVerificationGates: allSkippedVerificationGates,
      verificationGateResults,
      ...(residualRisk ? { residualRisk } : {}),
    };
    const item = this.upsert({
      ...existing,
      status,
      providedEvidence,
      skippedVerificationGates: allSkippedVerificationGates,
      verificationGateResults,
      residualRisk,
      managedOrchestrationResultHandoff,
      managedOrchestrationAdoption,
      executionAttempts: existing.executionAttempts.map((candidate) =>
        candidate.id === input.attemptId ? completedAttempt : candidate),
    });
    return {
      item,
      attempt: completedAttempt,
      missingEvidence,
      missingVerificationGates,
      missingResidualRisk,
      failedVerificationGates,
    };
  }

  failExecutionAttempt(input: WorkItemFailExecutionAttemptInput): WorkItemFailExecutionAttemptResult | undefined {
    const existing = this.items.get(input.id);
    if (!existing) {
      return undefined;
    }
    const attempt = existing.executionAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) {
      return undefined;
    }
    const terminalStatus = resolveFailedAttemptStatus(input);
    const providedEvidence = unique([
      ...existing.providedEvidence,
      ...attempt.providedEvidence,
    ]);
    const skippedVerificationGates = unique([
      ...existing.skippedVerificationGates,
      ...attempt.skippedVerificationGates,
    ]);
    const verificationGateResults = mergeVerificationGateResults(
      existing.verificationGateResults,
      attempt.verificationGateResults,
    );
    const allSkippedVerificationGates = unique([
      ...skippedVerificationGates,
      ...verificationGateResults
        .filter((result) => result.status === "skipped")
        .map((result) => result.gate),
    ]);
    const failedVerificationGates = failedGates(verificationGateResults);
    const missingVerificationGates = missingRequiredVerificationGates(existing, verificationGateResults, allSkippedVerificationGates);
    const missingEvidence = missingExpectedEvidence(existing, providedEvidence);
    const residualRisk = existing.residualRisk ?? attempt.residualRisk;
    const missingResidualRisk = requiresResidualRisk(existing.expectedEvidence, allSkippedVerificationGates) && !residualRisk;
    const completedAt = this.now();
    const failedAttempt: WorkItemExecutionAttempt = {
      ...attempt,
      status: terminalStatus,
      completedAt,
      summary: input.summary.trim(),
      failureReason: input.failureReason,
      providedEvidence,
      missingEvidence,
      missingResidualRisk,
      skippedVerificationGates: allSkippedVerificationGates,
      verificationGateResults,
      ...(residualRisk ? { residualRisk } : {}),
    };
    const item = this.upsert({
      ...existing,
      status: "blocked",
      providedEvidence,
      skippedVerificationGates: allSkippedVerificationGates,
      verificationGateResults,
      residualRisk,
      executionAttempts: existing.executionAttempts.map((candidate) =>
        candidate.id === input.attemptId ? failedAttempt : candidate),
    });
    return {
      item,
      attempt: failedAttempt,
      missingEvidence,
      missingVerificationGates,
      missingResidualRisk,
      failedVerificationGates,
    };
  }

  private notifyChanged(id: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/work-items");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/work-items/${encodeURIComponent(id)}`);
  }
}

export function projectManagedOrchestrationAdoptionGate(
  item: WorkItem,
): WorkItemManagedOrchestrationAdoptionGateProjection {
  const policy = item.managedOrchestration;
  if (!policy) {
    return {
      required: false,
      status: "not_required",
      resourceUris: [],
      blockingEvidence: [],
    };
  }
  if (policy.adoptionGate.required !== true) {
    return {
      required: false,
      status: "not_required",
      target: policy.adoptionGate.target,
      reason: policy.adoptionGate.reason,
      orchestrationId: policy.orchestrationId,
      childId: policy.childId,
      mergePolicyMode: policy.mergePolicy.mode,
      resourceUris: [],
      blockingEvidence: [],
    };
  }

  const adoption = item.managedOrchestrationAdoption?.target === policy.adoptionGate.target
    ? item.managedOrchestrationAdoption
    : undefined;
  const rejectedGate = item.verificationGateResults.find(isFailedManagedOrchestrationAdoptionGateResult);
  const blockingEvidence = adoption && !rejectedGate ? [] : [MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE];
  const base = {
    required: true,
    target: policy.adoptionGate.target,
    reason: policy.adoptionGate.reason,
    orchestrationId: policy.orchestrationId,
    childId: policy.childId,
    mergePolicyMode: policy.mergePolicy.mode,
    resourceUris: adoption?.resourceUris ?? [],
    blockingEvidence,
  } satisfies Omit<WorkItemManagedOrchestrationAdoptionGateProjection, "status" | "adoptedBy" | "adoptedAt" | "rejection">;

  if (rejectedGate) {
    return {
      ...base,
      status: "rejected",
      rejection: {
        gate: rejectedGate.gate,
        ...(rejectedGate.summary ? { summary: rejectedGate.summary } : {}),
        evidence: rejectedGate.evidence ?? [],
        ...(rejectedGate.completedAt ? { completedAt: rejectedGate.completedAt } : {}),
      },
    };
  }

  if (adoption) {
    return {
      ...base,
      status: "adopted",
      adoptedBy: adoption.adoptedBy,
      adoptedAt: adoption.adoptedAt,
    };
  }

  return {
    ...base,
    status: item.status === "blocked" ? "blocked" : "pending_review",
  };
}

export function projectManagedOrchestrationResultHandoff(
  item: WorkItem,
): WorkItemManagedOrchestrationResultHandoffProjection {
  const policy = item.managedOrchestration;
  const expected = policy?.expectedEvidence.some((evidence) =>
    evidence.required === true && evidence.kind === "result-handoff"
  ) === true || item.expectedEvidence.includes(MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE);
  if (!policy || !expected) {
    return {
      required: false,
      status: "not_required",
      resourceUris: [],
      blockingEvidence: [],
    };
  }
  const handoff = item.managedOrchestrationResultHandoff;
  const base = {
    required: true,
    orchestrationId: policy.orchestrationId,
    childId: policy.childId,
    workItemId: item.id,
    resourceUris: handoff?.resourceUris ?? [],
  } satisfies Omit<WorkItemManagedOrchestrationResultHandoffProjection, "status" | "summary" | "completedAt" | "blockingEvidence">;
  if (isMatchingManagedOrchestrationResultHandoff(item, handoff)) {
    return {
      ...base,
      status: "recorded",
      summary: handoff.summary,
      completedAt: handoff.completedAt,
      blockingEvidence: [],
    };
  }
  return {
    ...base,
    status: item.status === "blocked" ? "blocked" : "pending",
    resourceUris: [],
    blockingEvidence: [MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE],
  };
}

export function reconstructWorkItemsFromSessionEvents(
  events: readonly CanonicalSessionEvent[],
): WorkItemSnapshot {
  const items = new Map<string, WorkItem>();
  let sequence = 0;
  for (const event of [...events].sort(compareSessionEvents)) {
    if (
      event.kind !== "work_item_updated"
      && event.kind !== "work_item_execution_started"
      && event.kind !== "work_item_execution_finished"
    ) {
      continue;
    }
    const normalized = normalizeReplayedWorkItem(event.workItem);
    if (!normalized) {
      continue;
    }
    items.set(normalized.id, normalized);
    sequence = Math.max(sequence, event.workItem.sequence);
  }
  const ordered = [...items.values()].sort((left, right) => left.sequence - right.sequence);
  return {
    items: ordered,
    updatedAt: ordered.at(-1)?.updatedAt,
    sequence,
  };
}

function normalizeReplayedWorkItem(item: WorkItem): WorkItem | undefined {
  return tryNormalizeReplayedWorkItem(item);
}

function tryNormalizeReplayedWorkItem(item: WorkItem): WorkItem | undefined {
  try {
    const store = new WorkItemStore({ now: () => item.updatedAt });
    const normalized = store.upsert(item);
    return {
      ...normalized,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sequence: item.sequence,
    };
  } catch {
    return undefined;
  }
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function normalizeTextRecord(value: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value)
    .map(([key, recordValue]) => [key.trim(), recordValue.trim()] as const)
    .filter(([key, recordValue]) => key.length > 0 && recordValue.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function requiresResidualRisk(
  expectedEvidence: readonly string[],
  skippedVerificationGates: readonly string[],
): boolean {
  return expectedEvidence.includes("residual-risk") || skippedVerificationGates.length > 0;
}

function failedGates(results: readonly VerificationGateResult[]): readonly string[] {
  return results
    .filter((result) => result.status === "failed")
    .map((result) => result.gate);
}

function resolveFailedAttemptStatus(
  input: WorkItemFailExecutionAttemptInput,
): Extract<WorkItemExecutionAttemptStatus, "failed" | "cancelled"> {
  if (input.summary.trim().length === 0) {
    throw new Error("Work item execution failure summary is required.");
  }
  const status = input.terminalStatus ?? (input.failureReason === "cancelled" ? "cancelled" : "failed");
  if (status === "cancelled" && input.failureReason !== "cancelled") {
    throw new Error("Cancelled execution attempts require cancelled failure reason.");
  }
  return status;
}

function missingRequiredVerificationGates(
  item: WorkItem,
  results: readonly VerificationGateResult[],
  skippedVerificationGates: readonly string[],
): readonly string[] {
  const satisfied = new Set([
    ...results
      .filter((result) => result.status === "passed" || result.status === "skipped")
      .map((result) => result.gate),
    ...skippedVerificationGates,
  ]);
  const requiredGatePredicates: ((gate: string) => boolean)[] = [];
  if (item.expectedEvidence.includes("managed-agent-review")) {
    requiredGatePredicates.push(isReviewVerificationGate);
  }
  if (item.expectedEvidence.includes("browser-qa")) {
    requiredGatePredicates.push(isBrowserQaVerificationGate);
  }
  if (requiredGatePredicates.length === 0) {
    return [];
  }
  return item.verificationGates
    .filter((gate) => requiredGatePredicates.some((predicate) => predicate(gate)))
    .filter((gate) => !satisfied.has(gate));
}

function missingExpectedEvidence(
  item: WorkItem,
  providedEvidence: readonly string[],
): readonly string[] {
  return item.expectedEvidence.filter((evidence) => {
    if (isSatisfiedManagedOrchestrationResultHandoff(item, evidence)) {
      return false;
    }
    if (isPendingManagedOrchestrationResultHandoff(item, evidence)) {
      return true;
    }
    if (isSatisfiedManagedOrchestrationAdoptionGate(item, evidence)) {
      return false;
    }
    if (isPendingManagedOrchestrationAdoptionGate(item, evidence)) {
      return true;
    }
    return !providedEvidence.includes(evidence);
  });
}

function isPendingManagedOrchestrationResultHandoff(item: WorkItem, evidence: string): boolean {
  return evidence === MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE
    && item.managedOrchestration !== undefined
    && !isMatchingManagedOrchestrationResultHandoff(item, item.managedOrchestrationResultHandoff);
}

function isSatisfiedManagedOrchestrationResultHandoff(item: WorkItem, evidence: string): boolean {
  return evidence === MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE
    && item.managedOrchestration !== undefined
    && isMatchingManagedOrchestrationResultHandoff(item, item.managedOrchestrationResultHandoff);
}

function isMatchingManagedOrchestrationResultHandoff(
  item: WorkItem,
  handoff: WorkItemManagedOrchestrationResultHandoff | undefined,
): handoff is WorkItemManagedOrchestrationResultHandoff {
  const policy = item.managedOrchestration;
  return Boolean(
    policy
      && handoff
      && handoff.orchestrationId === policy.orchestrationId
      && handoff.childId === policy.childId
      && handoff.workItemId === item.id
      && handoff.summary.trim().length > 0
      && !Number.isNaN(Date.parse(handoff.completedAt))
      && handoff.resourceUris.length > 0,
  );
}

function synthesizeManagedOrchestrationResultHandoff(input: {
  readonly item: WorkItem;
  readonly attempt: WorkItemExecutionAttempt;
  readonly managedInvocationResultHandoff?: ManagedAgentResultHandoff;
  readonly completedAt: string;
}): WorkItemManagedOrchestrationResultHandoff | undefined {
  const handoff = input.managedInvocationResultHandoff;
  if (!handoff) {
    return undefined;
  }
  const policy = input.item.managedOrchestration;
  if (!policy) {
    throw new Error("Managed invocation result handoff requires managed orchestration policy.");
  }
  if (input.attempt.executionMode !== "managed_delegation" || !input.attempt.managedInvocationId) {
    throw new Error("Managed invocation result handoff requires a managed-delegation execution attempt.");
  }
  return normalizeManagedOrchestrationResultHandoff({
    orchestrationId: policy.orchestrationId,
    childId: policy.childId,
    workItemId: input.item.id,
    summary: handoff.summary,
    completedAt: input.completedAt,
    resourceUris: handoff.resourceUris,
  }, policy, input.item.id);
}

function isPendingManagedOrchestrationAdoptionGate(item: WorkItem, evidence: string): boolean {
  return evidence === MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE
    && item.managedOrchestration?.adoptionGate.required === true
    && item.managedOrchestrationAdoption?.target !== item.managedOrchestration.adoptionGate.target;
}

function isSatisfiedManagedOrchestrationAdoptionGate(item: WorkItem, evidence: string): boolean {
  return evidence === MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE
    && item.managedOrchestration?.adoptionGate.required === true
    && item.managedOrchestrationAdoption?.target === item.managedOrchestration.adoptionGate.target;
}

function isFailedManagedOrchestrationAdoptionGateResult(result: VerificationGateResult): boolean {
  return result.status === "failed" && result.gate.toLowerCase().includes("managed orchestration adoption");
}

function isReviewVerificationGate(gate: string): boolean {
  const normalized = gate.toLowerCase();
  return normalized.includes("review") || normalized.includes("ddd");
}

function isBrowserQaVerificationGate(gate: string): boolean {
  const normalized = gate.toLowerCase();
  return normalized.includes("browser") || normalized.includes("accessibility") || normalized.includes("overflow");
}

function mergeVerificationGateResults(
  ...groups: readonly (readonly VerificationGateResult[])[]
): readonly VerificationGateResult[] {
  return normalizeVerificationGateResults(groups.flat());
}

function normalizeVerificationGateResults(results: readonly VerificationGateResult[]): readonly VerificationGateResult[] {
  const byGate = new Map<string, VerificationGateResult>();
  for (const result of results) {
    const gate = result.gate.trim();
    if (!gate) {
      continue;
    }
    byGate.set(gate, {
      gate,
      status: result.status,
      ...(result.summary ? { summary: result.summary } : {}),
      ...(result.evidence ? { evidence: unique(result.evidence) } : {}),
      ...(result.completedAt ? { completedAt: result.completedAt } : {}),
    });
  }
  return [...byGate.values()];
}

function normalizePauseRequirements(
  requirements: readonly WorkItemPauseRequirement[],
): readonly WorkItemPauseRequirement[] {
  const byId = new Map<string, WorkItemPauseRequirement>();
  for (const requirement of requirements) {
    if (byId.has(requirement.id)) {
      continue;
    }
    byId.set(requirement.id, requirement);
  }
  return [...byId.values()];
}

function normalizeManagedOrchestrationPolicy(
  policy: WorkItemManagedOrchestrationPolicy | undefined,
): WorkItemManagedOrchestrationPolicy | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    orchestrationId: policy.orchestrationId.trim(),
    mode: policy.mode.trim(),
    childId: policy.childId.trim(),
    ordinal: policy.ordinal,
    roleIntent: policy.roleIntent.trim(),
    expectedEvidence: policy.expectedEvidence.map((evidence) => ({
      kind: evidence.kind.trim(),
      label: evidence.label.trim(),
      required: evidence.required === true,
    })),
    isolation: {
      required: policy.isolation.required === true,
      reason: policy.isolation.reason.trim(),
      ...(policy.isolation.workingDirectoryMode
        ? { workingDirectoryMode: policy.isolation.workingDirectoryMode.trim() }
        : {}),
    },
    mergePolicy: {
      mode: policy.mergePolicy.mode.trim(),
      adoptionRequired: policy.mergePolicy.adoptionRequired === true,
    },
    adoptionGate: {
      required: policy.adoptionGate.required === true,
      target: MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET,
      reason: policy.adoptionGate.reason.trim(),
    },
  };
}

function normalizeWorkItemExpectedEvidence(input: {
  readonly expectedEvidence: readonly string[];
  readonly managedOrchestration?: WorkItemManagedOrchestrationPolicy;
}): readonly string[] {
  const expectedEvidence = [...input.expectedEvidence];
  const requiresManagedOrchestrationHandoff = input.managedOrchestration?.expectedEvidence.some((evidence) =>
    evidence.kind === "result-handoff" && evidence.required === true
  ) === true;
  if (requiresManagedOrchestrationHandoff) {
    expectedEvidence.push(MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE);
  }
  return unique(expectedEvidence);
}

function normalizeManagedOrchestrationResultHandoff(
  handoff: WorkItemManagedOrchestrationResultHandoff | undefined,
  policy: WorkItemManagedOrchestrationPolicy | undefined,
  workItemId: string,
): WorkItemManagedOrchestrationResultHandoff | undefined {
  if (!handoff) {
    return undefined;
  }
  if (!policy) {
    throw new Error("Managed orchestration result handoff requires managed orchestration policy.");
  }
  const orchestrationId = handoff.orchestrationId.trim();
  if (orchestrationId !== policy.orchestrationId.trim()) {
    throw new Error("Managed orchestration result handoff orchestration id must match the work item.");
  }
  const childId = handoff.childId.trim();
  if (childId !== policy.childId.trim()) {
    throw new Error("Managed orchestration result handoff child id must match the work item.");
  }
  const normalizedWorkItemId = handoff.workItemId.trim();
  if (normalizedWorkItemId !== workItemId) {
    throw new Error("Managed orchestration result handoff work item id must match the work item.");
  }
  const summary = handoff.summary.trim();
  if (!summary) {
    throw new Error("Managed orchestration result handoff summary is required.");
  }
  const completedAt = handoff.completedAt.trim();
  if (Number.isNaN(Date.parse(completedAt))) {
    throw new Error("Managed orchestration result handoff timestamp is required.");
  }
  const resourceUris = unique(handoff.resourceUris.map((uri) => uri.trim()).filter((uri) => uri.length > 0));
  if (resourceUris.length === 0) {
    throw new Error("Managed orchestration result handoff requires at least one resource uri.");
  }
  return {
    orchestrationId,
    childId,
    workItemId: normalizedWorkItemId,
    summary,
    completedAt,
    resourceUris,
  };
}

function normalizeManagedOrchestrationAdoption(
  adoption: WorkItemManagedOrchestrationAdoptionResolution | undefined,
): WorkItemManagedOrchestrationAdoptionResolution | undefined {
  if (!adoption) {
    return undefined;
  }
  const adoptedAt = adoption.adoptedAt.trim();
  if (Number.isNaN(Date.parse(adoptedAt))) {
    throw new Error("Managed orchestration adoption timestamp is required.");
  }
  if (adoption.target !== MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET) {
    throw new Error("Managed orchestration adoption target must be slice-6-handoff-review-adoption.");
  }
  const adoptedBy = adoption.adoptedBy.trim();
  if (!adoptedBy) {
    throw new Error("Managed orchestration adoption actor is required.");
  }
  const resourceUris = unique(adoption.resourceUris.map((uri) => uri.trim()).filter((uri) => uri.length > 0));
  if (resourceUris.length === 0) {
    throw new Error("Managed orchestration adoption requires at least one resource uri.");
  }
  return {
    target: MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET,
    adoptedBy,
    adoptedAt,
    resourceUris,
  };
}
