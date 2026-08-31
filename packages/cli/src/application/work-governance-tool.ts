import type {
  ActionEffectEnvelope,
  DevTool,
  ManagedInvocationExecutionProof,
  ToolInput,
  ToolResult,
  WorkItem,
  WorkItemExecutionAttempt,
  WorkItemExecutionFailureReason,
  WorkItemPauseRequirement,
  WorkItemPauseRequirementKind,
  WorkItemPauseRequirementStatus,
  WorkItemStatus,
  WorkClassificationInput,
  WorkClassificationProvenanceInput,
  VerificationGateResult,
  BoundedWorkCandidateEvidence,
  BoundedWorkCandidateIdentity,
  BoundedWorkCloseoutDecision,
  BoundedWorkAssuranceEvaluation,
} from "@kilnai/core";
import {
  FORMAL_VERIFICATION_FINISH_TRANSPORT,
  OPERATOR_ADOPTION_DECISION_TRANSPORT,
  type DevToolExecutionContext,
  type FormalVerificationFinishTransportEnvelope,
} from "@kilnai/core/tools";
import {
  adoptBoundedWorkContractRevision,
  completeGoalExecution,
  failGoalExecutionAttempt,
  finishGoalExecutionAttempt,
  goalToolMetadata,
  GoalRunStore,
  isCanonicalArtifactContentUri,
  isKilnWorkGovernanceEvidence,
  isTerminalGoalStatus,
  isTerminalWorkItemExecutionAttemptStatus,
  KILN_WORK_GOVERNANCE_EVIDENCE,
  MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET,
  selectNextGoalExecutionStep,
  startGoalExecutionAttempt,
  WORK_ITEM_PAUSE_REQUIREMENT_KINDS,
  WORK_ITEM_PAUSE_REQUIREMENT_STATUSES,
  WORK_CLASSIFICATION_EVIDENCE_SCOPES,
  WorkItemStore,
  workItemToolMetadata,
} from "@kilnai/core";
import type {
  GoalRun,
  GoalRunAuthorityLevel,
  GoalRunEscalationPolicy,
  GoalRunEvidenceRequirement,
  WorkItemUpsertInput,
} from "@kilnai/core";
import type {
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceEvidence,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";
import { assessWorkGovernance } from "./work-governance-policy.js";
import {
  chooseWorkflowProfile,
  evidenceMatrixForWorkflowProfile,
  findWorkflowProfile,
  requiredEvidenceForWorkflowProfile,
  verificationGatesForWorkflowProfile,
  WORK_GOVERNANCE_WORKFLOW_PROFILES,
} from "./work-governance-workflows.js";
import {
  executionAttemptToolOutputProjection,
  goalToolOutputProjection,
  workItemToolOutputProjection,
} from "./work-governance-tool-projections.js";
import {
  hasOwn,
  readText,
  readTextArray,
  requireInputRecord,
  uniqueText,
} from "./work-governance-tool-input.js";
import {
  buildManagedInvocationRequest,
  MANAGED_INVOCATION_AUTHORITIES,
  MANAGED_INVOCATION_ACCESS,
  readManagedInvocationAccess,
  validatePhaseRouteContract,
  validateVisualReferenceEvidence,
  VISUAL_REFERENCE_PHASE_ROUTE,
  VISUAL_REFERENCE_PHASE_ROUTE_PLACEHOLDER,
} from "./work-governance-managed-invocation.js";
import {
  assertBoundedWorkPolicyCeiling,
  boundedWorkContractSchema,
  readBoundedWorkContract,
  readBoundedWorkContractAuthority,
} from "./bounded-work-contract-tool-input.js";
import { readFormalVerificationFinishTransport } from "./verification/formal/formal-verification-finish-transport.js";

const TRIGGERS: readonly KilnWorkGovernanceTrigger[] = [
  "architecture",
  "security",
  "ui",
  "runtime",
  "provider-routing",
  "managed-agents",
  "config",
  "cross-surface",
  "long-running",
  "verification-heavy",
  "formal-proof-candidate",
];

const RISKS: readonly KilnWorkGovernanceRisk[] = ["low", "medium", "high"];

const EVIDENCE: readonly KilnWorkGovernanceEvidence[] = KILN_WORK_GOVERNANCE_EVIDENCE;
const WORK_ITEM_EXECUTION_FAILURE_REASONS: readonly WorkItemExecutionFailureReason[] = [
  "failed",
  "denied",
  "unavailable",
  "timed_out",
  "cancelled",
  "skipped",
];
const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ["pending", "in_progress", "blocked", "completed", "cancelled"];
const WORK_ITEM_UPDATE_STATUSES: readonly WorkItemStatus[] = ["pending", "blocked", "completed", "cancelled"];
const GOAL_AUTHORITY_LEVELS: readonly GoalRunAuthorityLevel[] = ["read_only", "audited", "destructive"];
const GOAL_ESCALATION_POLICIES: readonly GoalRunEscalationPolicy[] = ["deny", "approval_required"];
const WORK_GOVERNANCE_READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};
const WORK_GOVERNANCE_MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};
export type ManagedInvocationExecutionProofResolver = (
  invocationId: string,
) => ManagedInvocationExecutionProof | undefined;
export type BoundedWorkExecutionAttemptAdmission = (input: {
  readonly goal: GoalRun;
  readonly workItem: WorkItem;
  readonly attemptId: string;
}) =>
  | { readonly admitted: true; readonly commit: () => void; readonly release: () => void }
  | { readonly admitted: false; readonly code: string; readonly message: string };
export type BoundedWorkCandidateCloseout = (input: {
  readonly goal: GoalRun;
  readonly workItem: WorkItem;
  readonly attempt: WorkItemExecutionAttempt;
  readonly providedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly verificationGateResults: readonly VerificationGateResult[];
  readonly [FORMAL_VERIFICATION_FINISH_TRANSPORT]?: FormalVerificationFinishTransportEnvelope;
}) => Promise<
  | {
      readonly captured: true;
      readonly candidate: BoundedWorkCandidateIdentity;
      readonly evidence: readonly BoundedWorkCandidateEvidence[];
      readonly assuranceEvaluation: BoundedWorkAssuranceEvaluation;
    }
  | { readonly captured: false; readonly code: string; readonly message: string }
>;
export type BoundedWorkGoalCloseout = (input: {
  readonly goal: GoalRun;
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly candidateCaptureRoot?: string;
  readonly candidateEvidence: readonly BoundedWorkCandidateEvidence[];
  readonly assuranceEvaluation: BoundedWorkAssuranceEvaluation;
}) => BoundedWorkCloseoutDecision | Promise<BoundedWorkCloseoutDecision>;
export function createWorkGovernanceTools(
  config: KilnWorkGovernanceConfig | undefined,
  options: {
    readonly workItemStore?: WorkItemStore;
    readonly goalRunStore?: GoalRunStore;
    readonly ownerSessionId?: string;
    readonly managedInvocationProofResolver?: ManagedInvocationExecutionProofResolver;
    readonly boundedWorkExecutionAttemptAdmission?: BoundedWorkExecutionAttemptAdmission;
    readonly boundedWorkCandidateCloseout?: BoundedWorkCandidateCloseout;
    readonly boundedWorkGoalCloseout?: BoundedWorkGoalCloseout;
  } = {},
): readonly DevTool[] {
  const store = options.workItemStore ?? new WorkItemStore();
  const goalRunStore = options.goalRunStore ?? new GoalRunStore();
  const finishTool = new WorkItemExecutionFinishTool(
    goalRunStore,
    store,
    options.boundedWorkCandidateCloseout,
  );
  return [
    new WorkGovernanceAssessTool(config),
    new WorkProfileListTool(),
    new WorkItemUpdateTool(config, store, goalRunStore),
    new WorkItemListTool(store),
    new WorkItemCompleteTool(store),
    new GoalCreateTool(config, goalRunStore, store, options.ownerSessionId),
    new GoalBoundedWorkContractSupersedeTool(config, goalRunStore),
    new GoalWorkItemsAttachTool(goalRunStore, store),
    new GoalEvidenceRecordTool(goalRunStore),
    new GoalCompleteTool(goalRunStore, store, options.boundedWorkGoalCloseout),
    new WorkItemExecutionStartTool(
      goalRunStore,
      store,
      options.managedInvocationProofResolver,
      options.boundedWorkExecutionAttemptAdmission,
    ),
    finishTool,
    new WorkItemExecutionFailTool(goalRunStore, store),
  ];
}

export class WorkGovernanceAssessTool implements DevTool {
  readonly name = "work_governance.assess";

  readonly description = [
    "Assess whether a task should be handled directly or orchestrated through managed agents.",
    "Use when a configured delegation trigger may apply or the operator requests an explicit topology decision.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_READ_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        minLength: 1,
        description: "Short description of the intended work.",
      },
      triggers: {
        type: "array",
        items: { type: "string", enum: TRIGGERS },
        description: "Known work-governance triggers that apply to this task.",
      },
    },
    required: ["summary"],
    additionalProperties: false,
  };

  readonly outputSchema = {
    type: "object",
    properties: {
      recommendation: { enum: ["direct", "orchestrate"] },
      reasons: { type: "array", items: { type: "string" } },
      triggers: { type: "array", items: { type: "string", enum: TRIGGERS } },
      requiredEvidence: { type: "array", items: { type: "string" } },
    },
    required: ["recommendation", "reasons", "triggers", "requiredEvidence"],
    additionalProperties: false,
  };

  constructor(private readonly config: KilnWorkGovernanceConfig | undefined) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const summary = input.input.summary;
    if (typeof summary !== "string" || summary.trim().length === 0) {
      return { output: 'Invalid input: "summary" must be a non-empty string', isError: true };
    }

    const triggers = Array.isArray(input.input.triggers)
      ? input.input.triggers.filter(isTrigger)
      : [];

    const assessment = assessWorkGovernance(this.config, {
      summary,
      triggers,
    });

    return {
      output: [
        `recommendation: ${assessment.recommendation}`,
        `reasons: ${assessment.reasons.join("; ")}`,
        assessment.triggers.length > 0 ? `triggers: ${assessment.triggers.join(", ")}` : "triggers: none",
        assessment.requiredEvidence.length > 0
          ? `requiredEvidence: ${assessment.requiredEvidence.join(", ")}`
          : "requiredEvidence: none",
      ].join("\n"),
      isError: false,
    };
  }
}

class WorkProfileListTool implements DevTool {
  readonly name = "work_profile.list";

