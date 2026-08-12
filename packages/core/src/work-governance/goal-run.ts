import { compareSessionEvents, type CanonicalSessionEvent } from "../events/session-event.js";
import {
  normalizeBoundedWorkContractRevision,
  supersedeBoundedWorkContractRevision,
  type BoundedWorkAdoptionAuthority,
  type BoundedWorkContract,
  type BoundedWorkContractRevision,
} from "./bounded-work-contract.js";
import {
  normalizeBoundedWorkAccountingSnapshot,
  type BoundedWorkCloseoutDecision,
} from "./bounded-work-decision.js";
import { freezeBoundedWorkValue, requireBoundedWorkDigest } from "./bounded-work-content.js";

export type GoalRunStatus = "active" | "paused" | "completed" | "failed" | "cancelled";

export type GoalRunAuthorityLevel = "read_only" | "audited" | "destructive";

export type GoalRunEscalationPolicy = "deny" | "approval_required";

export interface GoalRunAuthorityEnvelope {
  readonly maximumAuthority: GoalRunAuthorityLevel;
  readonly escalationPolicy: GoalRunEscalationPolicy;
  readonly reason: string;
}

export interface GoalRunRoutePolicy {
  readonly workflowProfile: string;
  readonly preferredRouteId?: string;
  readonly managedAgentProfile?: string;
}

export interface GoalRunEvidenceRequirement {
  readonly id: string;
  readonly description: string;
  readonly required: boolean;
}

export interface GoalRunEvidenceRecord {
  readonly requirementId: string;
  readonly summary: string;
  readonly resourceUris: readonly string[];
  readonly workItemIds: readonly string[];
  readonly recordedAt: string;
}

export interface GoalRunRecordEvidenceInput {
  readonly id: string;
  readonly requirementId: string;
  readonly summary: string;
  readonly resourceUris?: readonly string[];
  readonly workItemIds?: readonly string[];
}

export type GoalRunSource =
  | {
      readonly kind: "approved_plan";
      readonly planId: string;
      readonly planHash?: string;
    }
  | {
      readonly kind: "operator_direct";
      readonly turnId: string;
    };

export interface GoalRunCreateInput {
  readonly id: string;
  readonly objective: string;
  readonly ownerSessionId: string;
  readonly source: GoalRunSource;
  readonly boundedWorkContractRevision: BoundedWorkContractRevision;
  readonly workItemIds: readonly string[];
  readonly authorityEnvelope: GoalRunAuthorityEnvelope;
  readonly routePolicy: GoalRunRoutePolicy;
  readonly evidenceRequirements: readonly GoalRunEvidenceRequirement[];
  readonly currentPhase?: string;
}

export interface GoalRunUpdateInput {
  readonly id: string;
  readonly currentPhase?: string;
}

export interface GoalRunSupersedeBoundedWorkContractInput {
  readonly id: string;
  readonly expectedRevisionDigest: string;
  readonly contract: BoundedWorkContract;
  readonly adoptedAt: string;
  readonly adoptedBy: BoundedWorkAdoptionAuthority;
}

export interface GoalRunAttachWorkItemsInput {
  readonly id: string;
  readonly workItemIds: readonly string[];
}

export interface GoalRunTerminalInput {
  readonly id: string;
  readonly reason?: string;
}

export interface GoalRunControlInput {
  readonly id: string;
}

export interface GoalRunCompleteInput {
  readonly id: string;
  readonly closeoutSummary: string;
  readonly boundedWorkCloseoutDecision: Extract<BoundedWorkCloseoutDecision, { readonly kind: "stop_acceptance_complete" }>;
}

export interface GoalRun {
  readonly id: string;
  readonly objective: string;
  readonly ownerSessionId: string;
  readonly source: GoalRunSource;
  readonly boundedWorkContractRevision: BoundedWorkContractRevision;
  readonly boundedWorkContractRevisionHistory: readonly BoundedWorkContractRevision[];
  readonly status: GoalRunStatus;
  readonly workItemIds: readonly string[];
  readonly authorityEnvelope: GoalRunAuthorityEnvelope;
  readonly routePolicy: GoalRunRoutePolicy;
  readonly evidenceRequirements: readonly GoalRunEvidenceRequirement[];
  readonly evidence: readonly GoalRunEvidenceRecord[];
  readonly currentPhase?: string;
  readonly closeoutSummary?: string;
  readonly boundedWorkCloseoutDecision?: Extract<BoundedWorkCloseoutDecision, { readonly kind: "stop_acceptance_complete" }>;
  readonly terminalReason?: string;
  readonly activeDurationMs: number;
  readonly activeSince?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sequence: number;
}

