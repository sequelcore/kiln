import { compareSessionEvents, type CanonicalSessionEvent } from "../events/session-event.js";

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
  readonly id?: string;
  readonly objective: string;
  readonly ownerSessionId: string;
  readonly source: GoalRunSource;
  readonly workItemIds: readonly string[];
  readonly authorityEnvelope: GoalRunAuthorityEnvelope;
  readonly routePolicy: GoalRunRoutePolicy;
  readonly evidenceRequirements: readonly GoalRunEvidenceRequirement[];
  readonly currentPhase?: string;
}

export interface GoalRunUpdateInput {
  readonly id: string;
  readonly objective?: string;
  readonly workItemIds?: readonly string[];
  readonly authorityEnvelope?: GoalRunAuthorityEnvelope;
  readonly routePolicy?: GoalRunRoutePolicy;
  readonly evidenceRequirements?: readonly GoalRunEvidenceRequirement[];
  readonly currentPhase?: string;
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
}

export interface GoalRun {
  readonly id: string;
  readonly objective: string;
  readonly ownerSessionId: string;
  readonly source: GoalRunSource;
  readonly status: GoalRunStatus;
  readonly workItemIds: readonly string[];
  readonly authorityEnvelope: GoalRunAuthorityEnvelope;
  readonly routePolicy: GoalRunRoutePolicy;
  readonly evidenceRequirements: readonly GoalRunEvidenceRequirement[];
  readonly evidence: readonly GoalRunEvidenceRecord[];
  readonly currentPhase?: string;
  readonly closeoutSummary?: string;
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
    const id = normalizeText(input.id) ?? `goal-${this.sequence + 1}`;
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
    const goal: GoalRun = {
      id,
      objective: requireText(input.objective, "objective"),
      ownerSessionId,
      source: normalizeGoalRunSource(input.source),
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
    const goal: GoalRun = {
      ...existing,
      ...(input.objective !== undefined ? { objective: requireText(input.objective, "objective") } : {}),
      ...(input.workItemIds !== undefined ? { workItemIds: uniqueRequired(input.workItemIds, "workItemIds") } : {}),
      ...(input.authorityEnvelope !== undefined ? { authorityEnvelope: normalizeAuthorityEnvelope(input.authorityEnvelope) } : {}),
      ...(input.routePolicy !== undefined ? { routePolicy: normalizeRoutePolicy(input.routePolicy) } : {}),
      ...(input.evidenceRequirements !== undefined ? { evidenceRequirements: normalizeEvidenceRequirements(input.evidenceRequirements) } : {}),
      ...(input.currentPhase !== undefined && normalizeText(input.currentPhase) ? { currentPhase: normalizeText(input.currentPhase)! } : {}),
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
    const existingForeground = this.list().find(
      (candidate) => candidate.id !== goal.id
        && candidate.ownerSessionId === goal.ownerSessionId
        && !isTerminalGoalStatus(candidate.status)
        && !isTerminalGoalStatus(goal.status),
    );
    if (existingForeground) {
      throw new Error(`Session ${goal.ownerSessionId} already has foreground goal ${existingForeground.id}.`);
    }
    this.goals.set(goal.id, goal);
    this.sequence = Math.max(this.sequence, goal.sequence);
    this.notifyChanged(goal.id);
    return goal;
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
    if (isTerminalGoalStatus(goal.status)) {
      throw new Error(`Goal ${id} is terminal and cannot transition.`);
    }
    return goal;
  }

  private transitionTerminal(
    existing: GoalRun,
    terminal: Pick<GoalRun, "status"> & Partial<Pick<GoalRun, "closeoutSummary" | "terminalReason">>,
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
    goals.set(event.goal.id, event.goal);
    sequence = Math.max(sequence, event.goal.sequence);
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
