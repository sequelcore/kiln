import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";
import type { ConstitutionSnapshot } from "./specification-state-store.js";
import { createHash } from "node:crypto";

export type WorkflowProfile =
  | "small-fix"
  | "bug-diagnosis"
  | "architecture-change"
  | "ui-change"
  | "managed-agent-change"
  | "config-change"
  | "verification-heavy"
  | "formal-proof-candidate";

export type PlanRiskClassification = "low" | "medium" | "high" | "critical";
export type WorkGovernancePosture = "direct" | "orchestrate" | "delegate";

export type PlanValidationCode =
  | "missing_objective"
  | "missing_non_goals"
  | "missing_operator_decisions"
  | "missing_expected_evidence"
  | "missing_verification_gates"
  | "missing_work_items"
  | "missing_source_specification"
  | "missing_constitution_snapshot"
  | "invalid_workflow_profile"
  | "invalid_risk_classification"
  | "high_risk_approval_boundaries"
  | "high_risk_rollback_notes"
  | "high_risk_residual_risks"
  | "work_item_missing_summary"
  | "work_item_missing_expected_evidence"
  | "work_item_missing_verification_gates";

export interface PlanValidationIssue {
  readonly code: PlanValidationCode;
  readonly field: string;
  readonly message: string;
  readonly blocking: boolean;
}

export interface SessionPlanWorkItemDraft {
  readonly id: string;
  readonly summary: string;
  readonly workflowProfile: WorkflowProfile;
  readonly risk: PlanRiskClassification;
  readonly expectedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly dependencies: readonly string[];
}

export interface WorkGovernanceRecommendation {
  readonly posture: WorkGovernancePosture;
  readonly rationale: string;
  readonly workflowProfile: WorkflowProfile;
}

export interface SessionPlan {
  readonly id: string;
  readonly objective: string;
  readonly nonGoals: readonly string[];
  readonly operatorDecisionsRequired: readonly string[];
  readonly assumptions: readonly string[];
  readonly affectedSurfaces: readonly string[];
  readonly riskClassification: PlanRiskClassification;
  readonly workGovernanceRecommendation: WorkGovernanceRecommendation;
  readonly proposedWorkItems: readonly SessionPlanWorkItemDraft[];
  readonly expectedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly managedAgentDelegationCandidates: readonly string[];
  readonly approvalBoundaries: readonly string[];
  readonly rollbackNotes: string;
  readonly residualRisks: readonly string[];
  readonly sourceSpecificationId: string;
  readonly clarificationRecordIds: readonly string[];
  readonly constitutionSnapshot: ConstitutionSnapshot;
  readonly contentHash: string;
  readonly approval?: PlanApprovalState;
  readonly status: "draft" | "ready_for_approval";
  readonly issues: readonly PlanValidationIssue[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sequence: number;
}

export interface PlanApprovalState {
  readonly status: "approved" | "rejected" | "superseded";
  readonly planId: string;
  readonly planHash: string;
  readonly contentHash: string;
  readonly approvalId: string;
  readonly sequence: number;
  readonly decidedAt: string;
  readonly approvedAt?: string;
  readonly rejectionReason?: string;
  readonly rejectedAt?: string;
  readonly supersededAt?: string;
  readonly supersededByPlanHash?: string;
}

export type PlanDecisionFailureCode =
  | "no_plans"
  | "plan_not_found"
  | "plan_not_ready_for_approval";

export type PlanReadinessFailureCode =
  | "no_plans"
  | "plan_not_found";

export type PlanReadinessBlockedCode =
  | "plan_not_ready_for_approval"
  | "approval_missing"
  | "approval_not_approved"
  | "approval_hash_mismatch";

export type PlanApproveResult =
  | {
    readonly success: true;
    readonly code: "approved";
    readonly planId: string;
    readonly approval: PlanApprovalState;
  }
  | {
    readonly success: false;
    readonly code: PlanDecisionFailureCode;
    readonly planId?: string;
    readonly message: string;
  };

export type PlanRejectResult =
  | {
    readonly success: true;
    readonly code: "rejected";
    readonly planId: string;
    readonly approval: PlanApprovalState;
  }
  | {
    readonly success: false;
    readonly code: PlanDecisionFailureCode;
    readonly planId?: string;
    readonly message: string;
  };

export type PlanExecutionReadinessResult =
  | {
    readonly success: true;
    readonly ready: true;
    readonly planId: string;
    readonly approval: PlanApprovalState;
  }
  | {
    readonly success: true;
    readonly ready: false;
    readonly planId: string;
    readonly code: PlanReadinessBlockedCode;
    readonly message: string;
    readonly approval?: PlanApprovalState;
  }
  | {
    readonly success: false;
    readonly code: PlanReadinessFailureCode;
    readonly planId?: string;
    readonly message: string;
  };

export interface PlanStateSnapshot {
  readonly plans: readonly SessionPlan[];
  readonly sequence: number;
}

export interface PlanStateStoreOptions {
  readonly now?: () => number;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

export interface PlanSubmissionInput {
  readonly planId?: string;
  readonly objective: string;
  readonly nonGoals: readonly string[];
  readonly operatorDecisionsRequired: readonly string[];
  readonly assumptions: readonly string[];
  readonly affectedSurfaces: readonly string[];
  readonly riskClassification: PlanRiskClassification;
  readonly workGovernanceRecommendation: WorkGovernanceRecommendation;
  readonly proposedWorkItems: readonly SessionPlanWorkItemDraft[];
  readonly expectedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly managedAgentDelegationCandidates: readonly string[];
  readonly approvalBoundaries: readonly string[];
  readonly rollbackNotes: string;
  readonly residualRisks: readonly string[];
  readonly sourceSpecificationId: string;
  readonly clarificationRecordIds: readonly string[];
  readonly constitutionSnapshot: ConstitutionSnapshot;
}

const WORKFLOW_PROFILES: readonly WorkflowProfile[] = [
  "small-fix",
  "bug-diagnosis",
  "architecture-change",
  "ui-change",
  "managed-agent-change",
  "config-change",
  "verification-heavy",
  "formal-proof-candidate",
];

const RISK_LEVELS: readonly PlanRiskClassification[] = ["low", "medium", "high", "critical"];
const HIGH_CONTROL_PROFILES = new Set<WorkflowProfile>([
  "architecture-change",
  "managed-agent-change",
  "verification-heavy",
  "formal-proof-candidate",
]);

export class PlanStateStore {
  private readonly now: () => number;
  private resourceNotifications: ToolResourceChangeNotifier | undefined;
  private readonly plans = new Map<string, SessionPlan>();
  private nextPlanId = 1;
  private nextApprovalId = 1;
  private sequence = 0;