export interface GoalRunSnapshot {
  readonly goals: readonly GoalRun[];
  readonly updatedAt?: string;
  readonly sequence: number;
}

export interface GoalRunResourceChangeNotifier {
  notifyResourceUpdated(uri: string): void;
}

export interface GoalRunStoreOptions {
  readonly resourceNotifications?: GoalRunResourceChangeNotifier;
  readonly now?: () => string;
}

export class GoalRunStore {
  private readonly goals = new Map<string, GoalRun>();
  private readonly now: () => string;
  private sequence = 0;
  private resourceNotifications?: GoalRunResourceChangeNotifier;

  constructor(options: GoalRunStoreOptions = {}) {
    this.resourceNotifications = options.resourceNotifications;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  setResourceChangeNotifier(resourceNotifications: GoalRunResourceChangeNotifier): void {
    this.resourceNotifications = resourceNotifications;
  }

  create(input: GoalRunCreateInput): GoalRun {
    const id = requireText(input.id, "id");
    if (this.goals.has(id)) {
      throw new Error(`Goal ${id} already exists.`);
    }
    const ownerSessionId = requireText(input.ownerSessionId, "ownerSessionId");
    const existingForeground = this.list().find(
      (goal) => goal.ownerSessionId === ownerSessionId && !isTerminalGoalStatus(goal.status),
    );
    if (existingForeground) {
      throw new Error(`Session ${ownerSessionId} already has foreground goal ${existingForeground.id}.`);
    }
    const timestamp = this.now();
    const boundedWorkContractRevision = normalizeInitialBoundedWorkRevision(
      input.boundedWorkContractRevision,
    );
    const objective = requireText(input.objective, "objective");
    assertGoalBoundedWorkBindings({
      id,
      objective,
      boundedWorkContractRevision,
      workItemIds: input.workItemIds,
    });
    const goal: GoalRun = {
      id,
      objective,
      ownerSessionId,
      source: normalizeGoalRunSource(input.source),
      boundedWorkContractRevision,
      boundedWorkContractRevisionHistory: freezeRevisionHistory([boundedWorkContractRevision]),
      status: "active",
      workItemIds: uniqueRequired(input.workItemIds, "workItemIds"),
      authorityEnvelope: normalizeAuthorityEnvelope(input.authorityEnvelope),
      routePolicy: normalizeRoutePolicy(input.routePolicy),
      evidenceRequirements: normalizeEvidenceRequirements(input.evidenceRequirements),
      evidence: [],
      activeDurationMs: 0,
      activeSince: timestamp,
      ...(normalizeText(input.currentPhase) ? { currentPhase: normalizeText(input.currentPhase)! } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      sequence: ++this.sequence,
    };
    this.goals.set(id, goal);
    this.notifyChanged(id);
    return goal;
  }

  update(input: GoalRunUpdateInput): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    const forbiddenField = [
      "objective",
      "workItemIds",
      "authorityEnvelope",
      "routePolicy",
      "evidenceRequirements",
    ].find((field) => field in (input as unknown as Record<string, unknown>));
    if (forbiddenField) {
      throw new Error(`Goal ${input.id} field ${forbiddenField} is immutable; use an explicit governed operation.`);
    }
    const goal: GoalRun = {
      ...existing,
      ...(input.currentPhase !== undefined && normalizeText(input.currentPhase) ? { currentPhase: normalizeText(input.currentPhase)! } : {}),
      updatedAt: this.now(),
      sequence: ++this.sequence,
    };
    this.goals.set(goal.id, goal);
    this.notifyChanged(goal.id);
    return goal;
  }

  supersedeBoundedWorkContract(
    input: GoalRunSupersedeBoundedWorkContractInput,
  ): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    const current = requireGoalBoundedWorkRevision(existing);
    const next = supersedeBoundedWorkContractRevision({
      current,
      contract: input.contract,
      expectedRevisionDigest: input.expectedRevisionDigest,
      adoptedAt: input.adoptedAt,
      adoptedBy: input.adoptedBy,
      accountingLineageId: current.accountingLineageId,
    });
    assertGoalBoundedWorkBindings({
      id: existing.id,
      objective: existing.objective,
      boundedWorkContractRevision: next,
      workItemIds: existing.workItemIds,
    });
    const goal: GoalRun = {
      ...existing,
      boundedWorkContractRevision: next,
      boundedWorkContractRevisionHistory: freezeRevisionHistory([
        ...existing.boundedWorkContractRevisionHistory,
        next,
      ]),
      updatedAt: this.now(),
      sequence: ++this.sequence,
    };
    this.goals.set(goal.id, goal);
    this.notifyChanged(goal.id);
    return goal;
  }

