import type {
  ActionEffectEnvelope,
  DevTool,
  ManagedAgentResultHandoff,
  ToolInput,
  ToolResult,
  WorkItem,
  WorkItemExecutionFailureReason,
  WorkItemPauseRequirement,
  WorkItemPauseRequirementKind,
  WorkItemPauseRequirementStatus,
  WorkItemStatus,
  WorkClassificationInput,
  WorkClassificationProvenanceInput,
  VerificationGateResult,
  StructuredExecutionResult,
  VerificationUsageReport,
} from "@kilnai/core";
import {
  containsFrontendReferenceEvidence,
  defineStructuredExecutionResult,
  defineVerificationUsageReport,
  failGoalExecutionAttempt,
  finishGoalExecutionAttempt,
  goalToolMetadata,
  GoalRunStore,
  isCanonicalArtifactContentUri,
  MANAGED_ORCHESTRATION_ADOPTION_GATE_TARGET,
  selectNextGoalExecutionStep,
  startGoalExecutionAttempt,
  WorkItemStore,
  workItemToolMetadata,
} from "@kilnai/core";
import type {
  GoalExecutionStep,
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

const TRIGGERS: readonly KilnWorkGovernanceTrigger[] = [
  "architecture",
  "security",
  "ui",
  "runtime",
  "provider-routing",
  "managed-agents",
  "config",
  "multi-file",
  "cross-surface",
  "long-running",
  "verification-heavy",
  "formal-proof-candidate",
];

const RISKS: readonly KilnWorkGovernanceRisk[] = ["low", "medium", "high"];

const EVIDENCE: readonly KilnWorkGovernanceEvidence[] = [
  "surface-map",
  "risk-hypothesis",
  "spec",
  "plan",
  "tests",
  "typecheck",
  "visual-reference-research",
  "browser-qa",
  "managed-agent-review",
  "managed-orchestration:result-handoff",
  "managed-orchestration:completion-signal",
  "managed-orchestration:comparison-summary",
  "managed-orchestration:route-outcome",
  "managed-orchestration:adoption-gate",
  "managed-orchestration:diff",
  "managed-orchestration:verification",
  "managed-orchestration:review",
  "managed-orchestration:merge:compare-and-select",
  "managed-orchestration:merge:collect-all",
  "managed-orchestration:merge:first-success",
  "managed-orchestration:merge:manual-review-required",
  "managed-orchestration:merge:none",
  "formal-proof",
  "residual-risk",
];
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
const VISUAL_REFERENCE_PHASE_ROUTE = "visual-reference-research";
const VISUAL_REFERENCE_PHASE_ROUTE_PLACEHOLDER = "<read-only web/frontend-reference capable route id>";
const GOAL_AUTHORITY_LEVELS: readonly GoalRunAuthorityLevel[] = ["read_only", "audited", "destructive"];
const GOAL_ESCALATION_POLICIES: readonly GoalRunEscalationPolicy[] = ["deny", "approval_required"];
const WORK_ITEM_PAUSE_REQUIREMENT_KINDS: readonly WorkItemPauseRequirementKind[] = [
  "operator_input",
  "credentials",
  "approval",
  "authority_elevation",
  "capability",
];
const WORK_ITEM_PAUSE_REQUIREMENT_STATUSES: readonly WorkItemPauseRequirementStatus[] = ["pending", "resolved"];
const MANAGED_INVOCATION_PROFILES = [
  "foundation-readonly-plan",
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
] as const;
const MANAGED_INVOCATION_AUTHORITIES = ["auto", "read_only", "audited", "destructive"] as const;
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
type ManagedInvocationProfile = typeof MANAGED_INVOCATION_PROFILES[number];
type ManagedInvocationAuthority = typeof MANAGED_INVOCATION_AUTHORITIES[number];
type ReadyGoalExecutionStep = Extract<GoalExecutionStep, { readonly status: "ready" }>;
type ManagedInvocationPhaseId =
  | "visual-reference-research"
  | "surface-diagnosis"
  | "planning"
  | "implementation-verification"
  | "managed-review-closeout";

interface ManagedInvocationPhase {
  readonly id: ManagedInvocationPhaseId;
  readonly expectedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly requiredToolNames: readonly string[];
  readonly remainingEvidenceAfterPhase: readonly KilnWorkGovernanceEvidence[];
  readonly finalPhase: boolean;
  readonly completionTool: "work_item.update" | "work_item.execution.finish";
  readonly completionInstruction: string;
}

export function createWorkGovernanceTools(
  config: KilnWorkGovernanceConfig | undefined,
  options: {
    readonly workItemStore?: WorkItemStore;
    readonly goalRunStore?: GoalRunStore;
    readonly ownerSessionId?: string;
  } = {},
): readonly DevTool[] {
  const store = options.workItemStore ?? new WorkItemStore();
  const goalRunStore = options.goalRunStore ?? new GoalRunStore();
  return [
    new WorkGovernanceAssessTool(config),
    new WorkProfileListTool(),
    new WorkItemUpdateTool(config, store),
    new WorkItemListTool(store),
    new WorkItemCompleteTool(store),
    new GoalCreateTool(goalRunStore, store, options.ownerSessionId),
    new WorkItemExecutionStartTool(goalRunStore, store),
    new WorkItemExecutionFinishTool(goalRunStore, store),
    new WorkItemExecutionFailTool(goalRunStore, store),
  ];
}

export class WorkGovernanceAssessTool implements DevTool {
  readonly name = "work_governance.assess";

  readonly description = [
    "Assess whether a task should be handled directly or orchestrated through managed agents.",
    "Use before broad, risky, cross-surface, provider, runtime, UI, config, or verification-heavy work.",
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
      estimatedFiles: {
        type: "number",
        minimum: 0,
        description: "Optional estimated number of files the work may touch.",
      },
      risk: {
        type: "string",
        enum: RISKS,
        description: "Optional preliminary risk estimate.",
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

    const estimatedFiles = typeof input.input.estimatedFiles === "number" && Number.isFinite(input.input.estimatedFiles)
      ? input.input.estimatedFiles
      : undefined;
    const risk = isRisk(input.input.risk) ? input.input.risk : undefined;
    const triggers = Array.isArray(input.input.triggers)
      ? input.input.triggers.filter(isTrigger)
      : [];

    const assessment = assessWorkGovernance(this.config, {
      summary,
      estimatedFiles,
      risk,
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

export class WorkProfileListTool implements DevTool {
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
          recommendedAgentProfiles: profile.recommendedAgentProfiles,
          defaultAuthorityProfile: profile.defaultAuthorityProfile,
          requiredEvidence: profile.requiredEvidence,
          verificationGates: profile.verificationGates,
          evidenceMatrix: evidenceMatrixForWorkflowProfile(profile),
        })),
      }, null, 2),
      isError: false,
    };
  }
}