  constructor(options: PlanStateStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.resourceNotifications = options.resourceNotifications;
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.resourceNotifications = notifier;
  }

  submitPlan(input: PlanSubmissionInput): SessionPlan {
    const normalized = normalizePlanInput(input);
    const id = normalized.planId ?? this.allocatePlanId();
    const previous = this.plans.get(id);
    const timestamp = this.timestamp();
    const issues = validatePlanInput(normalized);
    const status = issues.some((issue) => issue.blocking) ? "draft" : "ready_for_approval";
    const contentHash = computePlanContentHash(normalized);
    this.sequence += 1;
    let approval = previous?.approval;
    if (approval && approval.contentHash !== contentHash) {
      approval = {
        ...approval,
        status: "superseded",
        sequence: this.sequence,
        supersededAt: timestamp,
        supersededByPlanHash: contentHash,
      };
    }
    const plan: SessionPlan = {
      id,
      objective: normalized.objective,
      nonGoals: normalized.nonGoals,
      operatorDecisionsRequired: normalized.operatorDecisionsRequired,
      assumptions: normalized.assumptions,
      affectedSurfaces: normalized.affectedSurfaces,
      riskClassification: normalized.riskClassification,
      workGovernanceRecommendation: {
        posture: normalized.workGovernanceRecommendation.posture,
        rationale: normalized.workGovernanceRecommendation.rationale,
        workflowProfile: normalized.workGovernanceRecommendation.workflowProfile,
      },
      proposedWorkItems: normalized.proposedWorkItems,
      expectedEvidence: normalized.expectedEvidence,
      verificationGates: normalized.verificationGates,
      managedAgentDelegationCandidates: normalized.managedAgentDelegationCandidates,
      approvalBoundaries: normalized.approvalBoundaries,
      rollbackNotes: normalized.rollbackNotes,
      residualRisks: normalized.residualRisks,
      sourceSpecificationId: normalized.sourceSpecificationId,
      clarificationRecordIds: normalized.clarificationRecordIds,
      constitutionSnapshot: {
        instructionProfileHash: normalized.constitutionSnapshot.instructionProfileHash,
        instructionProfileIds: normalized.constitutionSnapshot.instructionProfileIds,
      },
      contentHash,
      approval,
      status,
      issues,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      sequence: this.sequence,
    };
    this.plans.set(id, plan);
    this.notifyPlanResources(id);
    return plan;
  }