  attachWorkItems(input: GoalRunAttachWorkItemsInput): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    const workItemIds = uniqueRequired(input.workItemIds, "workItemIds");
    const unknownWorkItemId = workItemIds.find(
      (workItemId) => !existing.boundedWorkContractRevision.contract.scope.allowedWorkItemIds.includes(workItemId),
    );
    if (unknownWorkItemId) {
      throw new Error(
        `Goal ${input.id} work item ${unknownWorkItemId} is outside the current bounded-work scope.`,
      );
    }
    const nextWorkItemIds = uniqueRequired([...existing.workItemIds, ...workItemIds], "workItemIds");
    const goal: GoalRun = {
      ...existing,
      workItemIds: nextWorkItemIds,
      updatedAt: this.now(),
      sequence: ++this.sequence,
    };
    this.goals.set(goal.id, goal);
    this.notifyChanged(goal.id);
    return goal;
  }

  complete(input: GoalRunCompleteInput): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    return this.transitionTerminal(existing, {
      status: "completed",
      closeoutSummary: requireText(input.closeoutSummary, "closeoutSummary"),
      boundedWorkCloseoutDecision: normalizeGoalCloseoutDecision(existing, input.boundedWorkCloseoutDecision),
    });
  }

  pause(input: GoalRunControlInput): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    if (existing.status !== "active") {
      throw new Error(`Goal ${input.id} is ${existing.status} and cannot be paused.`);
    }
    const timestamp = this.now();
    const { activeSince: _activeSince, ...pausedState } = existing;
    const goal: GoalRun = {
      ...pausedState,
      status: "paused",
      currentPhase: "operator_paused",
      activeDurationMs: accumulatedActiveDuration(existing, timestamp),
      updatedAt: timestamp,
      sequence: ++this.sequence,
    };
    this.goals.set(goal.id, goal);
    this.notifyChanged(goal.id);
    return goal;
  }

  resume(input: GoalRunControlInput): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    if (existing.status !== "paused") {
      throw new Error(`Goal ${input.id} is ${existing.status} and cannot be resumed.`);
    }
    const timestamp = this.now();
    const goal: GoalRun = {
      ...existing,
      status: "active",
      currentPhase: "operator_resumed",
      activeSince: timestamp,
      updatedAt: timestamp,
      sequence: ++this.sequence,
    };
    this.goals.set(goal.id, goal);
    this.notifyChanged(goal.id);
    return goal;
  }

  recordEvidence(input: GoalRunRecordEvidenceInput): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    const requirementId = requireText(input.requirementId, "requirementId");
    if (!existing.evidenceRequirements.some((requirement) => requirement.id === requirementId)) {
      throw new Error(`Goal ${existing.id} does not declare evidence requirement ${requirementId}.`);
    }
    const workItemIds = uniqueOptional(input.workItemIds ?? [], "workItemIds");
    const unknownWorkItemId = workItemIds.find((workItemId) => !existing.workItemIds.includes(workItemId));
    if (unknownWorkItemId) {
      throw new Error(`Goal ${existing.id} does not contain work item ${unknownWorkItemId}.`);
    }
    const record: GoalRunEvidenceRecord = {
      requirementId,
      summary: requireText(input.summary, "summary"),
      resourceUris: uniqueOptional(input.resourceUris ?? [], "resourceUris"),
      workItemIds,
      recordedAt: this.now(),
    };
    const goal: GoalRun = {
      ...existing,
      evidence: [
        ...existing.evidence.filter((candidate) => candidate.requirementId !== requirementId),
        record,
      ],
      updatedAt: record.recordedAt,
      sequence: ++this.sequence,
    };
    this.goals.set(goal.id, goal);
    this.notifyChanged(goal.id);
    return goal;
  }

  fail(input: GoalRunTerminalInput): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    return this.transitionTerminal(existing, {
      status: "failed",
      terminalReason: requireText(input.reason, "reason"),
    });
  }

  cancel(input: GoalRunTerminalInput & { readonly cancelledBy?: string }): GoalRun {
    const existing = this.requireMutableGoal(input.id);
    const reason = requireText(input.reason, "reason");
    const cancelledBy = normalizeText(input.cancelledBy);
    return this.transitionTerminal(existing, {
      status: "cancelled",
      terminalReason: cancelledBy ? `${reason} (${cancelledBy})` : reason,
    });
  }

  get(id: string): GoalRun | undefined {
    return this.goals.get(id);
  }

  restore(goal: GoalRun): GoalRun {
    const normalizedGoal = normalizeRestoredGoal(goal);
    const existingForeground = this.list().find(
      (candidate) => candidate.id !== normalizedGoal.id
        && candidate.ownerSessionId === normalizedGoal.ownerSessionId
        && !isTerminalGoalStatus(candidate.status)
        && !isTerminalGoalStatus(normalizedGoal.status),
    );
    if (existingForeground) {
      throw new Error(`Session ${normalizedGoal.ownerSessionId} already has foreground goal ${existingForeground.id}.`);
    }
    this.goals.set(normalizedGoal.id, normalizedGoal);
    this.sequence = Math.max(this.sequence, normalizedGoal.sequence);
    this.notifyChanged(normalizedGoal.id);
    return normalizedGoal;
  }

  list(status?: GoalRunStatus): readonly GoalRun[] {
    const goals = [...this.goals.values()].sort((left, right) => left.sequence - right.sequence);
    return status ? goals.filter((goal) => goal.status === status) : goals;
  }

  snapshot(status?: GoalRunStatus): GoalRunSnapshot {
    const goals = this.list(status);
    return {
      goals,
      updatedAt: goals.at(-1)?.updatedAt,
      sequence: this.sequence,
    };
  }

  private requireMutableGoal(id: string): GoalRun {
    const goal = this.goals.get(id);
    if (!goal) {
      throw new Error(`Goal ${id} was not found.`);
    }
    requireGoalBoundedWorkRevision(goal);
    if (isTerminalGoalStatus(goal.status)) {
      throw new Error(`Goal ${id} is terminal and cannot transition.`);
    }
    return goal;
  }

  private transitionTerminal(
    existing: GoalRun,
    terminal: Pick<GoalRun, "status"> & Partial<Pick<GoalRun, "closeoutSummary" | "terminalReason" | "boundedWorkCloseoutDecision">>,
  ): GoalRun {
    const timestamp = this.now();
    const { activeSince: _activeSince, ...terminalState } = existing;
    const goal: GoalRun = {
      ...terminalState,
      ...terminal,
      currentPhase: terminal.status,
      activeDurationMs: accumulatedActiveDuration(existing, timestamp),
      updatedAt: timestamp,
      sequence: ++this.sequence,
    };
    this.goals.set(goal.id, goal);
    this.notifyChanged(goal.id);
    return goal;
  }

  private notifyChanged(id: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/goals");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/goals/${encodeURIComponent(id)}`);
  }
}