  readonly description = [
    "List canonical Kiln workflow profiles for selecting the right execution posture, agents, authority, and evidence gates.",
    "Use before creating governed work items or delegating broad work.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_READ_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      trigger: {
        type: "string",
        enum: TRIGGERS,
        description: "Optional trigger filter.",
      },
    },
    additionalProperties: false,
  };

  async execute(input: ToolInput): Promise<ToolResult> {
    const trigger = isTrigger(input.input.trigger) ? input.input.trigger : undefined;
    const profiles = trigger
      ? WORK_GOVERNANCE_WORKFLOW_PROFILES.filter((profile) => profile.triggers.includes(trigger))
      : WORK_GOVERNANCE_WORKFLOW_PROFILES;

    return {
      output: JSON.stringify({
        profiles: profiles.map((profile) => ({
          id: profile.id,
          description: profile.description,
          triggers: profile.triggers,
          minimumRisk: profile.minimumRisk,
          recommendedTaskAffinities: profile.recommendedTaskAffinities,
          defaultAccess: profile.defaultAccess,
          requiredEvidence: profile.requiredEvidence,
          verificationGates: verificationGatesForWorkflowProfile(profile),
          evidenceMatrix: evidenceMatrixForWorkflowProfile(profile),
        })),
      }, null, 2),
      isError: false,
    };
  }
}

class WorkItemUpdateTool implements DevTool {
  readonly name = "work_item.update";