  approvePlan(planId?: string): PlanApproveResult {
    const target = this.resolvePlan(planId);
    if (!target.success) {
      return target;
    }
    if (target.plan.status !== "ready_for_approval") {
      return {
        success: false,
        code: "plan_not_ready_for_approval",
        planId: target.plan.id,
        message: "Only ready_for_approval plans can be approved.",
      };
    }

    this.sequence += 1;
    const timestamp = this.timestamp();
    const approval: PlanApprovalState = {
      status: "approved",
      planId: target.plan.id,
      planHash: target.plan.contentHash,
      contentHash: target.plan.contentHash,
      approvalId: this.allocateApprovalId(),
      sequence: this.sequence,
      decidedAt: timestamp,
      approvedAt: timestamp,
    };
    const updated: SessionPlan = {
      ...target.plan,
      approval,
      updatedAt: timestamp,
      sequence: this.sequence,
    };
    this.plans.set(updated.id, updated);
    this.notifyPlanResources(updated.id);
    return {
      success: true,
      code: "approved",
      planId: updated.id,
      approval,
    };
  }

  rejectPlan(planId?: string, reason?: string): PlanRejectResult {
    const target = this.resolvePlan(planId);
    if (!target.success) {
      return target;
    }
    if (target.plan.status !== "ready_for_approval") {
      return {
        success: false,
        code: "plan_not_ready_for_approval",
        planId: target.plan.id,
        message: "Only ready_for_approval plans can be rejected.",
      };
    }

    this.sequence += 1;
    const timestamp = this.timestamp();
    const normalizedReason = reason?.trim();
    const approval: PlanApprovalState = {
      status: "rejected",
      planId: target.plan.id,
      planHash: target.plan.contentHash,
      contentHash: target.plan.contentHash,
      approvalId: this.allocateApprovalId(),
      sequence: this.sequence,
      decidedAt: timestamp,
      ...(normalizedReason ? { rejectionReason: normalizedReason } : {}),
      rejectedAt: timestamp,
    };
    const updated: SessionPlan = {
      ...target.plan,
      approval,
      updatedAt: timestamp,
      sequence: this.sequence,
    };
    this.plans.set(updated.id, updated);
    this.notifyPlanResources(updated.id);
    return {
      success: true,
      code: "rejected",
      planId: updated.id,
      approval,
    };
  }

  executionReadiness(planId?: string): PlanExecutionReadinessResult {
    const target = this.resolvePlan(planId);
    if (!target.success) {
      return target;
    }
    const plan = target.plan;
    if (plan.status !== "ready_for_approval") {
      return {
        success: true,
        ready: false,
        planId: plan.id,
        code: "plan_not_ready_for_approval",
        message: "Plan is not ready_for_approval.",
      };
    }
    if (!plan.approval) {
      return {
        success: true,
        ready: false,
        planId: plan.id,
        code: "approval_missing",
        message: "Plan has no approval record.",
      };
    }
    if (plan.approval.contentHash !== plan.contentHash) {
      return {
        success: true,
        ready: false,
        planId: plan.id,
        code: "approval_hash_mismatch",
        message: "Plan approval hash does not match current plan content.",
        approval: plan.approval,
      };
    }
    if (plan.approval.status !== "approved") {
      return {
        success: true,
        ready: false,
        planId: plan.id,
        code: "approval_not_approved",
        message: `Plan approval status is '${plan.approval.status}'.`,
        approval: plan.approval,
      };
    }
    return {
      success: true,
      ready: true,
      planId: plan.id,
      approval: plan.approval,
    };
  }

  listPlans(): readonly SessionPlan[] {
    return Array.from(this.plans.values()).sort((left, right) => left.sequence - right.sequence);
  }

  getPlan(id: string): SessionPlan | undefined {
    return this.plans.get(id);
  }

  latestPlan(): SessionPlan | undefined {
    return this.listPlans().at(-1);
  }

  snapshot(): PlanStateSnapshot {
    return {
      plans: this.listPlans(),
      sequence: this.sequence,
    };
  }