function accumulatedActiveDuration(goal: GoalRun, timestamp: string): number {
  if (!goal.activeSince) {
    return goal.activeDurationMs;
  }
  const startedAt = Date.parse(goal.activeSince);
  const endedAt = Date.parse(timestamp);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    throw new Error(`Goal ${goal.id} active clock is invalid.`);
  }
  return goal.activeDurationMs + (endedAt - startedAt);
}

function normalizeGoalRunSource(source: GoalRunSource): GoalRunSource {
  if (source.kind === "approved_plan") {
    const planHash = normalizeText(source.planHash);
    return {
      kind: "approved_plan",
      planId: requireText(source.planId, "source.planId"),
      ...(planHash ? { planHash } : {}),
    };
  }
  return {
    kind: "operator_direct",
    turnId: requireText(source.turnId, "source.turnId"),
  };
}

export function reconstructGoalRunsFromSessionEvents(
  events: readonly CanonicalSessionEvent[],
): GoalRunSnapshot {
  const goals = new Map<string, GoalRun>();
  let sequence = 0;
  for (const event of [...events].sort(compareSessionEvents)) {
    if (
      event.kind !== "goal.created"
      && event.kind !== "goal.updated"
      && event.kind !== "goal.completed"
      && event.kind !== "goal.failed"
      && event.kind !== "goal.cancelled"
    ) {
      continue;
    }
    const goal = normalizeRestoredGoal(event.goal);
    goals.set(goal.id, goal);
    sequence = Math.max(sequence, goal.sequence);
  }
  const ordered = [...goals.values()].sort((left, right) => left.sequence - right.sequence);
  return {
    goals: ordered,
    updatedAt: ordered.at(-1)?.updatedAt,
    sequence,
  };
}

