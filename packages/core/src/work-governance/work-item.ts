import { compareSessionEvents, type CanonicalSessionEvent } from "../events/session-event.js";

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
export type WorkItemPauseRequirementKind = "operator_input" | "credentials" | "approval" | "authority_elevation";
export type WorkItemPauseRequirementStatus = "pending" | "resolved";
export type VerificationGateResultStatus = "passed" | "failed" | "skipped";

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
}

export interface WorkItemFinishExecutionAttemptResult extends WorkItemCompletionResult {
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
      authorityProfile: input.authorityProfile,
      expectedEvidence: unique(input.expectedEvidence),
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
    const missingEvidence = existing.expectedEvidence.filter((evidence) => !providedEvidence.includes(evidence));
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
    const missingEvidence = existing.expectedEvidence.filter((evidence) => !providedEvidence.includes(evidence));
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

  private notifyChanged(id: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/work-items");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/work-items/${encodeURIComponent(id)}`);
  }
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
    items.set(event.workItem.id, event.workItem);
    sequence = Math.max(sequence, event.workItem.sequence);
  }
  const ordered = [...items.values()].sort((left, right) => left.sequence - right.sequence);
  return {
    items: ordered,
    updatedAt: ordered.at(-1)?.updatedAt,
    sequence,
  };
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
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
