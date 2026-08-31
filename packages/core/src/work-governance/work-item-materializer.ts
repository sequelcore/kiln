import type { SessionPlan, SessionPlanWorkItemDraft } from "../tools/infrastructure/plan-state-store.js";
import { compareSessionEvents, type CanonicalSessionEvent } from "../events/session-event.js";
import {
  defineManagedAgentOrchestrationRequest,
  type ManagedAgentOrchestrationChildRequest,
  type ManagedAgentOrchestrationExpectedEvidence,
  type ManagedAgentOrchestrationRequest,
} from "../agents/managed-invocation/orchestration.js";
import type { ManagedAgentAccess } from "../agents/managed-invocation/index.js";
import {
  defineDeliberationLevelId,
  type DeliberationIntent,
} from "../agents/deliberation-policy.js";
import type { GoalRun } from "./goal-run.js";
import {
  MANAGED_ORCHESTRATION_ADOPTION_GATE,
  MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE,
  MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET,
  managedOrchestrationAdoptionReadinessContract,
  type WorkItem,
  type WorkItemManagedOrchestrationAdoptionReadiness,
  type WorkItemRoutingRecommendation,
  type WorkItemStore,
  type WorkItemUpsertInput,
} from "./work-item.js";

export interface ManagedAgentOrchestrationWorkItemMaterializationInput {
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly workItemStore: WorkItemStore;
  readonly goalRunId?: string;
  readonly workflowProfile?: string;
  readonly risk?: string;
  readonly assignedAgentProfile?: string;
  readonly routeId?: string;
  readonly access?: ManagedAgentAccess;
}

export interface ManagedAgentOrchestrationWorkItemMaterializationResult {
  readonly orchestrationId: string;
  readonly mode: ManagedAgentOrchestrationRequest["mode"];
  readonly workItemIds: readonly string[];
  readonly createdWorkItemIds: readonly string[];
  readonly reusedWorkItemIds: readonly string[];
  readonly workItems: readonly WorkItem[];
}

export interface WorkItemMaterialization {
  readonly id: string;
  readonly planId: string;
  readonly planHash: string;
  readonly approvalId: string;
  readonly goalRunId: string;
  readonly sourceWorkItemIds: readonly string[];
  readonly workItemIds: readonly string[];
  readonly createdWorkItemIds: readonly string[];
  readonly reusedWorkItemIds: readonly string[];
  readonly createdAt: string;
  readonly sequence: number;
}

export interface WorkItemMaterializationSnapshot {
  readonly materializations: readonly WorkItemMaterialization[];
  readonly updatedAt?: string;
  readonly sequence: number;
}

export interface WorkItemMaterializationInput {
  readonly plan: SessionPlan;
  readonly goalRun: GoalRun;
  readonly workItemStore: WorkItemStore;
  readonly now?: () => string;
}

export interface WorkItemMaterializationResult {
  readonly materialization: WorkItemMaterialization;
  readonly workItems: readonly WorkItem[];
}

export function materializeApprovedPlanWorkItems(
  input: WorkItemMaterializationInput,
): WorkItemMaterializationResult {
  assertPlanApproved(input.plan);
  assertGoalMatchesPlan(input.goalRun, input.plan);
  assertDependenciesValid(input.plan.proposedWorkItems);

  const timestamp = input.now?.() ?? new Date().toISOString();
  const sourceWorkItemIds = input.plan.proposedWorkItems.map((item) => item.id);
  const idBySource = new Map(sourceWorkItemIds.map((sourceId) => [
    sourceId,
    materializedWorkItemId(input.plan, input.goalRun, sourceId),
  ]));
  const workItems: WorkItem[] = [];
  const createdWorkItemIds: string[] = [];
  const reusedWorkItemIds: string[] = [];

  for (const draft of input.plan.proposedWorkItems) {
    const workItemInput = toWorkItemInput({
      draft,
      plan: input.plan,
      goalRun: input.goalRun,
      id: requireMappedId(idBySource, draft.id),
      idBySource,
    });
    const existing = input.workItemStore.get(workItemInput.id!);
    if (existing) {
      assertExistingMatches(existing, workItemInput);
      workItems.push(existing);
      reusedWorkItemIds.push(existing.id);
      continue;
    }
    const item = input.workItemStore.upsert(workItemInput);
    workItems.push(item);
    createdWorkItemIds.push(item.id);
  }

  const materialization: WorkItemMaterialization = {
    id: materializationId(input.plan, input.goalRun),
    planId: input.plan.id,
    planHash: input.plan.contentHash,
    approvalId: input.plan.approval!.approvalId,
    goalRunId: input.goalRun.id,
    sourceWorkItemIds,
    workItemIds: workItems.map((item) => item.id),
    createdWorkItemIds,
    reusedWorkItemIds,
    createdAt: timestamp,
    sequence: Math.max(0, ...workItems.map((item) => item.sequence)),
  };

  return { materialization, workItems };
}