export function isTerminalGoalStatus(status: GoalRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function normalizeInitialBoundedWorkRevision(
  revision: BoundedWorkContractRevision | undefined,
): BoundedWorkContractRevision {
  if (!revision) {
    throw new Error("GoalRun bounded-work contract revision is required.");
  }
  const normalized = normalizeBoundedWorkContractRevision(revision);
  if (normalized.revision !== 1 || normalized.parentRevisionDigest !== undefined) {
    throw new Error("GoalRun bounded-work authority must start at revision 1.");
  }
  return normalized;
}

function requireGoalBoundedWorkRevision(goal: GoalRun): BoundedWorkContractRevision {
  const candidate = (goal as Partial<GoalRun>).boundedWorkContractRevision;
  const history = (goal as Partial<GoalRun>).boundedWorkContractRevisionHistory;
  if (!candidate || !history) {
    throw new Error(`Goal ${goal.id} requires bounded-work reconciliation.`);
  }
  const normalizedCurrent = normalizeBoundedWorkContractRevision(candidate);
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error(`Goal ${goal.id} requires bounded-work reconciliation.`);
  }
  const normalizedHistory = history.map((revision) => normalizeBoundedWorkContractRevision(revision));
  const first = normalizedHistory[0];
  const last = normalizedHistory.at(-1);
  if (!first || first.revision !== 1 || first.parentRevisionDigest !== undefined) {
    throw new Error(`Goal ${goal.id} bounded-work revision history is invalid.`);
  }
  if (!last || last.revisionDigest !== normalizedCurrent.revisionDigest) {
    throw new Error(`Goal ${goal.id} bounded-work revision history is stale.`);
  }
  for (let index = 1; index < normalizedHistory.length; index += 1) {
    const previous = normalizedHistory[index - 1]!;
    const current = normalizedHistory[index]!;
    if (
      current.revision !== previous.revision + 1
      || current.parentRevisionDigest !== previous.revisionDigest
      || current.accountingLineageId !== first.accountingLineageId
    ) {
      throw new Error(`Goal ${goal.id} bounded-work revision history is not contiguous.`);
    }
  }
  if (normalizedCurrent.accountingLineageId !== first.accountingLineageId) {
    throw new Error(`Goal ${goal.id} bounded-work accounting lineage changed.`);
  }
  assertGoalBoundedWorkBindings({
    id: goal.id,
    objective: goal.objective,
    boundedWorkContractRevision: normalizedCurrent,
    workItemIds: goal.workItemIds,
  });
  return normalizedCurrent;
}

function assertGoalBoundedWorkBindings(input: {
  readonly id: string;
  readonly objective: string;
  readonly boundedWorkContractRevision: BoundedWorkContractRevision;
  readonly workItemIds: readonly string[];
}): void {
  if (input.boundedWorkContractRevision.accountingLineageId !== input.id) {
    throw new Error(
      `Goal ${input.id} bounded-work accounting lineage must equal the goal id.`,
    );
  }
  if (input.boundedWorkContractRevision.contract.intent.objective !== input.objective) {
    throw new Error(
      `Goal ${input.id} objective must equal bounded-work contract intent.objective.`,
    );
  }
  const allowedWorkItemIds = new Set(
    input.boundedWorkContractRevision.contract.scope.allowedWorkItemIds,
  );
  const unknownWorkItemId = input.workItemIds.find((workItemId) => !allowedWorkItemIds.has(workItemId));
  if (unknownWorkItemId) {
    throw new Error(
      `Goal ${input.id} work item ${unknownWorkItemId} is outside the current bounded-work scope.`,
    );
  }
}

function normalizeRestoredGoal(goal: GoalRun): GoalRun {
  const boundedWorkContractRevision = requireGoalBoundedWorkRevision(goal);
  const boundedWorkContractRevisionHistory = freezeRevisionHistory(
    (goal as Partial<GoalRun>).boundedWorkContractRevisionHistory!.map((revision) =>
      normalizeBoundedWorkContractRevision(revision),
    ),
  );
  const boundedWorkCloseoutDecision = goal.status === "completed"
    ? normalizeGoalCloseoutDecision(goal, goal.boundedWorkCloseoutDecision)
    : undefined;
  if (goal.status !== "completed" && goal.boundedWorkCloseoutDecision !== undefined) {
    throw new Error(`Goal ${goal.id} has bounded-work closeout evidence without completed status.`);
  }
  return {
    ...goal,
    boundedWorkContractRevision,
    boundedWorkContractRevisionHistory,
    ...(boundedWorkCloseoutDecision ? { boundedWorkCloseoutDecision } : {}),
  };
}