  readonly description = [
    "Create or update a governed work item with workflow profile, expected evidence, route/agent hints, and verification gates.",
    "Use this when decomposing non-trivial work before managed child invocation or direct execution.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      id: {
        type: "string",
        minLength: 1,
        description: "Stable caller-owned work item id.",
      },
      summary: { type: "string", minLength: 1, description: "Bounded work item summary." },
      status: {
        type: "string",
        enum: WORK_ITEM_UPDATE_STATUSES,
        description: "Optional lifecycle status. Active execution is owned by work_item.execution.start.",
      },
      workflowProfile: {
        type: "string",
        enum: WORK_GOVERNANCE_WORKFLOW_PROFILES.map((profile) => profile.id),
        description: "Optional workflow profile. When omitted, Kiln infers one from triggers and risk.",
      },
      risk: { type: "string", enum: RISKS, description: "Optional risk estimate." },
      triggers: {
        type: "array",
        items: { type: "string", enum: TRIGGERS },
        description: "Governance triggers that apply to this work item.",
      },
      surface: { type: "string", description: "Optional affected surface, such as gui, cli, tui, runtime, or docs." },
      assignedAgentProfile: { type: "string", description: "Optional configured Kiln agent profile assigned to the work item." },
      routeId: { type: "string", description: "Optional managed invocation route id." },
      phaseRoutes: {
        type: "object",
        properties: {
          [VISUAL_REFERENCE_PHASE_ROUTE]: {
            type: "string",
            minLength: 1,
            description: "Read-only web/frontend-reference capable managed route used only for visual-reference-research before approved-write UI work.",
          },
        },
        additionalProperties: { type: "string" },
        description: "Optional phase-specific managed route ids. For UI work on approved-write, set phaseRoutes.visual-reference-research to a read-only web/frontend-reference capable route; do not leave phaseRoutes empty and do not use the write route for frontend-reference research.",
      },
      referenceRoots: {
        type: "array",
        items: { type: "string", minLength: 1 },
        description: "Optional local reference roots the read-only research phase must be able to inspect, such as sibling cloned harness repositories. These are read requirements only, never write authority.",
      },
      access: { type: "string", enum: MANAGED_INVOCATION_ACCESS, description: "Optional access level for the assigned work." },
      expectedEvidence: {
        type: "array",
        items: { type: "string", enum: EVIDENCE },
        description: "Optional extra or overriding evidence expected before closeout.",
      },
      providedEvidence: {
        type: "array",
        items: { type: "string", enum: EVIDENCE },
        description: "Optional evidence already produced.",
      },
      skippedVerificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Expected evidence or verification labels intentionally skipped. Skips require residual-risk closeout and are never recorded as produced evidence.",
      },
      verificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Optional extra verification gates.",
      },
      verificationGateResults: verificationGateResultsSchema(),
      dependencies: {
        type: "array",
        items: { type: "string" },
        description: "Optional work item ids that must complete first.",
      },
      residualRisk: { type: "string", description: "Known residual risk, if already available." },
      workClassification: {
        type: "object",
        properties: {
          intents: { type: "array", items: { type: "string" } },
          artifacts: { type: "array", items: { type: "string" } },
          domains: { type: "array", items: { type: "string" } },
          evidenceScopes: { type: "array", items: { type: "string", enum: WORK_CLASSIFICATION_EVIDENCE_SCOPES } },
          effects: { type: "array", items: { type: "string" } },
          modes: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
        description: "Optional explicit cross-domain work classification. Unknown facet values fail closed in core.",
      },
      workClassificationProvenance: {
        type: "object",
        properties: {
          sourceKind: { type: "string", enum: ["plan-work-item"] },
          sourceId: { type: "string", minLength: 1 },
        },
        required: ["sourceKind", "sourceId"],
        additionalProperties: false,
        description: "Required with workClassification. For manual work_item.update, sourceId must match the work item id.",
      },
      pauseRequirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            kind: { type: "string", enum: WORK_ITEM_PAUSE_REQUIREMENT_KINDS },
            summary: { type: "string", minLength: 1 },
            status: { type: "string", enum: WORK_ITEM_PAUSE_REQUIREMENT_STATUSES },
            resolvedBy: { type: "string" },
            resolvedAt: { type: "string" },
            resolution: { type: "string" },
            supersededByRequirementId: { type: "string" },
            supersededAt: { type: "string" },
            supersededBy: { type: "string" },
            reason: { type: "string" },
          },
          required: ["id", "kind", "summary", "status"],
          additionalProperties: false,
        },
        description: "Optional unresolved or resolved requirements that must be cleared before execution can start.",
      },
    },
    required: ["id", "summary"],
    additionalProperties: false,
  };

  constructor(
    private readonly config: KilnWorkGovernanceConfig | undefined,
    private readonly store: WorkItemStore,
    private readonly goalRunStore: GoalRunStore,
  ) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const summary = readText(input.input.summary);
    if (!summary) {
      return { output: 'Invalid input: "summary" must be a non-empty string', isError: true };
    }
    const id = readText(input.input.id);
    if (!id) {
      return {
        output: 'Invalid input: "id" must be a non-empty stable work item id.',
        metadata: workItemToolMetadata("work_item.update", {
          operation: "update",
          status: "blocked",
          errorCode: "invalid_input",
        }),
        isError: true,
      };
    }
    if (input.input.status === "in_progress") {
      return {
        output: 'Invalid input: status "in_progress" is reserved for work_item.execution.start.',
        isError: true,
      };
    }

    let workClassification: WorkClassificationInput | undefined;
    let workClassificationProvenance: WorkClassificationProvenanceInput | undefined;
    try {
      workClassification = readWorkClassificationInput(input.input.workClassification);
      workClassificationProvenance = readWorkClassificationProvenanceInput(
        input.input.workClassificationProvenance,
      );
    } catch (error) {
      return {
        output: `Invalid input: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
    const readOnlyArchitectureReview = isReadOnlyArchitectureReview(workClassification);
    const existing = this.store.get(id);
    if (existing?.goalRunId) {
      const goal = this.goalRunStore.get(existing.goalRunId);
      const requestedStatus = readStatus(input.input.status);
      const terminalReason = goal && isTerminalGoalStatus(goal.status)
        ? `Goal ${goal.id} is terminal (${goal.status}); its work items are immutable.`
        : existing.status === "completed" || existing.status === "cancelled"
          ? `Goal-bound work item ${existing.id} is terminal (${existing.status}) and cannot be updated.`
          : requestedStatus === "completed" || requestedStatus === "cancelled"
            ? `Goal-bound work item ${existing.id} must transition to ${requestedStatus} through its execution lifecycle.`
          : undefined;
      if (terminalReason) {
        return {
          output: terminalReason,
          metadata: workItemToolMetadata("work_item.update", {
            operation: "update",
            id: existing.id,
            status: existing.status,
            item: existing,
            errorCode: "invalid_input",
          }),
          isError: true,
        };
      }
    }
    const triggers = input.input.triggers === undefined
      ? existing?.triggers.filter(isTrigger) ?? []
      : readTriggers(input.input.triggers);
    const risk = isRisk(input.input.risk)
      ? input.input.risk
      : isRisk(existing?.risk)
        ? existing.risk
        : undefined;
    const requestedProfile = readText(input.input.workflowProfile);
    const explicitProfile = requestedProfile === "architecture-change" && readOnlyArchitectureReview
      ? "architecture-review"
      : requestedProfile;
    const workflowProfile = explicitProfile
      ? findWorkflowProfile(explicitProfile)
      : existing
        ? findWorkflowProfile(existing.workflowProfile)
        : chooseWorkflowProfile(triggers, risk, { readOnlyArchitectureReview });
    if (!workflowProfile) {
      return { output: `Invalid input: unknown workflowProfile "${explicitProfile}"`, isError: true };
    }

    const assessment = assessWorkGovernance(this.config, {
      summary,
      triggers,
    });
    const expectedEvidence = uniqueEvidence([
      ...requiredEvidenceForWorkflowProfile(workflowProfile),
      ...assessment.requiredEvidence,
      ...(existing?.expectedEvidence.filter(isKilnWorkGovernanceEvidence) ?? []),
      ...readEvidence(input.input.expectedEvidence),
    ]);
    const verificationGates = uniqueText([
      ...verificationGatesForWorkflowProfile(workflowProfile),
      ...(existing?.verificationGates ?? []),
      ...readTextArray(input.input.verificationGates),
    ]);
    const routeId = readText(input.input.routeId) ?? existing?.routeId;
    const access = readManagedInvocationAccess(input.input.access) ?? existing?.access ?? workflowProfile.defaultAccess;
    const phaseRoutes = readTextRecord(input.input.phaseRoutes) ?? existing?.phaseRoutes;
    const referenceRootsInput = readTextArray(input.input.referenceRoots);
    const referenceRoots = referenceRootsInput.length > 0 ? referenceRootsInput : existing?.referenceRoots;
    const providedEvidence = uniqueEvidence([
      ...(existing?.providedEvidence.filter(isKilnWorkGovernanceEvidence) ?? []),
      ...readEvidence(input.input.providedEvidence),
    ]);
    const skippedVerificationGates = uniqueText([
      ...(existing?.skippedVerificationGates ?? []),
      ...readTextArray(input.input.skippedVerificationGates),
    ]);
    const verificationGateResults = mergeGateResults(
      existing?.verificationGateResults ?? [],
      readVerificationGateResults(input.input.verificationGateResults),
    );
    const visualEvidence = validateVisualReferenceEvidence({
      providedEvidence,
      verificationGateResults,
    });
    if (!visualEvidence.ok) {
      return {
        output: `Invalid input: ${visualEvidence.code}: ${visualEvidence.message}`,
        isError: true,
      };
    }
    const phaseRouteContract = validatePhaseRouteContract({
      expectedEvidence,
      providedEvidence,
      routeId,
      access,
      phaseRoutes,
    });
    if (!phaseRouteContract.ok) {
      const retryInputPatch = {
        phaseRoutes: {
          [VISUAL_REFERENCE_PHASE_ROUTE]: VISUAL_REFERENCE_PHASE_ROUTE_PLACEHOLDER,
        },
      };
      return {
        output: formatInvalidInputRecovery({
          code: phaseRouteContract.code,
          message: phaseRouteContract.message,
          nextTool: "work_item.update",
          retryInputPatch,
          instruction: `Retry the same work_item.update call with phaseRoutes.${VISUAL_REFERENCE_PHASE_ROUTE} set to the read-only frontend-reference route from the task or config. Do not paste this JSON as assistant text; only an actual work_item.update tool call counts.`,
        }),
        metadata: workItemToolMetadata("work_item.update", {
          operation: "update",
          status: "blocked",
          errorCode: "invalid_input",
          requiredPhaseRoute: VISUAL_REFERENCE_PHASE_ROUTE,
          suggestedNextTool: "work_item.update",
          retryInputPatch,
        }),
        isError: true,
      };
    }
    const pauseRequirements = input.input.pauseRequirements === undefined
      ? { ok: true as const, requirements: existing?.pauseRequirements ?? [] }
      : readPauseRequirements(input.input.pauseRequirements);
    if (!pauseRequirements.ok) {
      return { output: `Invalid input: ${pauseRequirements.message}`, isError: true };
    }
    let item: WorkItem;
    try {
      item = this.store.upsert({
        id,
        summary,
        status: readStatus(input.input.status) ?? existing?.status,
        workflowProfile: workflowProfile.id,
        risk,
        triggers,
        surface: readText(input.input.surface) ?? existing?.surface,
        assignedAgentProfile: readText(input.input.assignedAgentProfile) ?? existing?.assignedAgentProfile,
        routeId,
        phaseRoutes,
        referenceRoots,
        access,
        expectedEvidence,
        providedEvidence,
        verificationGates,
        skippedVerificationGates,
        verificationGateResults,
        dependencies: input.input.dependencies === undefined
          ? existing?.dependencies ?? []
          : readTextArray(input.input.dependencies),
        residualRisk: readText(input.input.residualRisk) ?? existing?.residualRisk,
        pauseRequirements: pauseRequirements.requirements,
        ...(workClassification ? { workClassification } : {}),
        ...(workClassificationProvenance ? { workClassificationProvenance } : {}),
      });
    } catch (error) {
      return {
        output: `Invalid input: ${error instanceof Error ? error.message : String(error)}`,
        metadata: workItemToolMetadata("work_item.update", {
          operation: "update",
          status: "blocked",
          errorCode: "invalid_input",
        }),
        isError: true,
      };
    }

    const nextExecution = nextGovernedExecutionStep(item);

    return {
      output: JSON.stringify({
        item: workItemToolOutputProjection(item),
        ...(nextExecution ? nextExecution : {}),
      }, null, 2),
      metadata: workItemToolMetadata("work_item.update", {
        operation: "update",
        id: item.id,
        status: item.status,
        item,
        sequence: item.sequence,
      }),
      isError: false,
    };
  }
}

function formatInvalidInputRecovery(input: {
  readonly code: string;
  readonly message: string;
  readonly nextTool: string;
  readonly retryInputPatch: Readonly<Record<string, unknown>>;
  readonly instruction: string;
}): string {
  return JSON.stringify({
    error: "invalid_input",
    code: input.code,
    message: input.message,
    nextTool: input.nextTool,
    retryInputPatch: input.retryInputPatch,
    instruction: input.instruction,
  }, null, 2);
}

function nextGovernedExecutionStep(item: WorkItem): {
  readonly nextRequiredTools: readonly string[];
  readonly nextAction: string;
} | undefined {
  if (item.status !== "pending") {
    return undefined;
  }
  const nextRequiredTools = item.goalRunId
    ? ["work_item.execution.start"]
    : ["goal.create", "work_item.execution.start"];
  const routeSuffix = item.routeId
    ? ` Route-owned execution is already selected through ${item.routeId}.`
    : "";
  const visualRoute = item.phaseRoutes?.["visual-reference-research"];
  const visualPhaseSuffix = visualRoute && item.expectedEvidence.includes("visual-reference-research") && !item.providedEvidence.includes("visual-reference-research")
    ? ` The next missing phase is visual-reference-research; create or use a goal, then call work_item.execution.start so managed_agent.invoke uses read-only phase route ${visualRoute} before returning to the write route.`
    : "";
  return {
    nextRequiredTools,
    nextAction: `Do not stop after scout or local read-only diagnosis. Create or use a goal, then call work_item.execution.start so governed execution, managed delegation, evidence, and residual risk are recorded.${routeSuffix}${visualPhaseSuffix}`,
  };
}

function normalizeGoalRoutePolicy(input: {
  readonly workItems: readonly WorkItem[];
  readonly preferredRouteId?: string;
  readonly managedAgentProfile?: string;
}):
  | {
    readonly ok: true;
    readonly preferredRouteId?: string;
    readonly managedAgentProfile?: string;
  }
  | {
    readonly ok: false;
    readonly message: string;
  } {
  const { preferredRouteId, managedAgentProfile } = input;
  if (!preferredRouteId || !managedAgentProfile) {
    return {
      ok: true,
      ...(preferredRouteId ? { preferredRouteId } : {}),
      ...(managedAgentProfile ? { managedAgentProfile } : {}),
    };
  }

  const routeIsAlreadyOwnedByEveryWorkItem = input.workItems.length > 0
    && input.workItems.every((item) =>
      item.routeId === preferredRouteId && item.assignedAgentProfile === managedAgentProfile);
  if (routeIsAlreadyOwnedByEveryWorkItem) {
    return { ok: true };
  }

  return {
    ok: false,
    message: "goal.create cannot combine preferredRouteId and managedAgentProfile. Use managedAgentProfile when an agent profile owns route selection, preferredRouteId when the caller owns the exact route, or put an exact route on each work item instead of duplicating route ownership at goal level.",
  };
}

class WorkItemListTool implements DevTool {
  readonly name = "work_item.list";

  readonly description = "List session governed work items and their evidence status.";

  readonly effectEnvelope = WORK_GOVERNANCE_READ_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      status: { type: "string", enum: WORK_ITEM_STATUSES, description: "Optional status filter." },
    },
    additionalProperties: false,
  };

  constructor(private readonly store: WorkItemStore) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const status = readStatus(input.input.status);
    const items = this.store.list(status);
    const snapshot = this.store.snapshot(status);
    return {
      output: JSON.stringify({ items: items.map(workItemToolOutputProjection) }, null, 2),
      metadata: workItemToolMetadata("work_item.list", {
        operation: "list",
        ...(status ? { status } : {}),
        items,
        itemCount: items.length,
        sequence: snapshot.sequence,
      }),
      isError: false,
    };
  }
}

class WorkItemCompleteTool implements DevTool {
  readonly name = "work_item.complete";

  readonly description = [
    "Attempt to close a governed work item.",
    "The tool fails closed when expected evidence or required residual risk is missing.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, description: "Work item id." },
      providedEvidence: {
        type: "array",
        items: { type: "string", enum: EVIDENCE },
        description: "Evidence actually produced for this work item. Never include a label that is skipped.",
      },
      residualRisk: { type: "string", description: "Residual-risk closeout. Required when residual-risk is expected evidence." },
      skippedVerificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Expected verification labels intentionally skipped during closeout. A skip accounts for the expectation without claiming evidence and requires residual-risk closeout.",
      },
      verificationGateResults: verificationGateResultsSchema(),
    },
    required: ["id"],
    additionalProperties: false,
  };

  constructor(private readonly store: WorkItemStore) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const id = readText(input.input.id);
    if (!id) {
      return { output: 'Invalid input: "id" must be a non-empty string', isError: true };
    }
    const existing = this.store.get(id);
    if (!existing) {
      return { output: `Work item not found: ${id}`, isError: true };
    }
    if (existing.goalRunId) {
      return {
        output: JSON.stringify({
          error: {
            code: "goal_bound_work_item",
            message: `Work item ${id} belongs to goal ${existing.goalRunId} and must close through its execution lifecycle.`,
            recoverable: true,
            suggestedNextTool: "work_item.execution.finish",
          },
        }, null, 2),
        metadata: workItemToolMetadata("work_item.complete", {
          operation: "complete",
          id,
          status: existing.status,
          item: existing,
          suggestedNextTool: "work_item.execution.finish",
          errorCode: "invalid_input",
        }),
        isError: true,
      };
    }

    const providedEvidence = readEvidence(input.input.providedEvidence);
    const verificationGateResults = readVerificationGateResults(input.input.verificationGateResults);
    const visualEvidence = validateVisualReferenceEvidence({
      providedEvidence,
      verificationGateResults,
    });
    if (!visualEvidence.ok) {
      return {
        output: `Invalid input: ${visualEvidence.code}: ${visualEvidence.message}`,
        isError: true,
      };
    }

    const completion = this.store.complete({
      id,
      providedEvidence,
      skippedVerificationGates: readTextArray(input.input.skippedVerificationGates),
      verificationGateResults,
      residualRisk: readText(input.input.residualRisk),
    });
    if (!completion) throw new Error(`Work item ${id} disappeared during completion.`);

    const missing = [
      ...completion.missingEvidence,
      ...completion.missingVerificationGates.map((gate) => `missing gate: ${gate}`),
      ...completion.failedVerificationGates.map((gate) => `failed gate: ${gate}`),
      ...(completion.missingResidualRisk ? ["residual-risk closeout"] : []),
    ];
    if (missing.length > 0) {
      return {
        output: JSON.stringify({
          status: "blocked",
          missing,
          item: workItemToolOutputProjection(completion.item),
        }, null, 2),
        metadata: workItemToolMetadata("work_item.complete", {
          operation: "complete",
          id: completion.item.id,
          status: completion.item.status,
          item: completion.item,
          missingEvidence: completion.missingEvidence,
          missingVerificationGates: completion.missingVerificationGates,
          failedVerificationGates: completion.failedVerificationGates,
          missingResidualRisk: completion.missingResidualRisk,
          sequence: completion.item.sequence,
          errorCode: "missing_evidence",
        }),
        isError: true,
      };
    }

    return {
      output: JSON.stringify({
        status: "completed",
        item: workItemToolOutputProjection(completion.item),
      }, null, 2),
      metadata: workItemToolMetadata("work_item.complete", {
        operation: "complete",
        id: completion.item.id,
        status: completion.item.status,
        item: completion.item,
        missingEvidence: completion.missingEvidence,
        missingVerificationGates: completion.missingVerificationGates,
        failedVerificationGates: completion.failedVerificationGates,
        missingResidualRisk: completion.missingResidualRisk,
        sequence: completion.item.sequence,
        ...(completion.item.goalRunId
          ? {
            executionScopeTransition: {
              action: "exit" as const,
              scope: {
                kind: "work_item" as const,
                goalRunId: completion.item.goalRunId,
                workItemId: completion.item.id,
              },
            },
          }
          : {}),
      }),
      isError: false,
    };
  }
}

class GoalCreateTool implements DevTool {
  readonly name = "goal.create";

  readonly description = [
    "Create a governed goal run from existing work items and link those work items to the goal.",
    "Use this before work_item.execution.start; never invent a goalRunId without creating it through this tool.",
    "Goal-level evidence requirements are closed explicitly with goal.evidence.record followed by goal.complete.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, description: "Stable goal id and bounded-work accounting lineage id." },
      objective: { type: "string", minLength: 1, description: "Operator-facing goal objective." },
      ownerSessionId: {
        type: "string",
        description: "Owning session id. Omit only when the runtime supplied the current session id.",
      },
      workItemIds: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
        description: "Existing governed work item ids to execute under this goal.",
      },
      maximumAuthority: {
        type: "string",
        enum: GOAL_AUTHORITY_LEVELS,
        description: "Maximum authority allowed while executing this goal.",
      },
      escalationPolicy: {
        type: "string",
        enum: GOAL_ESCALATION_POLICIES,
        description: "How execution handles authority requests above maximumAuthority.",
      },
      authorityReason: { type: "string", minLength: 1, description: "Why this authority envelope is appropriate." },
      workflowProfile: {
        type: "string",
        enum: WORK_GOVERNANCE_WORKFLOW_PROFILES.map((profile) => profile.id),
        description: "Workflow profile governing this goal.",
      },
      preferredRouteId: { type: "string", description: "Optional preferred managed-agent route id." },
      managedAgentProfile: { type: "string", description: "Optional managed-agent profile." },
      evidenceRequirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            description: { type: "string", minLength: 1 },
            required: { type: "boolean" },
          },
          required: ["id", "description", "required"],
          additionalProperties: false,
        },
        description: "Goal-level evidence requirements beyond work-item evidence.",
      },
      currentPhase: { type: "string", description: "Optional current execution phase." },
      boundedWorkContract: boundedWorkContractSchema(),
    },
    required: [
      "id",
      "objective",
      "workItemIds",
      "maximumAuthority",
      "escalationPolicy",
      "authorityReason",
      "workflowProfile",
      "boundedWorkContract",
    ],
    additionalProperties: false,
  };

  constructor(
    private readonly config: KilnWorkGovernanceConfig | undefined,
    private readonly goalRunStore: GoalRunStore,
    private readonly workItemStore: WorkItemStore,
    _ownerSessionId?: string,
  ) {}

  async execute(input: ToolInput, _sandbox?: unknown, context?: DevToolExecutionContext): Promise<ToolResult> {
    const adoptionDecision = context?.[OPERATOR_ADOPTION_DECISION_TRANSPORT];
    if (!adoptionDecision) {
      return goalCreateContractError({
        code: "invalid_input",
        message: "goal.create requires a canonical runtime operator adoption decision.",
        missingFields: [],
      });
    }
    const authoritativeInput: Record<string, unknown> = {
      ...input.input,
      ownerSessionId: adoptionDecision.ownerSessionId,
      operatorTurnId: adoptionDecision.operatorTurnId,
      contractAuthority: adoptionDecision.contractAuthority,
    };
    const id = readText(authoritativeInput.id);
    const objective = readText(authoritativeInput.objective);
    const operatorTurnId = readText(authoritativeInput.operatorTurnId);
    const workItemIds = readTextArray(authoritativeInput.workItemIds);
    const maximumAuthority = readGoalAuthorityLevel(authoritativeInput.maximumAuthority);
    const escalationPolicy = readGoalEscalationPolicy(authoritativeInput.escalationPolicy);
    const authorityReason = readText(authoritativeInput.authorityReason);
    const workflowProfile = readText(authoritativeInput.workflowProfile);
    const ownerSessionId = readText(authoritativeInput.ownerSessionId);
    const boundedWorkContract = readBoundedWorkContract(authoritativeInput.boundedWorkContract);
    const contractAuthority = readBoundedWorkContractAuthority(authoritativeInput.contractAuthority);

    const missingFields = [
      ...(!id ? ["id"] : []),
      ...(!objective ? ["objective"] : []),
      ...(!ownerSessionId ? ["ownerSessionId"] : []),
      ...(!operatorTurnId ? ["operatorTurnId"] : []),
      ...(workItemIds.length === 0 ? ["workItemIds"] : []),
      ...(!maximumAuthority ? ["maximumAuthority"] : []),
      ...(!escalationPolicy ? ["escalationPolicy"] : []),
      ...(!authorityReason ? ["authorityReason"] : []),
      ...(!workflowProfile ? ["workflowProfile"] : []),
      ...(!boundedWorkContract ? ["boundedWorkContract"] : []),
      ...(!contractAuthority ? ["contractAuthority"] : []),
    ];
    if (missingFields.length > 0) {
      return goalCreateContractError({
        code: "invalid_input",
        message: "goal.create requires a stable id, explicit bounded-work contract and adoption authority, objective, canonical operator-turn provenance, ownerSessionId, at least one workItemId, authority envelope, and workflowProfile.",
        missingFields,
      });
    }

    const goalObjective = objective!;
    const goalMaximumAuthority = maximumAuthority!;
    const goalEscalationPolicy = escalationPolicy!;
    const goalAuthorityReason = authorityReason!;
    const goalWorkflowProfile = workflowProfile!;
    const goalBoundedWorkContract = boundedWorkContract!;
    const goalContractAuthority = contractAuthority!;
    const profile = findWorkflowProfile(goalWorkflowProfile);
    if (!profile) {
      return goalCreateContractError({
        code: "invalid_input",
        message: `Unknown workflowProfile "${goalWorkflowProfile}".`,
        missingFields: ["workflowProfile"],
      });
    }

    const evidenceRequirements = readGoalEvidenceRequirements(authoritativeInput.evidenceRequirements);
    if (!evidenceRequirements.ok) {
      return goalCreateContractError({
        code: "invalid_input",
        message: evidenceRequirements.message,
        missingFields: ["evidenceRequirements"],
      });
    }

    const missingWorkItemIds = workItemIds.filter((id) => !this.workItemStore.get(id));
    if (missingWorkItemIds.length > 0) {
      return {
        output: JSON.stringify({
          error: {
            code: "work_items_not_found",
            message: "Create missing work items with work_item.update before creating a goal.",
            recoverable: true,
            suggestedNextTool: "work_item.update",
            missingWorkItemIds,
          },
        }, null, 2),
        metadata: goalToolMetadata("goal.create", {
          operation: "create",
          missingWorkItemIds,
          errorCode: "not_found",
        }),
        isError: true,
      };
    }

    const requestedWorkItems = workItemIds.map((id) => this.workItemStore.get(id)!);
    const ownedWorkItem = requestedWorkItems.find((item) => item.goalRunId);
    if (ownedWorkItem?.goalRunId) {
      return goalCreateContractError({
        code: "invalid_input",
        message: `Work item ${ownedWorkItem.id} already belongs to goal ${ownedWorkItem.goalRunId}.`,
        missingFields: ["workItemIds"],
      });
    }
    const terminalWorkItem = requestedWorkItems.find(
      (item) => item.status === "completed" || item.status === "cancelled",
    );
    if (terminalWorkItem) {
      return goalCreateContractError({
        code: "invalid_input",
        message: `Cannot create an active goal from terminal work item ${terminalWorkItem.id}.`,
        missingFields: ["workItemIds"],
      });
    }

    try {
      assertBoundedWorkPolicyCeiling(this.config, goalBoundedWorkContract);
      const preferredRouteId = readText(authoritativeInput.preferredRouteId);
      const managedAgentProfile = readText(authoritativeInput.managedAgentProfile);
      const routePolicy = normalizeGoalRoutePolicy({
        workItems: workItemIds.map((id) => this.workItemStore.get(id)).filter((item): item is WorkItem => !!item),
        preferredRouteId,
        managedAgentProfile,
      });
      if (!routePolicy.ok) {
        return goalCreateContractError({
          code: "invalid_input",
          message: routePolicy.message,
          missingFields: ["preferredRouteId", "managedAgentProfile"],
        });
      }
      const currentPhase = readText(authoritativeInput.currentPhase);
      const goal = this.goalRunStore.create({
        id: id!,
        objective: goalObjective,
        ownerSessionId: ownerSessionId!,
        source: {
          kind: "operator_direct",
          turnId: operatorTurnId!,
        },
        boundedWorkContractRevision: adoptBoundedWorkContractRevision({
          contract: goalBoundedWorkContract,
          adoptedAt: new Date().toISOString(),
          adoptedBy: goalContractAuthority,
          accountingLineageId: id!,
        }),
        workItemIds,
        authorityEnvelope: {
          maximumAuthority: goalMaximumAuthority,
          escalationPolicy: goalEscalationPolicy,
          reason: goalAuthorityReason,
        },
        routePolicy: {
          workflowProfile: profile.id,
          ...(routePolicy.preferredRouteId ? { preferredRouteId: routePolicy.preferredRouteId } : {}),
          ...(routePolicy.managedAgentProfile ? { managedAgentProfile: routePolicy.managedAgentProfile } : {}),
        },
        evidenceRequirements: evidenceRequirements.requirements,
        ...(currentPhase ? { currentPhase } : {}),
      });
      const linkedWorkItemIds = workItemIds.flatMap((id) => {
        const item = this.workItemStore.get(id);
        if (!item) return [];
        this.workItemStore.upsert(linkWorkItemToGoal(item, goal));
        return [id];
      });

      return {
        output: JSON.stringify({ goal, linkedWorkItemIds }, null, 2),
        metadata: goalToolMetadata("goal.create", {
          operation: "create",
          id: goal.id,
          goal,
          linkedWorkItemIds,
          sequence: goal.sequence,
        }),
        isError: false,
      };
    } catch (error) {
      return goalCreateContractError({
        code: "invalid_input",
        message: error instanceof Error ? error.message : String(error),
        missingFields: [],
      });
    }
  }
}

class GoalBoundedWorkContractSupersedeTool implements DevTool {
  readonly name = "goal.bounded_work_contract.supersede";
  readonly description = "Adopt an explicitly authorized successor bounded-work contract without resetting accounting lineage.";
  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;
  readonly inputSchema = {
    type: "object",
    properties: {
      goalRunId: { type: "string", minLength: 1 },
      expectedRevisionDigest: { type: "string", minLength: 1 },
      boundedWorkContract: boundedWorkContractSchema(),
    },
    required: ["goalRunId", "expectedRevisionDigest", "boundedWorkContract"],
    additionalProperties: false,
  };

  constructor(private readonly config: KilnWorkGovernanceConfig | undefined, private readonly goals: GoalRunStore) {}

  async execute(input: ToolInput, _sandbox?: unknown, context?: DevToolExecutionContext): Promise<ToolResult> {
    const adoptionDecision = context?.[OPERATOR_ADOPTION_DECISION_TRANSPORT];
    if (!adoptionDecision) {
      return {
        output: "Bounded-work contract supersession requires a canonical runtime operator adoption decision.",
        isError: true,
      };
    }
    const goalRunId = readText(input.input.goalRunId);
    const expectedRevisionDigest = readText(input.input.expectedRevisionDigest);
    const contract = readBoundedWorkContract(input.input.boundedWorkContract);
    const adoptedBy = readBoundedWorkContractAuthority(adoptionDecision.contractAuthority);
    if (!goalRunId || !expectedRevisionDigest || !contract || !adoptedBy) {
      return { output: "Invalid bounded-work contract supersession input.", isError: true };
    }
    try {
      assertBoundedWorkPolicyCeiling(this.config, contract);
      const goal = this.goals.supersedeBoundedWorkContract({
        id: goalRunId,
        contract,
        expectedRevisionDigest,
        adoptedAt: new Date().toISOString(),
        adoptedBy,
      });
      return {
        output: JSON.stringify({ status: "superseded", goal: goalToolOutputProjection(goal) }, null, 2),
        metadata: goalToolMetadata("goal.bounded_work_contract.supersede", {
          operation: "update",
          id: goal.id,
          goal,
          changedFields: ["boundedWorkContractRevision"],
          sequence: goal.sequence,
        }),
        isError: false,
      };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

class GoalWorkItemsAttachTool implements DevTool {
  readonly name = "goal.work_items.attach";
  readonly description = "Attach existing work items already admitted by the current bounded-work contract.";
  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;
  readonly inputSchema = {
    type: "object",
    properties: {
      goalRunId: { type: "string", minLength: 1 },
      workItemIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    },
    required: ["goalRunId", "workItemIds"],
    additionalProperties: false,
  };

  constructor(private readonly goals: GoalRunStore, private readonly items: WorkItemStore) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const goalRunId = readText(input.input.goalRunId);
    const workItemIds = readTextArray(input.input.workItemIds) ?? [];
    if (!goalRunId || workItemIds.length === 0) return { output: "Invalid goal work-item attachment input.", isError: true };
    try {
      const missing = workItemIds.filter((id) => !this.items.get(id));
      if (missing.length > 0) throw new Error(`Work items not found: ${missing.join(", ")}.`);
      const goal = this.goals.attachWorkItems({ id: goalRunId, workItemIds });
      for (const id of workItemIds) this.items.upsert(linkWorkItemToGoal(this.items.get(id)!, goal));
      return {
        output: JSON.stringify({ status: "attached", goal: goalToolOutputProjection(goal), workItemIds }, null, 2),
        metadata: goalToolMetadata("goal.work_items.attach", {
          operation: "update",
          id: goal.id,
          goal,
          changedFields: ["workItemIds"],
          sequence: goal.sequence,
        }),
        isError: false,
      };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

class WorkItemExecutionStartTool implements DevTool {
  readonly name = "work_item.execution.start";

  readonly description = [
    "Start the next ready work item execution attempt for a goal.",
    "Selects the next ready pending item when workItemId is omitted and pauses instead of advancing when dependencies or state block execution.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      goalRunId: { type: "string", minLength: 1, description: "Goal run id." },
      workItemId: { type: "string", description: "Optional explicit work item id. Omit to select the next ready item." },
      summary: { type: "string", description: "Attempt summary." },
      managedInvocationId: { type: "string", description: "Managed child invocation id when delegation has already been requested." },
      managedProviderId: {
        type: "string",
        description: "Configured managed provider id to include in the suggested managed_agent.invoke request.",
      },
      managedModel: {
        type: "string",
        description: "Optional configured managed model to include in the suggested managed_agent.invoke request.",
      },
      managedDeliberationIntent: {
        type: "object",
        description: "Optional provider-neutral deliberation intent for the suggested managed_agent.invoke request.",
        properties: {
          mode: { type: "string", enum: ["provider-default", "fixed", "adaptive"] },
          preferredLevel: { type: "string", minLength: 1 },
          target: { type: "string", enum: ["latency-first", "balanced", "quality-first"] },
          bounds: {
            type: "object",
            properties: { min: { type: "string", minLength: 1 }, max: { type: "string", minLength: 1 } },
            additionalProperties: false,
          },
          onUnsupported: { type: "string", enum: ["deny", "omit", "allow-clamp"] },
        },
        required: ["mode", "onUnsupported"],
        additionalProperties: false,
      },
      managedResourceUris: {
        type: "array",
        items: { type: "string", minLength: 1 },
        description: "Canonical artifact content URIs to share with the managed child. Omit for fresh isolated context.",
      },
      managedAccess: {
        type: "string",
        enum: MANAGED_INVOCATION_ACCESS,
        description: "Managed invocation access level to include in the suggested managed_agent.invoke request.",
      },
      managedResearchRouteId: {
        type: "string",
        description: "Optional read-only managed route id to use for visual-reference or web/browser research phases.",
      },
      requestedAuthority: {
        type: "string",
        enum: MANAGED_INVOCATION_AUTHORITIES,
        description: "Requested child authority to include in the suggested managed_agent.invoke request.",
      },
      governanceRecommendation: {
        type: "string",
        enum: ["direct", "orchestrate"],
        description: "Optional work_governance.assess recommendation used for ready-item selection.",
      },
      governanceReasons: {
        type: "array",
        items: { type: "string" },
        description: "Optional work_governance.assess reasons.",
      },
      requiredEvidence: {
        type: "array",
        items: { type: "string" },
        description: "Optional evidence required by governance assessment.",
      },
    },
    required: ["goalRunId"],
    additionalProperties: false,
  };

  constructor(
    private readonly goalRunStore: GoalRunStore,
    private readonly workItemStore: WorkItemStore,
    private readonly managedInvocationProofResolver?: ManagedInvocationExecutionProofResolver,
    private readonly boundedWorkExecutionAttemptAdmission?: BoundedWorkExecutionAttemptAdmission,
  ) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const goalRunId = readText(input.input.goalRunId);
    if (!goalRunId) {
      return { output: 'Invalid input: "goalRunId" must be a non-empty string', isError: true };
    }
    const goal = this.goalRunStore.get(goalRunId);
    if (!goal) {
      return {
        output: JSON.stringify({
          error: {
            code: "goal_not_found",
            message: `Goal not found: ${goalRunId}`,
            recoverable: true,
            suggestedNextTool: "goal.create",
            requiredInputShape: {
              objective: "string",
              ownerSessionId: "current runtime session id",
              workItemIds: ["existing work item id"],
              maximumAuthority: GOAL_AUTHORITY_LEVELS,
              escalationPolicy: GOAL_ESCALATION_POLICIES,
              authorityReason: "string",
              workflowProfile: "canonical workflow profile id",
            },
          },
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.start", {
          operation: "execution_started",
          id: goalRunId,
          errorCode: "not_found",
        }),
        isError: true,
      };
    }

    const explicitWorkItemId = readText(input.input.workItemId);
    const selected = explicitWorkItemId
      ? this.workItemStore.get(explicitWorkItemId)
      : undefined;
    const step = selectNextGoalExecutionStep({
      goalRun: goal,
      workItems: this.workItemStore.snapshot().items,
      governanceAssessment: {
        recommendation: input.input.governanceRecommendation === "orchestrate" ? "orchestrate" : "direct",
        reasons: readTextArray(input.input.governanceReasons),
        requiredEvidence: readTextArray(input.input.requiredEvidence),
      },
    });

    if (step.status !== "ready") {
      return {
        output: JSON.stringify({ status: "paused", step }, null, 2),
        isError: true,
      };
    }
    if (explicitWorkItemId && !selected) {
      return { output: `Work item not found: ${explicitWorkItemId}`, isError: true };
    }
    if (explicitWorkItemId && step.workItemId !== explicitWorkItemId) {
      return {
        output: JSON.stringify({
          status: "paused",
          reason: "Explicit work item is not the next ready item for this goal.",
          readyWorkItemId: step.workItemId,
          requestedWorkItemId: explicitWorkItemId,
        }, null, 2),
        isError: true,
      };
    }
    const managedInvocationId = readText(input.input.managedInvocationId);
    if (step.executionMode === "managed_delegation" && !managedInvocationId) {
      const managedResourceUris = readTextArray(input.input.managedResourceUris) ?? [];
      if (managedResourceUris.some((uri) => !isCanonicalArtifactContentUri(uri))) {
        return {
          output: "managedResourceUris must contain only canonical kiln://artifacts/<namespace>/<id>/content URIs.",
          isError: true,
        };
      }
      const managedInvocation = buildManagedInvocationRequest(goal, step, input.input);
      return {
        output: JSON.stringify({
          status: "paused",
          reason: "managedInvocationId is required before starting managed-delegation execution.",
          workItemId: step.workItemId,
          routeId: managedInvocation.routeId,
          agentProfile: managedInvocation.agentProfile,
          requiredEvidence: step.requiredEvidence,
          nextTool: "managed_agent.invoke",
          managedInvocationRequest: managedInvocation.request,
          ...(managedInvocation.missingFields.length > 0
            ? { missingManagedInvocationFields: managedInvocation.missingFields }
            : {}),
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.start", {
          operation: "execution_started",
          id: step.workItemId,
          status: step.workItem.status,
          item: step.workItem,
          sequence: step.workItem.sequence,
          executionScopeTransition: {
            action: "enter",
            scope: {
              kind: "work_item",
              goalRunId: goal.id,
              workItemId: step.workItemId,
            },
          },
        }),
        isError: true,
      };
    }
    const managedInvocationProof = managedInvocationId
      ? this.managedInvocationProofResolver?.(managedInvocationId)
      : undefined;
    if (step.executionMode === "managed_delegation" && !managedInvocationProof) {
      return {
        output: JSON.stringify({
          status: "paused",
          reason: "managedInvocationId is not a verified managed invocation for this runtime.",
          managedInvocationId,
          nextTool: "managed_agent.invoke",
        }, null, 2),
        isError: true,
      };
    }

    const workItem = this.workItemStore.get(step.workItemId)!;
    const attemptId = `${goal.id}:${workItem.id}:attempt:${workItem.executionAttempts.length + 1}`;
    if (!this.boundedWorkExecutionAttemptAdmission) {
      return {
        output: JSON.stringify({
          status: "paused",
          reason: "Bounded-work execution authority is unavailable on this surface.",
          errorCode: "bounded_work_authority_unavailable",
        }, null, 2),
        isError: true,
      };
    }
    const boundedAdmission = this.boundedWorkExecutionAttemptAdmission({ goal, workItem, attemptId });
    if (!boundedAdmission.admitted) {
      return {
        output: JSON.stringify({
          status: "paused",
          reason: boundedAdmission.message,
          errorCode: boundedAdmission.code,
        }, null, 2),
        isError: true,
      };
    }
    let startedAttemptId: string | undefined;
    try {
      const started = startGoalExecutionAttempt({
        goalRunStore: this.goalRunStore,
        workItemStore: this.workItemStore,
        goalRunId,
        workItemId: step.workItemId,
        executionMode: step.executionMode,
        summary: readText(input.input.summary),
        managedInvocationId,
        managedInvocationProof,
      });
      startedAttemptId = started.attempt.id;
      try {
        boundedAdmission.commit();
      } catch (commitError) {
        failGoalExecutionAttempt({
          goalRunStore: this.goalRunStore,
          workItemStore: this.workItemStore,
          goalRunId: goal.id,
          workItemId: workItem.id,
          attemptId: started.attempt.id,
          failureReason: "unavailable",
          summary: `Bounded-work accounting reconciliation required: ${commitError instanceof Error ? commitError.message : String(commitError)}`,
        });
        throw commitError;
      }
      return {
        output: JSON.stringify({
          status: "started",
          goal: goalToolOutputProjection(started.goal),
          item: workItemToolOutputProjection(started.item),
          attempt: executionAttemptToolOutputProjection(started.attempt),
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.start", {
          operation: "execution_started",
          id: started.item.id,
          status: started.item.status,
          goal: started.goal,
          item: started.item,
          attempt: started.attempt,
          sequence: started.item.sequence,
          executionScopeTransition: {
            action: "enter",
            scope: {
              kind: "work_item",
              goalRunId: started.goal.id,
              workItemId: started.item.id,
              attemptId: started.attempt.id,
              ...(started.attempt.managedInvocationId
                ? { managedInvocationId: started.attempt.managedInvocationId }
                : {}),
            },
          },
        }),
        isError: false,
      };
    } catch (error) {
      if (!startedAttemptId) boundedAdmission.release();
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

class WorkItemExecutionFinishTool implements DevTool {
  readonly name = "work_item.execution.finish";

  readonly description = [
    "Finish a work item execution attempt with evidence and residual-risk closeout.",
    "Blocks the item when expected evidence is missing and updates the owning goal state.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      goalRunId: { type: "string", minLength: 1, description: "Goal run id." },
      workItemId: { type: "string", minLength: 1, description: "Work item id." },
      attemptId: { type: "string", minLength: 1, description: "Execution attempt id." },
      providedEvidence: {
        type: "array",
        items: { type: "string", enum: EVIDENCE },
        description: "Evidence actually produced by the attempt. Never include a label that is skipped.",
      },
      residualRisk: { type: "string", description: "Residual-risk closeout." },
      skippedVerificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Expected verification labels intentionally skipped by the attempt. A skip accounts for the expectation without claiming evidence and requires residual-risk closeout.",
      },
      verificationGateResults: verificationGateResultsSchema(),
      managedOrchestrationAdoption: {
        type: "object",
        properties: {
          target: { type: "string", enum: [MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET] },
          adoptedBy: { type: "string", minLength: 1 },
          adoptedAt: { type: "string", minLength: 1 },
          resourceUris: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
          },
        },
        required: ["target", "adoptedBy", "adoptedAt", "resourceUris"],
        additionalProperties: false,
        description: "Structured managed orchestration adoption resolution for governed child output.",
      },
      summary: { type: "string", description: "Attempt result summary." },
      closeoutSummary: { type: "string", description: "Goal closeout summary if this attempt completes the final work item." },
    },
    required: ["goalRunId", "workItemId", "attemptId"],
    additionalProperties: false,
  };

  constructor(
    private readonly goalRunStore: GoalRunStore,
    private readonly workItemStore: WorkItemStore,
    private readonly boundedWorkCandidateCloseout?: BoundedWorkCandidateCloseout,
  ) {}

  async execute(input: ToolInput, _sandbox?: unknown, context?: DevToolExecutionContext): Promise<ToolResult> {
    const goalRunId = readText(input.input.goalRunId);
    const workItemId = readText(input.input.workItemId);
    const attemptId = readText(input.input.attemptId);
    if (!goalRunId || !workItemId || !attemptId) {
      return {
        output: 'Invalid input: "goalRunId", "workItemId", and "attemptId" must be non-empty strings',
        isError: true,
      };
    }

    let finishClaimed = false;
    try {
      const providedEvidence = readEvidence(input.input.providedEvidence);
      const verificationGateResults = readVerificationGateResults(input.input.verificationGateResults);
      const visualEvidence = validateVisualReferenceEvidence({
        providedEvidence,
        verificationGateResults,
      });
      if (!visualEvidence.ok) {
        return {
          output: `Invalid input: ${visualEvidence.code}: ${visualEvidence.message}`,
          isError: true,
        };
      }
      const goal = this.goalRunStore.get(goalRunId);
      const workItem = this.workItemStore.get(workItemId);
      const attempt = workItem?.executionAttempts.find((entry) => entry.id === attemptId);
      if (!goal || !workItem || !attempt) {
        return { output: "Bounded candidate closeout requires the current goal, work item, and attempt.", isError: true };
      }
      if (isTerminalWorkItemExecutionAttemptStatus(attempt.status)) {
        return {
          output: `Execution attempt '${attempt.id}' is already terminal (${attempt.status}) and cannot be finished again.`,
          isError: true,
        };
      }
      if (!this.boundedWorkCandidateCloseout) {
        return { output: "Bounded-work candidate capture authority is unavailable on this surface.", isError: true };
      }
      if (!this.workItemStore.claimExecutionAttemptFinish({ id: workItem.id, attemptId: attempt.id })) {
        return {
          output: `Execution attempt '${attempt.id}' is already being finished.`,
          isError: true,
        };
      }
      finishClaimed = true;
      const formalVerificationFinishTransport = readFormalVerificationFinishTransport(context, {
        kind: "work_item",
        goalRunId: goal.id,
        workItemId: workItem.id,
        attemptId: attempt.id,
        ...(hasOwn(attempt, "managedInvocationId")
          ? { managedInvocationId: attempt.managedInvocationId }
          : {}),
      }, this);
      const candidateCloseoutInput = {
        goal,
        workItem,
        attempt,
        providedEvidence,
        verificationGateResults,
        ...(formalVerificationFinishTransport
          ? { [FORMAL_VERIFICATION_FINISH_TRANSPORT]: formalVerificationFinishTransport }
          : {}),
      };
      const candidateCloseout = await this.boundedWorkCandidateCloseout(
        candidateCloseoutInput,
      );
      if (!candidateCloseout.captured) {
        this.workItemStore.releaseExecutionAttemptFinish({ id: workItem.id, attemptId: attempt.id });
        finishClaimed = false;
        return {
          output: JSON.stringify({ status: "paused", errorCode: candidateCloseout.code, reason: candidateCloseout.message }, null, 2),
          isError: true,
        };
      }
      const finished = finishGoalExecutionAttempt({
        goalRunStore: this.goalRunStore,
        workItemStore: this.workItemStore,
        goalRunId,
        workItemId,
        attemptId,
        providedEvidence,
        skippedVerificationGates: readTextArray(input.input.skippedVerificationGates),
        verificationGateResults,
        residualRisk: readText(input.input.residualRisk),
        summary: readText(input.input.summary),
        managedOrchestrationAdoption: readManagedOrchestrationAdoption(input.input.managedOrchestrationAdoption),
        closeoutSummary: readText(input.input.closeoutSummary),
        candidate: candidateCloseout.candidate,
        candidateEvidence: candidateCloseout.evidence,
        assuranceEvaluation: candidateCloseout.assuranceEvaluation,
      });
      this.workItemStore.releaseExecutionAttemptFinish({ id: workItem.id, attemptId: attempt.id });
      finishClaimed = false;
      const workItemBlockers = [
        ...finished.missingEvidence,
        ...finished.missingVerificationGates.map((gate) => `missing gate: ${gate}`),
        ...finished.failedVerificationGates.map((gate) => `failed gate: ${gate}`),
        ...(finished.missingResidualRisk ? ["residual-risk closeout"] : []),
      ];
      const missing = [
        ...workItemBlockers,
        ...finished.missingGoalEvidence,
      ];
      const status = workItemBlockers.length > 0
        ? "blocked"
        : finished.goal.status !== "completed"
          ? "work_completed_goal_closeout_pending"
          : "completed";
      return {
        output: JSON.stringify({
          status,
          missing,
          ...(finished.missingGoalEvidence.length > 0
            ? {
                nextTool: "goal.evidence.record",
                afterEvidenceTool: "goal.complete",
              }
            : {}),
          goal: goalToolOutputProjection(finished.goal),
          item: workItemToolOutputProjection(finished.item),
          attempt: executionAttemptToolOutputProjection(finished.attempt),
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.finish", {
          operation: "execution_finished",
          id: finished.item.id,
          status: finished.item.status,
          goal: finished.goal,
          item: finished.item,
          attempt: finished.attempt,
          missingEvidence: finished.missingEvidence,
          missingGoalEvidence: finished.missingGoalEvidence,
          missingVerificationGates: finished.missingVerificationGates,
          failedVerificationGates: finished.failedVerificationGates,
          missingResidualRisk: finished.missingResidualRisk,
          sequence: finished.item.sequence,
          ...(workItemBlockers.length === 0
            ? {
              executionScopeTransition: {
                action: "exit" as const,
                scope: {
                  kind: "work_item" as const,
                  goalRunId: finished.goal.id,
                  workItemId: finished.item.id,
                  attemptId: finished.attempt.id,
                  ...(finished.attempt.managedInvocationId
                    ? { managedInvocationId: finished.attempt.managedInvocationId }
                    : {}),
                },
              },
            }
            : {}),
          ...(workItemBlockers.length > 0 ? { errorCode: "missing_evidence" } : {}),
        }),
        isError: workItemBlockers.length > 0,
      };
    } catch (error) {
      if (finishClaimed) {
        this.workItemStore.releaseExecutionAttemptFinish({ id: workItemId, attemptId });
      }
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

class WorkItemExecutionFailTool implements DevTool {
  readonly name = "work_item.execution.fail";

  readonly description = [
    "Record a terminal managed child execution failure as missing work-item evidence.",
    "Blocks the item and keeps the owning goal paused without treating child failure as evidence.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      goalRunId: { type: "string", minLength: 1, description: "Goal run id." },
      workItemId: { type: "string", minLength: 1, description: "Work item id." },
      attemptId: { type: "string", minLength: 1, description: "Execution attempt id." },
      terminalStatus: {
        type: "string",
        enum: ["failed", "cancelled"],
        description: "Terminal attempt status. Defaults to failed, except cancelled failure reasons default to cancelled.",
      },
      failureReason: {
        type: "string",
        enum: WORK_ITEM_EXECUTION_FAILURE_REASONS,
        description: "Canonical execution failure reason.",
      },
      summary: { type: "string", minLength: 1, description: "Bounded execution failure summary." },
    },
    required: ["goalRunId", "workItemId", "attemptId", "failureReason", "summary"],
    additionalProperties: false,
  };

  constructor(
    private readonly goalRunStore: GoalRunStore,
    private readonly workItemStore: WorkItemStore,
  ) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const goalRunId = readText(input.input.goalRunId);
    const workItemId = readText(input.input.workItemId);
    const attemptId = readText(input.input.attemptId);
    const failureReason = readWorkItemExecutionFailureReason(input.input.failureReason);
    const summary = readText(input.input.summary);
    if (!goalRunId || !workItemId || !attemptId || !failureReason || !summary) {
      return {
        output: 'Invalid input: "goalRunId", "workItemId", "attemptId", "failureReason", and "summary" are required',
        isError: true,
      };
    }

    try {
      const failed = failGoalExecutionAttempt({
        goalRunStore: this.goalRunStore,
        workItemStore: this.workItemStore,
        goalRunId,
        workItemId,
        attemptId,
        terminalStatus: readExecutionFailureTerminalStatus(input.input.terminalStatus),
        failureReason,
        summary,
      });
      const missing = [
        ...failed.missingEvidence,
        ...failed.missingGoalEvidence,
        ...failed.missingVerificationGates.map((gate) => `missing gate: ${gate}`),
        ...failed.failedVerificationGates.map((gate) => `failed gate: ${gate}`),
        ...(failed.missingResidualRisk ? ["residual-risk closeout"] : []),
      ];
      return {
        output: JSON.stringify({
          status: "blocked",
          missing,
          goal: goalToolOutputProjection(failed.goal),
          item: workItemToolOutputProjection(failed.item),
          attempt: executionAttemptToolOutputProjection(failed.attempt),
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.fail", {
          operation: "execution_finished",
          id: failed.item.id,
          status: failed.item.status,
          goal: failed.goal,
          item: failed.item,
          attempt: failed.attempt,
          missingEvidence: failed.missingEvidence,
          missingGoalEvidence: failed.missingGoalEvidence,
          missingVerificationGates: failed.missingVerificationGates,
          failedVerificationGates: failed.failedVerificationGates,
          missingResidualRisk: failed.missingResidualRisk,
          sequence: failed.item.sequence,
          errorCode: "missing_evidence",
        }),
        isError: true,
      };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

function goalCreateContractError(input: {
  readonly code: "invalid_input";
  readonly message: string;
  readonly missingFields: readonly string[];
}): ToolResult {
  return {
    output: JSON.stringify({
      error: {
        code: input.code,
        message: input.message,
        recoverable: true,
        suggestedNextTool: input.missingFields.includes("workItemIds") ? "work_item.update" : "goal.create",
        requiredInputShape: {
          id: "stable goal id",
          objective: "string",
          ownerSessionId: "current runtime session id",
          workItemIds: ["existing work item id"],
          maximumAuthority: GOAL_AUTHORITY_LEVELS,
          escalationPolicy: GOAL_ESCALATION_POLICIES,
          authorityReason: "string",
          workflowProfile: "canonical workflow profile id",
          boundedWorkContract: "explicit kiln.bounded-work-contract/v2 contract",
          routePolicy: "choose preferredRouteId OR managedAgentProfile; if every linked work item already owns the same exact route and agent profile, omit both at goal level",
        },
        missingFields: input.missingFields,
      },
    }, null, 2),
    metadata: goalToolMetadata("goal.create", {
      operation: "create",
      errorCode: "invalid_input",
    }),
    isError: true,
  };
}

function linkWorkItemToGoal(item: WorkItem, goal: GoalRun): WorkItemUpsertInput {
  const goalOwnedRouteId = goal.routePolicy.managedAgentProfile ? undefined : goal.routePolicy.preferredRouteId;
  const routeId = item.routeId ?? goalOwnedRouteId;
  return {
    id: item.id,
    summary: item.summary,
    status: item.status,
    workflowProfile: item.workflowProfile,
    triggers: item.triggers,
    expectedEvidence: item.expectedEvidence,
    providedEvidence: item.providedEvidence,
    verificationGates: item.verificationGates,
    skippedVerificationGates: item.skippedVerificationGates,
    verificationGateResults: item.verificationGateResults,
    dependencies: item.dependencies,
    pauseRequirements: item.pauseRequirements,
    ...(goal.source.kind === "approved_plan" ? { planId: goal.source.planId } : {}),
    goalRunId: goal.id,
    executionAttempts: item.executionAttempts,
    ...(item.risk ? { risk: item.risk } : {}),
    ...(item.surface ? { surface: item.surface } : {}),
    ...(item.assignedAgentProfile ? { assignedAgentProfile: item.assignedAgentProfile } : {}),
    ...(routeId ? { routeId } : {}),
    ...(item.referenceRoots ? { referenceRoots: item.referenceRoots } : {}),
    ...(item.authority ? { authority: item.authority } : {}),
    ...(item.access ? { access: item.access } : {}),
    ...(item.residualRisk ? { residualRisk: item.residualRisk } : {}),
    ...(goal.source.kind === "approved_plan" && goal.source.planHash ? { planHash: goal.source.planHash } : {}),
    ...(item.sourceWorkItemId ? { sourceWorkItemId: item.sourceWorkItemId } : {}),
    ...(item.routingRecommendation ? { routingRecommendation: item.routingRecommendation } : {}),
  };
}

function readGoalAuthorityLevel(value: unknown): GoalRunAuthorityLevel | undefined {
  return GOAL_AUTHORITY_LEVELS.includes(value as GoalRunAuthorityLevel)
    ? value as GoalRunAuthorityLevel
    : undefined;
}

function readGoalEscalationPolicy(value: unknown): GoalRunEscalationPolicy | undefined {
  return GOAL_ESCALATION_POLICIES.includes(value as GoalRunEscalationPolicy)
    ? value as GoalRunEscalationPolicy
    : undefined;
}

function readGoalEvidenceRequirements(value: unknown):
  | { readonly ok: true; readonly requirements: readonly GoalRunEvidenceRequirement[] }
  | { readonly ok: false; readonly message: string } {
  if (value === undefined) {
    return { ok: true, requirements: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, message: "evidenceRequirements must be an array." };
  }
  const requirements: GoalRunEvidenceRequirement[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      return { ok: false, message: "Each evidence requirement must be an object." };
    }
    const record = candidate as Record<string, unknown>;
    const id = readText(record.id);
    const description = readText(record.description);
    if (!id || !description || typeof record.required !== "boolean") {
      return {
        ok: false,
        message: "Each evidence requirement must include id, description, and required.",
      };
    }
    requirements.push({ id, description, required: record.required });
  }
  return { ok: true, requirements };
}

function isRisk(value: unknown): value is KilnWorkGovernanceRisk {
  return RISKS.includes(value as KilnWorkGovernanceRisk);
}

function isTrigger(value: unknown): value is KilnWorkGovernanceTrigger {
  return TRIGGERS.includes(value as KilnWorkGovernanceTrigger);
}

function readStatus(value: unknown): WorkItemStatus | undefined {
  return WORK_ITEM_STATUSES.includes(value as WorkItemStatus) ? value as WorkItemStatus : undefined;
}

function readWorkItemExecutionFailureReason(value: unknown): WorkItemExecutionFailureReason | undefined {
  return WORK_ITEM_EXECUTION_FAILURE_REASONS.includes(value as WorkItemExecutionFailureReason)
    ? value as WorkItemExecutionFailureReason
    : undefined;
}

function readExecutionFailureTerminalStatus(value: unknown): "failed" | "cancelled" | undefined {
  return value === "failed" || value === "cancelled" ? value : undefined;
}

function readPauseRequirements(value: unknown):
  | { readonly ok: true; readonly requirements?: readonly WorkItemPauseRequirement[] }
  | { readonly ok: false; readonly message: string } {
  if (value === undefined || value === null) {
    return { ok: true };
  }
  if (!Array.isArray(value)) {
    return { ok: false, message: '"pauseRequirements" must be an array' };
  }
  const requirements: WorkItemPauseRequirement[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, message: '"pauseRequirements" entries must be objects' };
    }
    const record = candidate as Record<string, unknown>;
    const id = readText(record.id);
    const summary = readText(record.summary);
    const kind = readPauseRequirementKind(record.kind);
    const status = readPauseRequirementStatus(record.status);
    if (!id || !summary || !kind || !status) {
      return {
        ok: false,
        message: '"pauseRequirements" entries require id, kind, summary, and status',
      };
    }
    if (status === "resolved") {
      const resolvedBy = readText(record.resolvedBy);
      const resolvedAt = readText(record.resolvedAt);
      const resolution = readText(record.resolution);
      if (!resolvedBy || !resolvedAt || !resolution) {
        return {
          ok: false,
          message: '"pauseRequirements" entries with status "resolved" require resolvedBy, resolvedAt, and resolution',
        };
      }
      requirements.push({ id, kind, summary, status, resolvedBy, resolvedAt, resolution });
      continue;
    }
    if (status === "superseded") {
      const supersededByRequirementId = readText(record.supersededByRequirementId);
      const supersededAt = readText(record.supersededAt);
      const supersededBy = readText(record.supersededBy);
      const reason = readText(record.reason);
      if (!supersededByRequirementId || !supersededAt || !supersededBy || !reason) {
        return {
          ok: false,
          message: '"pauseRequirements" entries with status "superseded" require supersededByRequirementId, supersededAt, supersededBy, and reason',
        };
      }
      requirements.push({ id, kind, summary, status, supersededByRequirementId, supersededAt, supersededBy, reason });
      continue;
    }
    requirements.push({ id, kind, summary, status });
  }
  return { ok: true, requirements };
}

function readPauseRequirementKind(value: unknown): WorkItemPauseRequirementKind | undefined {
  return WORK_ITEM_PAUSE_REQUIREMENT_KINDS.includes(value as WorkItemPauseRequirementKind)
    ? value as WorkItemPauseRequirementKind
    : undefined;
}

function readPauseRequirementStatus(value: unknown): WorkItemPauseRequirementStatus | undefined {
  return WORK_ITEM_PAUSE_REQUIREMENT_STATUSES.includes(value as WorkItemPauseRequirementStatus)
    ? value as WorkItemPauseRequirementStatus
    : undefined;
}

function verificationGateResultsSchema(): Record<string, unknown> {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        gate: { type: "string", minLength: 1 },
        status: {
          type: "string",
          enum: ["passed", "failed", "skipped"],
          description: "passed means verified evidence; failed blocks closeout; skipped accounts for the gate without claiming evidence and requires residual risk.",
        },
        summary: { type: "string" },
        evidence: {
          type: "array",
          items: { type: "string" },
        },
        completedAt: { type: "string" },
      },
      required: ["gate", "status"],
      additionalProperties: false,
    },
    description: "Recorded verification gate results such as build, typecheck, test, review, or browser QA outcomes.",
  };
}

function readVerificationGateResults(value: unknown): readonly VerificationGateResult[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const results: VerificationGateResult[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const gate = readText(record.gate);
    const status = readVerificationGateResultStatus(record.status);
    if (!gate || !status || seen.has(gate)) {
      continue;
    }
    seen.add(gate);
    const summary = readText(record.summary);
    const completedAt = readText(record.completedAt);
    const evidence = readTextArray(record.evidence);
    results.push({
      gate,
      status,
      ...(summary ? { summary } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      ...(completedAt ? { completedAt } : {}),
    });
  }
  return results;
}

function readVerificationGateResultStatus(value: unknown): VerificationGateResult["status"] | undefined {
  return value === "passed" || value === "failed" || value === "skipped" ? value : undefined;
}

function mergeGateResults(
  existing: readonly VerificationGateResult[],
  incoming: readonly VerificationGateResult[],
): readonly VerificationGateResult[] {
  const byGate = new Map(existing.map((result) => [result.gate, result] as const));
  for (const result of incoming) byGate.set(result.gate, result);
  return [...byGate.values()];
}

class GoalEvidenceRecordTool implements DevTool {
  readonly name = "goal.evidence.record";
  readonly description = [
    "Record explicit structured evidence for one declared goal-level requirement.",
    "Use after the relevant work items produce the evidence and before goal.complete.",
  ].join(" ");
  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;
  readonly inputSchema = {
    type: "object",
    properties: {
      goalRunId: { type: "string", minLength: 1 },
      requirementId: { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1 },
      resourceUris: { type: "array", items: { type: "string", minLength: 1 } },
      workItemIds: { type: "array", items: { type: "string", minLength: 1 } },
    },
    required: ["goalRunId", "requirementId", "summary"],
    additionalProperties: false,
  };

  constructor(private readonly goalRunStore: GoalRunStore) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const goalRunId = readText(input.input.goalRunId);
    const requirementId = readText(input.input.requirementId);
    const summary = readText(input.input.summary);
    if (!goalRunId || !requirementId || !summary) {
      return {
        output: 'Invalid input: "goalRunId", "requirementId", and "summary" must be non-empty strings',
        isError: true,
      };
    }
    try {
      const goal = this.goalRunStore.recordEvidence({
        id: goalRunId,
        requirementId,
        summary,
        resourceUris: readTextArray(input.input.resourceUris),
        workItemIds: readTextArray(input.input.workItemIds),
      });
      return {
        output: JSON.stringify({ status: "recorded", goal: goalToolOutputProjection(goal) }, null, 2),
        metadata: goalToolMetadata("goal.evidence.record", {
          operation: "record_evidence",
          id: goal.id,
          goal,
          changedFields: ["evidence"],
          sequence: goal.sequence,
        }),
        isError: false,
      };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

class GoalCompleteTool implements DevTool {
  readonly name = "goal.complete";
  readonly description = [
    "Complete an active goal after every linked work item and required goal-level evidence record are complete.",
    "Fails closed and reports missing work or evidence.",
  ].join(" ");
  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;
  readonly inputSchema = {
    type: "object",
    properties: {
      goalRunId: { type: "string", minLength: 1 },
      closeoutSummary: { type: "string", minLength: 1 },
    },
    required: ["goalRunId"],
    additionalProperties: false,
  };

  constructor(
    private readonly goalRunStore: GoalRunStore,
    private readonly workItemStore: WorkItemStore,
    private readonly boundedWorkGoalCloseout?: BoundedWorkGoalCloseout,
  ) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const goalRunId = readText(input.input.goalRunId);
    if (!goalRunId) {
      return { output: 'Invalid input: "goalRunId" must be a non-empty string', isError: true };
    }
    try {
      const currentGoal = this.goalRunStore.get(goalRunId);
      if (!currentGoal || !this.boundedWorkGoalCloseout) {
        return { output: "Bounded-work goal closeout authority is unavailable.", isError: true };
      }
      const latestCandidateAttempt = currentGoal.workItemIds
        .flatMap((id) => this.workItemStore.get(id)?.executionAttempts ?? [])
        .filter((attempt) => attempt.status === "completed" && attempt.candidate !== undefined)
        .sort((left, right) => (left.completedAt ?? left.startedAt).localeCompare(right.completedAt ?? right.startedAt))
        .at(-1);
      const candidate = latestCandidateAttempt?.candidate;
      if (!candidate) return { output: "Goal closeout requires an exact captured candidate.", isError: true };
      const assuranceEvaluation = latestCandidateAttempt?.assuranceEvaluation;
      if (!assuranceEvaluation) {
        return { output: "Goal closeout requires the candidate's stored Assurance evaluation.", isError: true };
      }
      const closeout = await this.boundedWorkGoalCloseout({
        goal: currentGoal,
        candidate,
        ...(latestCandidateAttempt.candidateCaptureRoot
          ? { candidateCaptureRoot: latestCandidateAttempt.candidateCaptureRoot }
          : {}),
        candidateEvidence: latestCandidateAttempt.candidateEvidence ?? [],
        assuranceEvaluation,
      });
      if (closeout.kind !== "stop_acceptance_complete") {
        return { output: JSON.stringify({ status: "paused", decision: closeout }, null, 2), isError: true };
      }
      const goal = completeGoalExecution({
        goalRunStore: this.goalRunStore,
        workItemStore: this.workItemStore,
        goalRunId,
        closeoutSummary: readText(input.input.closeoutSummary),
        boundedWorkCloseoutDecision: closeout,
      });
      return {
        output: JSON.stringify({
          status: "completed",
          goal: goalToolOutputProjection(goal),
          boundedWorkCloseout: closeout,
        }, null, 2),
        metadata: goalToolMetadata("goal.complete", {
          operation: "complete",
          id: goal.id,
          goal,
          changedFields: ["status", "closeoutSummary", "boundedWorkCloseoutDecision"],
          sequence: goal.sequence,
        }),
        isError: false,
      };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

function readManagedOrchestrationAdoption(value: unknown): WorkItem["managedOrchestrationAdoption"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = requireInputRecord(value, "managedOrchestrationAdoption");
  const target = readText(record.target);
  const adoptedBy = readText(record.adoptedBy);
  const adoptedAt = readText(record.adoptedAt);
  const resourceUris = requireNonEmptyTextArray(
    record.resourceUris,
    "managedOrchestrationAdoption.resourceUris",
  );
  if (target !== MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET) {
    throw new Error(`Invalid input: managedOrchestrationAdoption.target must be ${MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET}.`);
  }
  if (!adoptedBy || !adoptedAt) {
    throw new Error("Invalid input: managedOrchestrationAdoption requires adoptedBy and adoptedAt.");
  }
  return {
    target,
    adoptedBy,
    adoptedAt,
    resourceUris,
  };
}

function requireNonEmptyTextArray(value: unknown, field: string): readonly string[] {
  const items = requireTextArray(value, field);
  if (items.length === 0) {
    throw new Error(`Invalid input: ${field} must include at least one non-empty string.`);
  }
  return items;
}

function requireTextArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid input: ${field} must be an array.`);
  }
  const items: string[] = [];
  for (const item of value) {
    const text = readText(item);
    if (!text) {
      throw new Error(`Invalid input: ${field} must contain only non-empty strings.`);
    }
    items.push(text);
  }
  return uniqueText(items);
}