export function materializeManagedAgentOrchestrationWorkItems(
  input: ManagedAgentOrchestrationWorkItemMaterializationInput,
): ManagedAgentOrchestrationWorkItemMaterializationResult {
  const request = defineManagedAgentOrchestrationRequest(input.orchestrationRequest);
  const workItems: WorkItem[] = [];
  const createdWorkItemIds: string[] = [];
  const reusedWorkItemIds: string[] = [];

  for (const child of request.childRequests) {
    const workItemInput = toManagedAgentOrchestrationWorkItemInput({
      request,
      child,
      goalRunId: input.goalRunId,
      workflowProfile: input.workflowProfile,
      risk: input.risk,
      assignedAgentProfile: input.assignedAgentProfile,
      routeId: input.routeId,
      access: input.access,
    });
    const existing = input.workItemStore.get(workItemInput.id!);
    if (existing) {
      assertExistingManagedOrchestrationWorkItemMatches(existing, workItemInput);
      workItems.push(existing);
      reusedWorkItemIds.push(existing.id);
      continue;
    }
    const item = input.workItemStore.upsert(workItemInput);
    workItems.push(item);
    createdWorkItemIds.push(item.id);
  }

  return {
    orchestrationId: request.orchestrationId,
    mode: request.mode,
    workItemIds: workItems.map((item) => item.id),
    createdWorkItemIds,
    reusedWorkItemIds,
    workItems,
  };
}

export function reconstructWorkItemMaterializationsFromSessionEvents(
  events: readonly CanonicalSessionEvent[],
): WorkItemMaterializationSnapshot {
  const materializations = new Map<string, WorkItemMaterialization>();
  let sequence = 0;
  for (const event of [...events].sort(compareSessionEvents)) {
    if (event.kind !== "work_items.materialized") {
      continue;
    }
    materializations.set(event.materialization.id, event.materialization);
    sequence = Math.max(sequence, event.materialization.sequence);
  }
  const ordered = [...materializations.values()].sort((left, right) => left.sequence - right.sequence);
  return {
    materializations: ordered,
    updatedAt: ordered.at(-1)?.createdAt,
    sequence,
  };
}

function assertPlanApproved(plan: SessionPlan): void {
  if (
    plan.status !== "ready_for_approval"
    || plan.approval?.status !== "approved"
    || plan.approval.contentHash !== plan.contentHash
    || plan.approval.planHash !== plan.contentHash
  ) {
    throw new Error(`Plan ${plan.id} is not approved for execution.`);
  }
}

function assertGoalMatchesPlan(goalRun: GoalRun, plan: SessionPlan): void {
  if (goalRun.source.kind !== "approved_plan" || goalRun.source.planId !== plan.id) {
    throw new Error(`Goal ${goalRun.id} is not bound to approved plan ${plan.id}.`);
  }
  if (goalRun.source.planHash !== plan.contentHash) {
    throw new Error(`Goal ${goalRun.id} is not bound to approved plan hash ${plan.contentHash}.`);
  }
}