function normalizeGoalCloseoutDecision(
  goal: Pick<GoalRun, "id" | "boundedWorkContractRevision">,
  decision: GoalRun["boundedWorkCloseoutDecision"],
): NonNullable<GoalRun["boundedWorkCloseoutDecision"]> {
  if (!decision || decision.kind !== "stop_acceptance_complete") {
    throw new Error(`Goal ${goal.id} requires persisted bounded-work acceptance evidence.`);
  }
  const candidateDigest = requireBoundedWorkDigest(decision.candidateDigest, "boundedWorkCloseoutDecision.candidateDigest");
  const contractRevisionDigest = requireBoundedWorkDigest(
    decision.contractRevisionDigest,
    "boundedWorkCloseoutDecision.contractRevisionDigest",
  );
  const accounting = normalizeBoundedWorkAccountingSnapshot(decision.accounting);
  if (
    contractRevisionDigest !== goal.boundedWorkContractRevision.revisionDigest
    || accounting.contractRevisionDigest !== contractRevisionDigest
    || accounting.accountingLineageId !== goal.id
  ) {
    throw new Error(`Goal ${goal.id} bounded-work acceptance evidence is stale or misattributed.`);
  }
  return freezeBoundedWorkValue({
    kind: "stop_acceptance_complete" as const,
    candidateDigest,
    contractRevisionDigest,
    accounting,
  });
}

function freezeRevisionHistory(
  revisions: readonly BoundedWorkContractRevision[],
): readonly BoundedWorkContractRevision[] {
  return Object.freeze([...revisions]);
}

function normalizeAuthorityEnvelope(input: GoalRunAuthorityEnvelope): GoalRunAuthorityEnvelope {
  if (
    input.maximumAuthority !== "read_only"
    && input.maximumAuthority !== "audited"
    && input.maximumAuthority !== "destructive"
  ) {
    throw new Error("authorityEnvelope.maximumAuthority must be read_only, audited, or destructive.");
  }
  if (input.escalationPolicy !== "deny" && input.escalationPolicy !== "approval_required") {
    throw new Error("authorityEnvelope.escalationPolicy must be deny or approval_required.");
  }
  return {
    maximumAuthority: input.maximumAuthority,
    escalationPolicy: input.escalationPolicy,
    reason: requireText(input.reason, "authorityEnvelope.reason"),
  };
}

function normalizeRoutePolicy(input: GoalRunRoutePolicy): GoalRunRoutePolicy {
  return {
    workflowProfile: requireText(input.workflowProfile, "routePolicy.workflowProfile"),
    ...(normalizeText(input.preferredRouteId) ? { preferredRouteId: normalizeText(input.preferredRouteId)! } : {}),
    ...(normalizeText(input.managedAgentProfile) ? { managedAgentProfile: normalizeText(input.managedAgentProfile)! } : {}),
  };
}

function normalizeEvidenceRequirements(
  input: readonly GoalRunEvidenceRequirement[],
): readonly GoalRunEvidenceRequirement[] {
  const seen = new Set<string>();
  return input.map((requirement, index) => {
    const id = requireText(requirement.id, `evidenceRequirements.${index}.id`);
    if (seen.has(id)) {
      throw new Error(`Duplicate evidence requirement id: ${id}`);
    }
    seen.add(id);
    return {
      id,
      description: requireText(requirement.description, `evidenceRequirements.${index}.description`),
      required: requireBoolean(requirement.required, `evidenceRequirements.${index}.required`),
    };
  });
}

function uniqueRequired(values: readonly string[], field: string): readonly string[] {
  const seen = new Set<string>();
  return values.map((value, index) => {
    const normalized = requireText(value, `${field}.${index}`);
    if (seen.has(normalized)) {
      throw new Error(`Duplicate ${field} id: ${normalized}`);
    }
    seen.add(normalized);
    return normalized;
  });
}

function uniqueOptional(values: readonly string[], field: string): readonly string[] {
  const seen = new Set<string>();
  return values.map((value, index) => {
    const normalized = requireText(value, `${field}.${index}`);
    if (seen.has(normalized)) {
      throw new Error(`Duplicate ${field} value: ${normalized}`);
    }
    seen.add(normalized);
    return normalized;
  });
}

function requireBoolean(value: boolean | undefined, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function requireText(value: string | undefined, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