function readTriggers(value: unknown): readonly KilnWorkGovernanceTrigger[] {
  return Array.isArray(value) ? uniqueText(value.filter(isTrigger)) as readonly KilnWorkGovernanceTrigger[] : [];
}

function readEvidence(value: unknown): readonly KilnWorkGovernanceEvidence[] {
  return Array.isArray(value) ? uniqueEvidence(value.filter(isKilnWorkGovernanceEvidence)) : [];
}

function readTextRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, recordValue]) => [key.trim(), readText(recordValue)] as const)
    .filter((entry): entry is readonly [string, string] => entry[0].length > 0 && typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readWorkClassificationInput(value: unknown): WorkClassificationInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const supportedFields = new Set(["intents", "artifacts", "domains", "evidenceScopes", "effects", "modes"]);
  for (const key of Object.keys(record)) {
    if (!supportedFields.has(key)) {
      throw new Error(`Unsupported work classification field: ${key}`);
    }
    if (!Array.isArray(record[key])) {
      throw new Error(`workClassification.${key} must be an array of strings`);
    }
  }
  return {
    ...(Array.isArray(record.intents) ? { intents: readTextArray(record.intents) } : {}),
    ...(Array.isArray(record.artifacts) ? { artifacts: readTextArray(record.artifacts) } : {}),
    ...(Array.isArray(record.domains) ? { domains: readTextArray(record.domains) } : {}),
    ...(Array.isArray(record.evidenceScopes) ? { evidenceScopes: readTextArray(record.evidenceScopes) } : {}),
    ...(Array.isArray(record.effects) ? { effects: readTextArray(record.effects) } : {}),
    ...(Array.isArray(record.modes) ? { modes: readTextArray(record.modes) } : {}),
  };
}

function isReadOnlyArchitectureReview(
  classification: WorkClassificationInput | undefined,
): boolean {
  if (!classification) {
    return false;
  }
  const effects = classification.effects ?? [];
  const intents = classification.intents ?? [];
  return effects.includes("read-only")
    && (intents.includes("analyze") || intents.includes("review"));
}

function readWorkClassificationProvenanceInput(
  value: unknown,
): WorkClassificationProvenanceInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const sourceKind = readText(record.sourceKind);
  const sourceId = readText(record.sourceId);
  if (!sourceKind || !sourceId) {
    return undefined;
  }
  return { sourceKind, sourceId };
}

function uniqueEvidence(values: readonly KilnWorkGovernanceEvidence[]): readonly KilnWorkGovernanceEvidence[] {
  return [...new Set(values)];
}