  private allocatePlanId(): string {
    let id = `plan_${this.nextPlanId++}`;
    while (this.plans.has(id)) {
      id = `plan_${this.nextPlanId++}`;
    }
    return id;
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private allocateApprovalId(): string {
    return `approval_${this.nextApprovalId++}`;
  }

  private notifyPlanResources(planId: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/plans");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/plans/${planId}`);
  }

  private resolvePlan(planId?: string):
    | { readonly success: true; readonly plan: SessionPlan }
    | { readonly success: false; readonly code: "no_plans"; readonly message: string }
    | { readonly success: false; readonly code: "plan_not_found"; readonly planId: string; readonly message: string } {
    if (planId) {
      const plan = this.plans.get(planId);
      if (!plan) {
        return {
          success: false,
          code: "plan_not_found",
          planId,
          message: `Plan '${planId}' was not found.`,
        };
      }
      return { success: true, plan };
    }
    const latest = this.latestPlan();
    if (!latest) {
      return {
        success: false,
        code: "no_plans",
        message: "No plans available in session state.",
      };
    }
    return { success: true, plan: latest };
  }
}

function normalizePlanInput(input: PlanSubmissionInput): PlanSubmissionInput {
  const planId = input.planId?.trim();
  return {
    ...(planId ? { planId } : {}),
    objective: input.objective.trim(),
    nonGoals: uniqueText(input.nonGoals),
    operatorDecisionsRequired: uniqueText(input.operatorDecisionsRequired),
    assumptions: uniqueText(input.assumptions),
    affectedSurfaces: uniqueText(input.affectedSurfaces),
    riskClassification: input.riskClassification,
    workGovernanceRecommendation: {
      posture: input.workGovernanceRecommendation.posture,
      rationale: input.workGovernanceRecommendation.rationale.trim(),
      workflowProfile: input.workGovernanceRecommendation.workflowProfile,
    },
    proposedWorkItems: uniqueWorkItems(input.proposedWorkItems),
    expectedEvidence: uniqueText(input.expectedEvidence),
    verificationGates: uniqueText(input.verificationGates),
    managedAgentDelegationCandidates: uniqueText(input.managedAgentDelegationCandidates),
    approvalBoundaries: uniqueText(input.approvalBoundaries),
    rollbackNotes: input.rollbackNotes.trim(),
    residualRisks: uniqueText(input.residualRisks),
    sourceSpecificationId: input.sourceSpecificationId.trim(),
    clarificationRecordIds: uniqueText(input.clarificationRecordIds),
    constitutionSnapshot: {
      instructionProfileHash: input.constitutionSnapshot.instructionProfileHash.trim(),
      instructionProfileIds: uniqueText(input.constitutionSnapshot.instructionProfileIds),
    },
  };
}

function computePlanContentHash(input: PlanSubmissionInput): string {
  const canonical = stableJsonStringify({
    objective: input.objective,
    nonGoals: input.nonGoals,
    operatorDecisionsRequired: input.operatorDecisionsRequired,
    assumptions: input.assumptions,
    affectedSurfaces: input.affectedSurfaces,
    riskClassification: input.riskClassification,
    workGovernanceRecommendation: input.workGovernanceRecommendation,
    proposedWorkItems: input.proposedWorkItems,
    expectedEvidence: input.expectedEvidence,
    verificationGates: input.verificationGates,
    managedAgentDelegationCandidates: input.managedAgentDelegationCandidates,
    approvalBoundaries: input.approvalBoundaries,
    rollbackNotes: input.rollbackNotes,
    residualRisks: input.residualRisks,
    sourceSpecificationId: input.sourceSpecificationId,
    clarificationRecordIds: input.clarificationRecordIds,
    constitutionSnapshot: input.constitutionSnapshot,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value));
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableSortValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = stableSortValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function validatePlanInput(input: PlanSubmissionInput): readonly PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const objective = input.objective.trim();
  const nonGoals = uniqueText(input.nonGoals);
  const operatorDecisions = uniqueText(input.operatorDecisionsRequired);
  const expectedEvidence = uniqueText(input.expectedEvidence);
  const verificationGates = uniqueText(input.verificationGates);
  const proposedWorkItems = uniqueWorkItems(input.proposedWorkItems);
  const sourceSpecificationId = input.sourceSpecificationId.trim();
  const constitutionHash = input.constitutionSnapshot.instructionProfileHash.trim();
  const workflowProfile = input.workGovernanceRecommendation.workflowProfile;
  const riskClassification = input.riskClassification;

  if (!objective) {
    issues.push({
      code: "missing_objective",
      field: "objective",
      message: "Plan objective is required.",
      blocking: true,
    });
  }
  if (nonGoals.length === 0) {
    issues.push({
      code: "missing_non_goals",
      field: "nonGoals",
      message: "At least one non-goal is required.",
      blocking: true,
    });
  }
  if (!WORKFLOW_PROFILES.includes(workflowProfile)) {
    issues.push({
      code: "invalid_workflow_profile",
      field: "workGovernanceRecommendation.workflowProfile",
      message: `Unknown workflow profile '${workflowProfile}'.`,
      blocking: true,
    });
  }
  if (!RISK_LEVELS.includes(riskClassification)) {
    issues.push({
      code: "invalid_risk_classification",
      field: "riskClassification",
      message: `Unknown risk classification '${riskClassification}'.`,
      blocking: true,
    });
  }
  if (expectedEvidence.length === 0) {
    issues.push({
      code: "missing_expected_evidence",
      field: "expectedEvidence",
      message: "Expected evidence is required for governed planning.",
      blocking: true,
    });
  }
  if (verificationGates.length === 0) {
    issues.push({
      code: "missing_verification_gates",
      field: "verificationGates",
      message: "At least one verification gate is required.",
      blocking: true,
    });
  }
  if (proposedWorkItems.length === 0) {
    issues.push({
      code: "missing_work_items",
      field: "proposedWorkItems",
      message: "At least one proposed work item is required.",
      blocking: true,
    });
  }
  if (!sourceSpecificationId) {
    issues.push({
      code: "missing_source_specification",
      field: "sourceSpecificationId",
      message: "sourceSpecificationId is required.",
      blocking: true,
    });
  }
  if (!constitutionHash) {
    issues.push({
      code: "missing_constitution_snapshot",
      field: "constitutionSnapshot.instructionProfileHash",
      message: "constitutionSnapshot.instructionProfileHash is required.",
      blocking: true,
    });
  }

  const highControlPlan = riskClassification === "high"
    || riskClassification === "critical"
    || HIGH_CONTROL_PROFILES.has(workflowProfile);
  if (highControlPlan && operatorDecisions.length === 0) {
    issues.push({
      code: "missing_operator_decisions",
      field: "operatorDecisionsRequired",
      message: "High-control plans require explicit operator decisions.",
      blocking: true,
    });
  }
  if (highControlPlan && uniqueText(input.approvalBoundaries).length === 0) {
    issues.push({
      code: "high_risk_approval_boundaries",
      field: "approvalBoundaries",
      message: "High-control plans require approval boundaries.",
      blocking: true,
    });
  }
  if (highControlPlan && input.rollbackNotes.trim().length === 0) {
    issues.push({
      code: "high_risk_rollback_notes",
      field: "rollbackNotes",
      message: "High-control plans require rollback or recovery notes.",
      blocking: true,
    });
  }
  if (highControlPlan && uniqueText(input.residualRisks).length === 0) {
    issues.push({
      code: "high_risk_residual_risks",
      field: "residualRisks",
      message: "High-control plans require residual risk notes.",
      blocking: true,
    });
  }

  for (const workItem of proposedWorkItems) {
    if (workItem.summary.trim().length === 0) {
      issues.push({
        code: "work_item_missing_summary",
        field: `proposedWorkItems.${workItem.id}.summary`,
        message: `Work item '${workItem.id}' requires summary.`,
        blocking: true,
      });
    }
    if (workItem.expectedEvidence.length === 0) {
      issues.push({
        code: "work_item_missing_expected_evidence",
        field: `proposedWorkItems.${workItem.id}.expectedEvidence`,
        message: `Work item '${workItem.id}' requires expected evidence.`,
        blocking: true,
      });
    }
    if (workItem.verificationGates.length === 0) {
      issues.push({
        code: "work_item_missing_verification_gates",
        field: `proposedWorkItems.${workItem.id}.verificationGates`,
        message: `Work item '${workItem.id}' requires verification gates.`,
        blocking: true,
      });
    }
  }

  return issues;
}

function uniqueText(values: readonly string[]): readonly string[] {
  return Array.from(
    new Set(values
      .map((value) => value.trim())
      .filter((value) => value.length > 0)),
  );
}

function uniqueWorkItems(values: readonly SessionPlanWorkItemDraft[]): readonly SessionPlanWorkItemDraft[] {
  const seen = new Set<string>();
  const normalized: SessionPlanWorkItemDraft[] = [];
  for (const candidate of values) {
    const id = candidate.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      summary: candidate.summary.trim(),
      workflowProfile: candidate.workflowProfile,
      risk: candidate.risk,
      expectedEvidence: uniqueText(candidate.expectedEvidence),
      verificationGates: uniqueText(candidate.verificationGates),
      dependencies: uniqueText(candidate.dependencies),
    });
  }
  return normalized;
}