export class WorkItemUpdateTool implements DevTool {
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
        description: "Optional phase-specific managed route ids. For UI work on foundation-apply-approved-writes, set phaseRoutes.visual-reference-research to a read-only web/frontend-reference capable route; do not leave phaseRoutes empty and do not use the write route for frontend-reference research.",
      },
      referenceRoots: {
        type: "array",
        items: { type: "string", minLength: 1 },
        description: "Optional local reference roots the read-only research phase must be able to inspect, such as sibling cloned harness repositories. These are read requirements only, never write authority.",
      },
      authorityProfile: { type: "string", description: "Optional authority profile for the assigned work." },
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

    const triggers = readTriggers(input.input.triggers);
    const risk = isRisk(input.input.risk) ? input.input.risk : undefined;
    const explicitProfile = readText(input.input.workflowProfile);
    const workflowProfile = explicitProfile ? findWorkflowProfile(explicitProfile) : chooseWorkflowProfile(triggers, risk);
    if (!workflowProfile) {
      return { output: `Invalid input: unknown workflowProfile "${explicitProfile}"`, isError: true };
    }

    const assessment = assessWorkGovernance(this.config, {
      summary,
      risk,
      triggers,
    });
    const expectedEvidence = uniqueEvidence([
      ...requiredEvidenceForWorkflowProfile(workflowProfile),
      ...assessment.requiredEvidence,
      ...readEvidence(input.input.expectedEvidence),
    ]);
    const verificationGates = uniqueText([
      ...verificationGatesForWorkflowProfile(workflowProfile),
      ...readTextArray(input.input.verificationGates),
    ]);
    const existing = id ? this.store.get(id) : undefined;
    const routeId = readText(input.input.routeId);
    const authorityProfile = readText(input.input.authorityProfile) ?? workflowProfile.defaultAuthorityProfile;
    const phaseRoutes = readTextRecord(input.input.phaseRoutes) ?? existing?.phaseRoutes;
    const referenceRootsInput = readTextArray(input.input.referenceRoots);
    const referenceRoots = referenceRootsInput.length > 0 ? referenceRootsInput : existing?.referenceRoots;
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
    const phaseRouteContract = validatePhaseRouteContract({
      expectedEvidence,
      providedEvidence,
      routeId,
      authorityProfile,
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
    const pauseRequirements = readPauseRequirements(input.input.pauseRequirements);
    if (!pauseRequirements.ok) {
      return { output: `Invalid input: ${pauseRequirements.message}`, isError: true };
    }
    let item: WorkItem;
    try {
      const workClassification = readWorkClassificationInput(input.input.workClassification);
      const workClassificationProvenance = readWorkClassificationProvenanceInput(
        input.input.workClassificationProvenance,
      );
      item = this.store.upsert({
        id,
        summary,
        status: readStatus(input.input.status),
        workflowProfile: workflowProfile.id,
        risk,
        triggers,
        surface: readText(input.input.surface),
        assignedAgentProfile: readText(input.input.assignedAgentProfile),
        routeId,
        phaseRoutes,
        referenceRoots,
        authorityProfile,
        expectedEvidence,
        providedEvidence,
        verificationGates,
        verificationGateResults,
        dependencies: readTextArray(input.input.dependencies),
        residualRisk: readText(input.input.residualRisk),
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
        item,
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

export class WorkItemListTool implements DevTool {
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
      output: JSON.stringify({ items }, null, 2),
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

export class WorkItemCompleteTool implements DevTool {
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
        description: "Evidence produced for this work item.",
      },
      residualRisk: { type: "string", description: "Residual-risk closeout. Required when residual-risk is expected evidence." },
      skippedVerificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Verification gates intentionally skipped during closeout. Requires residual-risk closeout.",
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
    if (!completion) {
      return { output: `Work item not found: ${id}`, isError: true };
    }

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
          item: completion.item,
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
        item: completion.item,
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

export class GoalCreateTool implements DevTool {
  readonly name = "goal.create";

  readonly description = [
    "Create a governed goal run from existing work items and link those work items to the goal.",
    "Use this before work_item.execution.start; never invent a goalRunId without creating it through this tool.",
  ].join(" ");

  readonly effectEnvelope = WORK_GOVERNANCE_MUTATION_EFFECT;

  readonly inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional stable goal id. Omit to create a generated id." },
      objective: { type: "string", minLength: 1, description: "Operator-facing goal objective." },
      ownerSessionId: {
        type: "string",
        description: "Owning session id. Omit only when the runtime supplied the current session id.",
      },
      operatorTurnId: {
        type: "string",
        minLength: 1,
        description: "Operator turn that directly requested this goal. The runtime supplies it from canonical turn context.",
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
    },
    required: [
      "objective",
      "workItemIds",
      "maximumAuthority",
      "escalationPolicy",
      "authorityReason",
      "workflowProfile",
    ],
    additionalProperties: false,
  };

  constructor(
    private readonly goalRunStore: GoalRunStore,
    private readonly workItemStore: WorkItemStore,
    private readonly ownerSessionId?: string,
  ) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const objective = readText(input.input.objective);
    const operatorTurnId = readText(input.input.operatorTurnId);
    const workItemIds = readTextArray(input.input.workItemIds);
    const maximumAuthority = readGoalAuthorityLevel(input.input.maximumAuthority);
    const escalationPolicy = readGoalEscalationPolicy(input.input.escalationPolicy);
    const authorityReason = readText(input.input.authorityReason);
    const workflowProfile = readText(input.input.workflowProfile);
    const ownerSessionId = readText(input.input.ownerSessionId) ?? this.ownerSessionId;

    const missingFields = [
      ...(!objective ? ["objective"] : []),
      ...(!ownerSessionId ? ["ownerSessionId"] : []),
      ...(!operatorTurnId ? ["operatorTurnId"] : []),
      ...(workItemIds.length === 0 ? ["workItemIds"] : []),
      ...(!maximumAuthority ? ["maximumAuthority"] : []),
      ...(!escalationPolicy ? ["escalationPolicy"] : []),
      ...(!authorityReason ? ["authorityReason"] : []),
      ...(!workflowProfile ? ["workflowProfile"] : []),
    ];
    if (missingFields.length > 0) {
      return goalCreateContractError({
        code: "invalid_input",
        message: "goal.create requires objective, canonical operator-turn provenance, ownerSessionId, at least one workItemId, authority envelope, and workflowProfile.",
        missingFields,
      });
    }

    const goalObjective = objective!;
    const goalMaximumAuthority = maximumAuthority!;
    const goalEscalationPolicy = escalationPolicy!;
    const goalAuthorityReason = authorityReason!;
    const goalWorkflowProfile = workflowProfile!;
    const profile = findWorkflowProfile(goalWorkflowProfile);
    if (!profile) {
      return goalCreateContractError({
        code: "invalid_input",
        message: `Unknown workflowProfile "${goalWorkflowProfile}".`,
        missingFields: ["workflowProfile"],
      });
    }

    const evidenceRequirements = readGoalEvidenceRequirements(input.input.evidenceRequirements);
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

    try {
      const preferredRouteId = readText(input.input.preferredRouteId);
      const managedAgentProfile = readText(input.input.managedAgentProfile);
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
      const currentPhase = readText(input.input.currentPhase);
      const goal = this.goalRunStore.create({
        id: readText(input.input.id),
        objective: goalObjective,
        ownerSessionId: ownerSessionId!,
        source: {
          kind: "operator_direct",
          turnId: operatorTurnId!,
        },
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

export class WorkItemExecutionStartTool implements DevTool {
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
      managedReasoningEffort: {
        type: "string",
        description: "Optional reasoning effort to include in the suggested managed_agent.invoke request.",
      },
      managedResourceUris: {
        type: "array",
        items: { type: "string", minLength: 1 },
        description: "Canonical artifact content URIs to share with the managed child. Omit for fresh isolated context.",
      },
      managedProfile: {
        type: "string",
        enum: MANAGED_INVOCATION_PROFILES,
        description: "Managed invocation authority profile to include in the suggested managed_agent.invoke request.",
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
              operatorTurnId: "current operator turn id",
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

    try {
      const started = startGoalExecutionAttempt({
        goalRunStore: this.goalRunStore,
        workItemStore: this.workItemStore,
        goalRunId,
        workItemId: step.workItemId,
        executionMode: step.executionMode,
        summary: readText(input.input.summary),
        managedInvocationId,
      });
      return {
        output: JSON.stringify({
          status: "started",
          goal: started.goal,
          item: started.item,
          attempt: started.attempt,
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.start", {
          operation: "execution_started",
          id: started.item.id,
          status: started.item.status,
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
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

export class WorkItemExecutionFinishTool implements DevTool {
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
        description: "Evidence produced by the attempt.",
      },
      residualRisk: { type: "string", description: "Residual-risk closeout." },
      skippedVerificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Verification gates intentionally skipped by the attempt. Requires residual-risk closeout.",
      },
      verificationGateResults: verificationGateResultsSchema(),
      managedInvocationResultHandoff: {
        type: "object",
        properties: {
          summary: { type: "string", minLength: 1 },
          resourceUris: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
          },
          memoryWriteProposalUris: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          structuredResult: {
            type: "object",
            description: "Canonical structured execution result. Core validation rejects malformed control state.",
          },
          verificationUsage: {
            type: "object",
            description: "Independent verifier token, cost, latency, and evidence attribution.",
          },
        },
        required: ["summary", "resourceUris"],
        additionalProperties: false,
        description: "Raw managed invocation result handoff returned by managed_agent.invoke.",
      },
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
  ) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const goalRunId = readText(input.input.goalRunId);
    const workItemId = readText(input.input.workItemId);
    const attemptId = readText(input.input.attemptId);
    if (!goalRunId || !workItemId || !attemptId) {
      return {
        output: 'Invalid input: "goalRunId", "workItemId", and "attemptId" must be non-empty strings',
        isError: true,
      };
    }

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
        managedInvocationResultHandoff: requireManagedInvocationResultHandoff(input.input.managedInvocationResultHandoff),
        managedOrchestrationAdoption: readManagedOrchestrationAdoption(input.input.managedOrchestrationAdoption),
        closeoutSummary: readText(input.input.closeoutSummary),
      });
      const missing = [
        ...finished.missingEvidence,
        ...finished.missingGoalEvidence,
        ...finished.missingVerificationGates.map((gate) => `missing gate: ${gate}`),
        ...finished.failedVerificationGates.map((gate) => `failed gate: ${gate}`),
        ...(finished.missingResidualRisk ? ["residual-risk closeout"] : []),
      ];
      return {
        output: JSON.stringify({
          status: missing.length > 0 ? "blocked" : "completed",
          missing,
          goal: finished.goal,
          item: finished.item,
          attempt: finished.attempt,
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.finish", {
          operation: "execution_finished",
          id: finished.item.id,
          status: finished.item.status,
          item: finished.item,
          attempt: finished.attempt,
          missingEvidence: finished.missingEvidence,
          missingGoalEvidence: finished.missingGoalEvidence,
          missingVerificationGates: finished.missingVerificationGates,
          failedVerificationGates: finished.failedVerificationGates,
          missingResidualRisk: finished.missingResidualRisk,
          sequence: finished.item.sequence,
          ...(missing.length === 0
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
          ...(missing.length > 0 ? { errorCode: "missing_evidence" } : {}),
        }),
        isError: missing.length > 0,
      };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

export class WorkItemExecutionFailTool implements DevTool {
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
          goal: failed.goal,
          item: failed.item,
          attempt: failed.attempt,
        }, null, 2),
        metadata: workItemToolMetadata("work_item.execution.fail", {
          operation: "execution_finished",
          id: failed.item.id,
          status: failed.item.status,
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
          objective: "string",
          ownerSessionId: "current runtime session id",
          operatorTurnId: "current operator turn id",
          workItemIds: ["existing work item id"],
          maximumAuthority: GOAL_AUTHORITY_LEVELS,
          escalationPolicy: GOAL_ESCALATION_POLICIES,
          authorityReason: "string",
          workflowProfile: "canonical workflow profile id",
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
    ...(item.authorityProfile ? { authorityProfile: item.authorityProfile } : {}),
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

function buildManagedInvocationRequest(
  goal: GoalRun,
  step: ReadyGoalExecutionStep,
  input: Record<string, unknown>,
): {
  readonly routeId?: string;
  readonly agentProfile?: string;
  readonly missingFields: readonly string[];
  readonly request: Record<string, unknown>;
} {
  const phase = resolveManagedInvocationPhase(step);
  const phaseRequiresReadOnlyVisualResearch = phase.id === "visual-reference-research";
  const agentProfile = phaseRequiresReadOnlyVisualResearch
    ? undefined
    : step.workItem.assignedAgentProfile
    ?? step.workItem.routingRecommendation?.agentProfile
    ?? goal.routePolicy.managedAgentProfile;
  const goalOwnedRouteId = agentProfile ? undefined : goal.routePolicy.preferredRouteId;
  const routeId = phaseRequiresReadOnlyVisualResearch
    ? step.workItem.phaseRoutes?.[phase.id] ?? readText(input.managedResearchRouteId)
    : step.workItem.routeId ?? step.workItem.routingRecommendation?.routeId ?? goalOwnedRouteId;
  const providerId = readText(input.managedProviderId);
  const model = phaseRequiresReadOnlyVisualResearch && routeId
    ? undefined
    : readText(input.managedModel);
  const reasoningEffort = readText(input.managedReasoningEffort)
    ?? step.workItem.routingRecommendation?.reasoningEffort;
  const resourceUris = readTextArray(input.managedResourceUris) ?? [];
  if (resourceUris.some((uri) => !isCanonicalArtifactContentUri(uri))) {
    throw new Error("managedResourceUris must contain only canonical kiln://artifacts/<namespace>/<id>/content URIs.");
  }
  const expectedEvidence = phase.expectedEvidence;
  const residualRiskRequired = expectedEvidence.includes("residual-risk");
  const attemptId = `${goal.id}:${step.workItemId}:attempt:${step.workItem.executionAttempts.length + 1}`;
  const profile = phaseRequiresReadOnlyVisualResearch
    ? "foundation-readonly-plan"
    : readManagedInvocationProfile(step.workItem.authorityProfile)
    ?? readManagedInvocationProfile(input.managedProfile)
    ?? "foundation-readonly-plan";
  const request: Record<string, unknown> = {
    profile,
    ...(routeId ? { routeId } : {}),
    ...(phaseRequiresReadOnlyVisualResearch ? { forbiddenInputFields: ["agentProfile"] } : {}),
    ...(providerId
      ? {
        providerRoute: {
          providerId,
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
      }
      : {}),
    requestedAuthority: resolveManagedInvocationAuthority(profile, input, goal),
    task: formatManagedInvocationTask(goal, step, phase),
    summary: step.workItem.summary,
    contextMode: resourceUris.length > 0 ? "resources" : "isolated",
    ...(resourceUris.length > 0 ? { resourceUris } : {}),
    goalRunId: goal.id,
    workItemId: step.workItemId,
    attemptId,
    ...(step.workItem.workClassification ? { workClassification: step.workItem.workClassification } : {}),
    ...(agentProfile ? { agentProfile } : {}),
    roleIntent: `Execute governed work item ${step.workItemId} for goal ${goal.id}.`,
    executionPhase: {
      id: phase.id,
      expectedEvidence: phase.expectedEvidence,
      requiredToolNames: phase.requiredToolNames,
      remainingEvidenceAfterPhase: phase.remainingEvidenceAfterPhase,
      finalPhase: phase.finalPhase,
      completionTool: phase.completionTool,
      autoStartAllowed: phase.completionTool === "work_item.execution.finish",
      completionInstruction: phase.completionInstruction,
    },
    expectedEvidence,
    ...(phase.requiredToolNames.length > 0 ? { requiredToolNames: phase.requiredToolNames } : {}),
    ...(phaseRequiresReadOnlyVisualResearch && step.workItem.referenceRoots
      ? { requiredReadPaths: step.workItem.referenceRoots }
      : {}),
    requiredResultFields: managedInvocationResultFields(expectedEvidence),
    doneCriteria: managedInvocationDoneCriteria(step, phase),
    residualRiskRequired,
    outputVerbosity: "concise",
  };

  return {
    routeId,
    agentProfile,
    missingFields: providerId || routeId
      ? []
      : phaseRequiresReadOnlyVisualResearch
        ? ["providerRoute.providerId or managedResearchRouteId for read-only frontend-reference route"]
        : ["providerRoute.providerId"],
    request,
  };
}

function resolveManagedInvocationAuthority(
  profile: ManagedInvocationProfile,
  input: Record<string, unknown>,
  goal: GoalRun,
): ManagedInvocationAuthority {
  if (profile === "foundation-readonly-plan") {
    return "read_only";
  }
  const requestedAuthority = readManagedInvocationAuthority(input.requestedAuthority);
  if (requestedAuthority && requestedAuthority !== "read_only") {
    return requestedAuthority;
  }
  if (goal.authorityEnvelope.maximumAuthority !== "read_only") {
    return goal.authorityEnvelope.maximumAuthority;
  }
  return "audited";
}

function resolveManagedInvocationPhase(step: ReadyGoalExecutionStep): ManagedInvocationPhase {
  const missingEvidence = step.requiredEvidence
    .filter((evidence): evidence is KilnWorkGovernanceEvidence => isEvidence(evidence))
    .filter((evidence) => !step.workItem.providedEvidence.includes(evidence));
  const targetEvidence = firstMatchingPhaseEvidence(missingEvidence);
  const phaseId = phaseIdForEvidence(targetEvidence);
  const remainingEvidenceAfterPhase = missingEvidence.filter((evidence) => !targetEvidence.includes(evidence));
  const finalPhase = remainingEvidenceAfterPhase.length === 0;
  return {
    id: phaseId,
    expectedEvidence: targetEvidence,
    requiredToolNames: requiredToolNamesForPhaseEvidence(targetEvidence),
    remainingEvidenceAfterPhase,
    finalPhase,
    completionTool: finalPhase ? "work_item.execution.finish" : "work_item.update",
    completionInstruction: finalPhase
      ? "This is the final evidence phase. After managed invocation returns, link the invocation id with work_item.execution.start and close it with work_item.execution.finish."
      : "This is an intermediate evidence phase. After managed invocation returns, record only this phase evidence with work_item.update on the same pending work item, then call work_item.execution.start again for the next phase.",
  };
}

function firstMatchingPhaseEvidence(
  missingEvidence: readonly KilnWorkGovernanceEvidence[],
): readonly KilnWorkGovernanceEvidence[] {
  const uiReference = pickEvidence(missingEvidence, ["visual-reference-research"]);
  if (uiReference.length > 0) return uiReference;

  const diagnosis = pickEvidence(missingEvidence, ["surface-map", "risk-hypothesis"]);
  if (diagnosis.length > 0) return diagnosis;

  const planning = pickEvidence(missingEvidence, ["spec", "plan", "formal-proof"]);
  if (planning.length > 0) return planning;

  const verification = pickEvidence(missingEvidence, ["tests", "typecheck", "browser-qa"]);
  if (verification.length > 0) return verification;

  const closeout = pickEvidence(missingEvidence, ["managed-agent-review", "residual-risk"]);
  if (closeout.length > 0) return closeout;

  return missingEvidence;
}

function pickEvidence(
  missingEvidence: readonly KilnWorkGovernanceEvidence[],
  candidates: readonly KilnWorkGovernanceEvidence[],
): readonly KilnWorkGovernanceEvidence[] {
  return candidates.filter((evidence) => missingEvidence.includes(evidence));
}

function phaseIdForEvidence(evidence: readonly KilnWorkGovernanceEvidence[]): ManagedInvocationPhaseId {
  if (evidence.includes("visual-reference-research")) return "visual-reference-research";
  if (evidence.some((candidate) => candidate === "surface-map" || candidate === "risk-hypothesis")) {
    return "surface-diagnosis";
  }
  if (evidence.some((candidate) => candidate === "spec" || candidate === "plan" || candidate === "formal-proof")) {
    return "planning";
  }
  if (evidence.some((candidate) => candidate === "tests" || candidate === "typecheck" || candidate === "browser-qa")) {
    return "implementation-verification";
  }
  return "managed-review-closeout";
}

function requiredToolNamesForPhaseEvidence(evidence: readonly KilnWorkGovernanceEvidence[]): readonly string[] {
  return uniqueText([
    ...(evidence.includes("visual-reference-research")
      ? ["read", "glob", "grep"]
      : []),
    ...(evidence.includes("browser-qa")
      ? ["browser_session_start", "browser_navigate", "browser_observe"]
      : []),
  ]);
}

function formatManagedInvocationTask(
  goal: GoalRun,
  step: ReadyGoalExecutionStep,
  phase = resolveManagedInvocationPhase(step),
): string {
  const lines = [
    step.workItem.summary,
    `Goal: ${goal.objective}`,
    `Work item id: ${step.workItemId}`,
    `Execution phase: ${phase.id}.`,
  ];
  if (phase.expectedEvidence.length > 0) {
    lines.push(`Produce only this phase evidence: ${phase.expectedEvidence.join(", ")}.`);
  }
  if (phase.id === "visual-reference-research") {
    lines.push("Use read-only frontend-reference research authority. Prefer running-product UI captures when available. If the reference repository has no public screenshots, inspect the frontend implementation itself and produce code-backed evidence: component structure, layout/navigation model, spacing/typography/density, panels, work surfaces, composer-like interactions, status areas, and relevant frontend file paths. Local reference repositories are valid only when evidence cites concrete source paths and extracted UI principles. Repository chrome, stars/forks/issues, and raw file listings alone do not count.");
    if (step.workItem.referenceRoots && step.workItem.referenceRoots.length > 0) {
      lines.push(`Required reference roots: ${step.workItem.referenceRoots.join("; ")}.`);
      lines.push("Before recording visual-reference-research, inspect each required reference root enough to cite concrete frontend source paths or explicitly report why that root has no qualifying frontend implementation evidence. A raw file listing or analysis of only this Kiln repository does not satisfy this phase.");
    }
  }
  if (phase.requiredToolNames.length > 0) {
    lines.push(`This phase requires route tools: ${phase.requiredToolNames.join(", ")}.`);
  }
  if (phase.remainingEvidenceAfterPhase.length > 0) {
    lines.push(`Do not expand into later phases. Remaining evidence after this phase: ${phase.remainingEvidenceAfterPhase.join(", ")}.`);
  }
  if (step.workItem.verificationGates.length > 0) {
    lines.push(`Work item verification gates for final closeout: ${step.workItem.verificationGates.join("; ")}.`);
  }
  lines.push(phase.completionInstruction);
  lines.push("Return exactly one structured-execution-result-v1 JSON object with status, summary, limitations, operatorDecisions, evidence, citations, warnings, failures, approvalRequirements, residualRisks, and verificationResults. Include uncertainty when requested. Do not infer verification success from prose or include scratch notes, private planning text, or tool-output housekeeping.");
  return lines.join("\n");
}

function managedInvocationResultFields(expectedEvidence: readonly string[]): readonly string[] {
  return uniqueText([
    "summary",
    "evidence",
    "checks",
    ...(expectedEvidence.includes("residual-risk") ? ["residualRisk"] : []),
  ]);
}

function managedInvocationDoneCriteria(step: ReadyGoalExecutionStep, phase: ManagedInvocationPhase): readonly string[] {
  return uniqueText([
    ...(phase.finalPhase ? step.workItem.verificationGates : []),
    ...(phase.expectedEvidence.length > 0
      ? [`Produce phase evidence: ${phase.expectedEvidence.join(", ")}.`]
      : []),
    ...(phase.remainingEvidenceAfterPhase.length > 0
      ? [`Stop after phase ${phase.id}; record evidence with ${phase.completionTool} before requesting the next phase.`]
      : []),
    ...(phase.expectedEvidence.includes("residual-risk")
      ? ["Document residual risk before closeout."]
      : []),
  ]);
}

function validateVisualReferenceEvidence(input: {
  readonly providedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly verificationGateResults: readonly VerificationGateResult[];
}): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (!input.providedEvidence.includes("visual-reference-research")) {
    return { ok: true };
  }
  const passedVisualResults = input.verificationGateResults.filter((result) =>
    result.status === "passed" && isVisualReferenceGate(result.gate));
  if (passedVisualResults.length === 0) {
    return {
      ok: false,
      code: "visual_reference_product_ui_required",
      message: "visual-reference-research requires a passed frontend-reference verification gate with running-product UI capture evidence when available, or code-backed frontend implementation evidence when screenshots are unavailable.",
    };
  }
  const evidenceText = passedVisualResults
    .flatMap((result) => [
      result.summary ?? "",
      ...(result.evidence ?? []),
    ])
    .join("\n");
  if (
    containsPlaceholderVisualEvidence(evidenceText)
    || isRepositoryChromeOnlyEvidence(evidenceText)
    || !containsFrontendReferenceEvidence(evidenceText)
  ) {
    return {
      ok: false,
      code: "visual_reference_product_ui_required",
      message: "repository chrome, stars, forks, issues, README text, or raw file listings alone do not satisfy visual-reference-research; provide product UI capture evidence or code-backed frontend implementation evidence with source URLs or local source paths and relevant frontend file paths.",
    };
  }
  return { ok: true };
}

function containsPlaceholderVisualEvidence(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("<source url")
    || normalized.includes("<kiln://")
    || normalized.includes("<summarize")
    || normalized.includes("<artifact uri")
    || normalized.includes("placeholder");
}

function validatePhaseRouteContract(input: {
  readonly expectedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly providedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly routeId?: string;
  readonly authorityProfile?: string;
  readonly phaseRoutes?: Readonly<Record<string, string>>;
}): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  const requiresVisualReference = input.expectedEvidence.includes(VISUAL_REFERENCE_PHASE_ROUTE)
    && !input.providedEvidence.includes(VISUAL_REFERENCE_PHASE_ROUTE);
  if (!requiresVisualReference || !input.routeId || input.authorityProfile !== "foundation-apply-approved-writes") {
    return { ok: true };
  }
  if (readText(input.phaseRoutes?.[VISUAL_REFERENCE_PHASE_ROUTE])) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "visual_reference_phase_route_required",
    message: "UI work assigned to an approved-write route must declare phaseRoutes.visual-reference-research with a read-only web/frontend-reference capable route before visual-reference-research is accepted. Do not use the write route for frontend-reference research.",
  };
}

function isVisualReferenceGate(gate: string): boolean {
  const normalized = gate.toLowerCase();
  return normalized.includes("visual-reference")
    || normalized.includes("visual reference")
    || normalized.includes("frontend-reference")
    || normalized.includes("frontend reference")
    || normalized.includes("frontend implementation")
    || normalized.includes("real product screenshot")
    || normalized.includes("browser visual reference")
    || normalized.includes("source urls")
    || normalized.includes("source URLs");
}

function isRepositoryChromeOnlyEvidence(value: string): boolean {
  const normalized = value.toLowerCase();
  const mentionsGithubRepo = normalized.includes("github.com/")
    || normalized.includes("repository files navigation")
    || normalized.includes("github repo")
    || normalized.includes("repo page")
    || normalized.includes("stars")
    || normalized.includes("forks");
  if (!mentionsGithubRepo) {
    return false;
  }
  return !containsFrontendReferenceEvidence(value);
}

function readManagedInvocationProfile(value: unknown): ManagedInvocationProfile | undefined {
  return MANAGED_INVOCATION_PROFILES.includes(value as ManagedInvocationProfile)
    ? value as ManagedInvocationProfile
    : undefined;
}

function readManagedInvocationAuthority(value: unknown): ManagedInvocationAuthority | undefined {
  return MANAGED_INVOCATION_AUTHORITIES.includes(value as ManagedInvocationAuthority)
    ? value as ManagedInvocationAuthority
    : undefined;
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
    requirements.push({
      id,
      kind,
      summary,
      status,
      ...(readText(record.resolvedBy) ? { resolvedBy: readText(record.resolvedBy) } : {}),
      ...(readText(record.resolvedAt) ? { resolvedAt: readText(record.resolvedAt) } : {}),
      ...(readText(record.resolution) ? { resolution: readText(record.resolution) } : {}),
    });
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
        status: { type: "string", enum: ["passed", "failed", "skipped"] },
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

function requireManagedInvocationResultHandoff(
  value: unknown,
): ManagedAgentResultHandoff | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid input: managedInvocationResultHandoff must be an object.");
  }
  const record = value as Record<string, unknown>;
  const summary = readText(record.summary);
  const resourceUris = requireNonEmptyTextArray(
    record.resourceUris,
    "managedInvocationResultHandoff.resourceUris",
  );
  if (!summary) {
    throw new Error("Invalid input: managedInvocationResultHandoff.summary must be a non-empty string.");
  }
  const memoryWriteProposalUris = record.memoryWriteProposalUris === undefined
    ? []
    : requireTextArray(record.memoryWriteProposalUris, "managedInvocationResultHandoff.memoryWriteProposalUris");
  const structuredResult = record.structuredResult === undefined
    ? undefined
    : defineStructuredExecutionResult(record.structuredResult as StructuredExecutionResult);
  const verificationUsage = record.verificationUsage === undefined
    ? undefined
    : defineVerificationUsageReport(record.verificationUsage as Omit<VerificationUsageReport, "totals">);
  return {
    summary,
    resourceUris,
    memoryWriteProposalUris,
    ...(structuredResult ? { structuredResult } : {}),
    ...(verificationUsage ? { verificationUsage } : {}),
  };
}

function readManagedOrchestrationAdoption(value: unknown): WorkItem["managedOrchestrationAdoption"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid input: managedOrchestrationAdoption must be an object.");
  }
  const record = value as Record<string, unknown>;
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
  return Array.isArray(value) ? uniqueEvidence(value.filter(isEvidence)) : [];
}

function isEvidence(value: unknown): value is KilnWorkGovernanceEvidence {
  return EVIDENCE.includes(value as KilnWorkGovernanceEvidence);
}

function readTextArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? uniqueText(value.map(readText).filter((item): item is string => item !== undefined))
    : [];
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
  const supportedFields = new Set(["intents", "artifacts", "domains", "effects", "modes"]);
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
    ...(Array.isArray(record.effects) ? { effects: readTextArray(record.effects) } : {}),
    ...(Array.isArray(record.modes) ? { modes: readTextArray(record.modes) } : {}),
  };
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

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function uniqueEvidence(values: readonly KilnWorkGovernanceEvidence[]): readonly KilnWorkGovernanceEvidence[] {
  return [...new Set(values)];
}

function uniqueText(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