function toWorkItemInput(input: {
  readonly draft: SessionPlanWorkItemDraft;
  readonly plan: SessionPlan;
  readonly goalRun: GoalRun;
  readonly id: string;
  readonly idBySource: ReadonlyMap<string, string>;
}): WorkItemUpsertInput {
  return {
    id: input.id,
    summary: input.draft.summary,
    status: "pending",
    workflowProfile: input.draft.workflowProfile,
    risk: input.draft.risk,
    triggers: [input.draft.workflowProfile, input.draft.risk],
    assignedAgentProfile: input.goalRun.routePolicy.managedAgentProfile
      ?? input.plan.managedAgentDelegationCandidates[0],
    routeId: input.goalRun.routePolicy.preferredRouteId,
    authority: input.goalRun.authorityEnvelope.maximumAuthority,
    expectedEvidence: input.draft.expectedEvidence,
    verificationGates: input.draft.verificationGates,
    dependencies: input.draft.dependencies.map((dependency) => requireMappedId(input.idBySource, dependency)),
    planId: input.plan.id,
    planHash: input.plan.contentHash,
    goalRunId: input.goalRun.id,
    sourceWorkItemId: input.draft.id,
    routingRecommendation: routingRecommendation(input.draft, input.plan, input.goalRun),
    workClassification: input.draft.workClassification,
    workClassificationProvenance: input.draft.workClassificationProvenance,
  };
}

function toManagedAgentOrchestrationWorkItemInput(input: {
  readonly request: ManagedAgentOrchestrationRequest;
  readonly child: ManagedAgentOrchestrationChildRequest;
  readonly goalRunId?: string;
  readonly workflowProfile?: string;
  readonly risk?: string;
  readonly assignedAgentProfile?: string;
  readonly routeId?: string;
  readonly access?: ManagedAgentAccess;
}): WorkItemUpsertInput {
  const mergeEvidence = `managed-orchestration:merge:${input.request.mergePolicy.mode}`;
  const adoptionEvidence = input.request.mergePolicy.adoptionRequired
    ? [MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE]
    : [];
  const readiness = managedOrchestrationAdoptionReadiness(input);
  return {
    id: `${input.child.childId}:work-item`,
    summary: input.child.task,
    status: "pending",
    workflowProfile: input.workflowProfile ?? "managed-agent-change",
    risk: input.risk ?? "high",
    triggers: [
      input.workflowProfile ?? "managed-agent-change",
      input.risk ?? "high",
      input.request.mode,
      input.request.mergePolicy.mode,
    ],
    assignedAgentProfile: input.assignedAgentProfile,
    routeId: input.routeId,
    access: input.access,
    expectedEvidence: uniqueStrings([
      ...input.child.expectedEvidence
        .filter((evidence) => evidence.required)
        .map(orchestrationEvidenceKey),
      mergeEvidence,
      ...(readiness?.evidence ?? []),
      ...adoptionEvidence,
    ]),
    verificationGates: uniqueStrings([
      "managed orchestration child handoff",
      `managed orchestration merge policy: ${input.request.mergePolicy.mode}`,
      ...(readiness?.verificationGates ?? []),
      ...(input.request.mergePolicy.adoptionRequired && !readiness ? [MANAGED_ORCHESTRATION_ADOPTION_GATE] : []),
    ]),
    ...(input.goalRunId ? { goalRunId: input.goalRunId } : {}),
    sourceWorkItemId: input.child.childId,
    managedOrchestration: {
      orchestrationId: input.request.orchestrationId,
      mode: input.request.mode,
      childId: input.child.childId,
      ordinal: input.child.ordinal,
      roleIntent: input.child.roleIntent,
      expectedEvidence: input.child.expectedEvidence,
      isolation: input.request.isolation,
      mergePolicy: input.request.mergePolicy,
      adoptionGate: {
        required: input.request.mergePolicy.adoptionRequired,
        target: MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET,
        reason: input.request.mergePolicy.adoptionRequired
          ? `Managed ${input.request.mode} orchestration requires Slice 6 adoption before closeout.`
          : `Managed ${input.request.mode} orchestration does not require automatic parent adoption.`,
        ...(readiness ? { readiness } : {}),
      },
    },
  };
}

function managedOrchestrationAdoptionReadiness(input: {
  readonly request: ManagedAgentOrchestrationRequest;
}): WorkItemManagedOrchestrationAdoptionReadiness | undefined {
  if (
    input.request.mergePolicy.adoptionRequired !== true
    || input.request.mergePolicy.adoptionReadinessRequired !== true
  ) {
    return undefined;
  }
  return managedOrchestrationAdoptionReadinessContract();
}

function orchestrationEvidenceKey(evidence: ManagedAgentOrchestrationExpectedEvidence): string {
  return `managed-orchestration:${evidence.kind}`;
}

function routingRecommendation(
  draft: SessionPlanWorkItemDraft,
  plan: SessionPlan,
  goalRun: GoalRun,
): WorkItemRoutingRecommendation {
  return {
    ...(goalRun.routePolicy.preferredRouteId ? { routeId: goalRun.routePolicy.preferredRouteId } : {}),
    ...(goalRun.routePolicy.managedAgentProfile
      ? { agentProfile: goalRun.routePolicy.managedAgentProfile }
      : plan.managedAgentDelegationCandidates[0]
        ? { agentProfile: plan.managedAgentDelegationCandidates[0] }
        : {}),
    deliberationIntent: recommendedDeliberationIntent(draft),
    modelTaskSuitability: `${draft.workflowProfile}:${draft.risk}`,
    rationale: `Derived from plan workflow profile ${draft.workflowProfile} and risk ${draft.risk}.`,
  };
}

function recommendedDeliberationIntent(draft: SessionPlanWorkItemDraft): DeliberationIntent {
  if (
    draft.risk === "high"
    || draft.risk === "critical"
    || draft.workflowProfile === "architecture-change"
    || draft.workflowProfile === "managed-agent-change"
    || draft.workflowProfile === "verification-heavy"
    || draft.workflowProfile === "formal-proof-candidate"
  ) {
    return { mode: "fixed", preferredLevel: defineDeliberationLevelId("high"), onUnsupported: "deny" };
  }
  if (draft.workflowProfile === "small-fix" && draft.risk === "low") {
    return { mode: "fixed", preferredLevel: defineDeliberationLevelId("low"), onUnsupported: "deny" };
  }
  return { mode: "fixed", preferredLevel: defineDeliberationLevelId("medium"), onUnsupported: "deny" };
}

function assertExistingMatches(existing: WorkItem, input: WorkItemUpsertInput): void {
  const mismatches = [
    existing.summary !== input.summary ? "summary" : undefined,
    existing.workflowProfile !== input.workflowProfile ? "workflowProfile" : undefined,
    existing.risk !== input.risk ? "risk" : undefined,
    existing.planId !== input.planId ? "planId" : undefined,
    existing.planHash !== input.planHash ? "planHash" : undefined,
    existing.goalRunId !== input.goalRunId ? "goalRunId" : undefined,
    existing.sourceWorkItemId !== input.sourceWorkItemId ? "sourceWorkItemId" : undefined,
    existing.routeId !== input.routeId ? "routeId" : undefined,
    existing.assignedAgentProfile !== input.assignedAgentProfile ? "assignedAgentProfile" : undefined,
    existing.authority !== input.authority ? "authority" : undefined,
    !sameStrings(existing.triggers, input.triggers) ? "triggers" : undefined,
    !sameStrings(existing.expectedEvidence, input.expectedEvidence) ? "expectedEvidence" : undefined,
    !sameStrings(existing.verificationGates, input.verificationGates) ? "verificationGates" : undefined,
    !sameStrings(existing.dependencies, input.dependencies ?? []) ? "dependencies" : undefined,
    !sameRoutingRecommendation(existing.routingRecommendation, input.routingRecommendation)
      ? "routingRecommendation"
      : undefined,
    !sameJson(existing.workClassification, input.workClassification) ? "workClassification" : undefined,
    !sameJson(existing.workClassificationProvenance, input.workClassificationProvenance)
      ? "workClassificationProvenance"
      : undefined,
  ].filter((value): value is string => Boolean(value));
  if (mismatches.length > 0) {
    throw new Error(`Existing work item ${existing.id} conflicts with approved plan materialization: ${mismatches.join(", ")}.`);
  }
}

function assertExistingManagedOrchestrationWorkItemMatches(existing: WorkItem, input: WorkItemUpsertInput): void {
  const mismatches = [
    existing.summary !== input.summary ? "summary" : undefined,
    existing.workflowProfile !== input.workflowProfile ? "workflowProfile" : undefined,
    existing.risk !== input.risk ? "risk" : undefined,
    existing.goalRunId !== input.goalRunId ? "goalRunId" : undefined,
    existing.sourceWorkItemId !== input.sourceWorkItemId ? "sourceWorkItemId" : undefined,
    existing.routeId !== input.routeId ? "routeId" : undefined,
    existing.assignedAgentProfile !== input.assignedAgentProfile ? "assignedAgentProfile" : undefined,
    existing.access !== input.access ? "access" : undefined,
    !sameStrings(existing.triggers, input.triggers) ? "triggers" : undefined,
    !sameStrings(existing.expectedEvidence, input.expectedEvidence) ? "expectedEvidence" : undefined,
    !sameStrings(existing.verificationGates, input.verificationGates) ? "verificationGates" : undefined,
    !sameJson(existing.managedOrchestration, input.managedOrchestration) ? "managedOrchestration" : undefined,
  ].filter((value): value is string => Boolean(value));
  if (mismatches.length > 0) {
    throw new Error(`Existing work item ${existing.id} conflicts with managed orchestration materialization: ${mismatches.join(", ")}.`);
  }
}

function assertDependenciesValid(workItems: readonly SessionPlanWorkItemDraft[]): void {
  const ids = new Set(workItems.map((item) => item.id));
  for (const item of workItems) {
    for (const dependency of item.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(`Work item ${item.id} depends on unknown proposed work item ${dependency}.`);
      }
    }
  }
  const cycle = findDependencyCycle(workItems);
  if (cycle) {
    throw new Error(`Work item dependency cycle detected: ${cycle.join(" -> ")}.`);
  }
}

function findDependencyCycle(workItems: readonly SessionPlanWorkItemDraft[]): readonly string[] | undefined {
  const byId = new Map(workItems.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): readonly string[] | undefined => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) {
      return undefined;
    }
    const item = byId.get(id);
    if (!item) {
      return undefined;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependency of item.dependencies) {
      const cycle = visit(dependency);
      if (cycle) {
        return cycle;
      }
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return undefined;
  };

  for (const item of workItems) {
    const cycle = visit(item.id);
    if (cycle) {
      return cycle;
    }
  }
  return undefined;
}

function materializationId(plan: SessionPlan, goalRun: GoalRun): string {
  return `mat_${stableToken(goalRun.id)}_${stableToken(plan.id)}_${plan.contentHash.slice(0, 12)}`;
}

function materializedWorkItemId(plan: SessionPlan, goalRun: GoalRun, sourceWorkItemId: string): string {
  return `wi_${stableToken(goalRun.id)}_${stableToken(plan.id)}_${plan.contentHash.slice(0, 12)}_${stableToken(sourceWorkItemId)}`;
}

function stableToken(value: string): string {
  const token = value.trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  if (!token) {
    throw new Error("Stable id token is required.");
  }
  return token;
}

function requireMappedId(idBySource: ReadonlyMap<string, string>, sourceId: string): string {
  const id = idBySource.get(sourceId);
  if (!id) {
    throw new Error(`Missing materialized id for source work item ${sourceId}.`);
  }
  return id;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function sameRoutingRecommendation(
  left: WorkItemRoutingRecommendation | undefined,
  right: WorkItemRoutingRecommendation | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.routeId === right.routeId
    && left.agentProfile === right.agentProfile
    && JSON.stringify(left.deliberationIntent) === JSON.stringify(right.deliberationIntent)
    && left.modelTaskSuitability === right.modelTaskSuitability
    && left.rationale === right.rationale;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
