import type {
  DevTool,
  ToolInput,
  ToolResult,
  WorkItem,
  WorkItemPauseRequirement,
  WorkItemPauseRequirementKind,
  WorkItemPauseRequirementStatus,
  WorkItemStatus,
  VerificationGateResult,
} from "@kilnai/core";
import {
  finishGoalExecutionAttempt,
  goalToolMetadata,
  GoalRunStore,
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
  "formal-proof",
  "residual-risk",
];

const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ["pending", "in_progress", "blocked", "completed", "cancelled"];
const WORK_ITEM_UPDATE_STATUSES: readonly WorkItemStatus[] = ["pending", "blocked", "completed", "cancelled"];
const GOAL_AUTHORITY_LEVELS: readonly GoalRunAuthorityLevel[] = ["read_only", "audited", "destructive"];
const GOAL_ESCALATION_POLICIES: readonly GoalRunEscalationPolicy[] = ["deny", "approval_required"];
const WORK_ITEM_PAUSE_REQUIREMENT_KINDS: readonly WorkItemPauseRequirementKind[] = [
  "operator_input",
  "credentials",
  "approval",
  "authority_elevation",
];
const WORK_ITEM_PAUSE_REQUIREMENT_STATUSES: readonly WorkItemPauseRequirementStatus[] = ["pending", "resolved"];
const MANAGED_INVOCATION_PROFILES = [
  "foundation-readonly-plan",
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
] as const;
const MANAGED_INVOCATION_AUTHORITIES = ["auto", "read_only", "audited", "destructive"] as const;
type ManagedInvocationProfile = typeof MANAGED_INVOCATION_PROFILES[number];
type ManagedInvocationAuthority = typeof MANAGED_INVOCATION_AUTHORITIES[number];
type ReadyGoalExecutionStep = Extract<GoalExecutionStep, { readonly status: "ready" }>;

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
  ];
}

export class WorkGovernanceAssessTool implements DevTool {
  readonly name = "work_governance.assess";

  readonly description = [
    "Assess whether a task should be handled directly or orchestrated through managed agents.",
    "Use before broad, risky, cross-surface, provider, runtime, UI, config, or verification-heavy work.",
  ].join(" ");

  readonly annotations = {
    readOnly: true,
    idempotent: true,
  };

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

  readonly annotations = {
    readOnly: true,
    idempotent: true,
  };

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

  readonly annotations = {
    readOnly: false,
    idempotent: false,
  };

  readonly inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional stable work item id. Omit to create a new id." },
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
      dependencies: {
        type: "array",
        items: { type: "string" },
        description: "Optional work item ids that must complete first.",
      },
      residualRisk: { type: "string", description: "Known residual risk, if already available." },
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
    required: ["summary"],
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
    const pauseRequirements = readPauseRequirements(input.input.pauseRequirements);
    if (!pauseRequirements.ok) {
      return { output: `Invalid input: ${pauseRequirements.message}`, isError: true };
    }

    const item = this.store.upsert({
      id: readText(input.input.id),
      summary,
      status: readStatus(input.input.status),
      workflowProfile: workflowProfile.id,
      risk,
      triggers,
      surface: readText(input.input.surface),
      assignedAgentProfile: readText(input.input.assignedAgentProfile),
      routeId: readText(input.input.routeId),
      authorityProfile: readText(input.input.authorityProfile) ?? workflowProfile.defaultAuthorityProfile,
      expectedEvidence,
      providedEvidence: readEvidence(input.input.providedEvidence),
      verificationGates,
      dependencies: readTextArray(input.input.dependencies),
      residualRisk: readText(input.input.residualRisk),
      pauseRequirements: pauseRequirements.requirements,
    });

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
  return {
    nextRequiredTools,
    nextAction: `Do not stop after scout or local read-only diagnosis. Create or use a goal, then call work_item.execution.start so governed execution, managed delegation, evidence, and residual risk are recorded.${routeSuffix}`,
  };
}

export class WorkItemListTool implements DevTool {
  readonly name = "work_item.list";

  readonly description = "List session governed work items and their evidence status.";

  readonly annotations = {
    readOnly: true,
    idempotent: true,
  };

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

  readonly annotations = {
    readOnly: false,
    idempotent: false,
  };

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

    const completion = this.store.complete({
      id,
      providedEvidence: readEvidence(input.input.providedEvidence),
      skippedVerificationGates: readTextArray(input.input.skippedVerificationGates),
      verificationGateResults: readVerificationGateResults(input.input.verificationGateResults),
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

  readonly annotations = {
    readOnly: false,
    idempotent: false,
  };

  readonly inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional stable goal id. Omit to create a generated id." },
      objective: { type: "string", minLength: 1, description: "Operator-facing goal objective." },
      ownerSessionId: {
        type: "string",
        description: "Owning session id. Omit only when the runtime supplied the current session id.",
      },
      planId: { type: "string", minLength: 1, description: "Approved plan id that owns this goal." },
      planHash: { type: "string", description: "Optional approved plan content hash." },
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
      "planId",
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
    const planId = readText(input.input.planId);
    const workItemIds = readTextArray(input.input.workItemIds);
    const maximumAuthority = readGoalAuthorityLevel(input.input.maximumAuthority);
    const escalationPolicy = readGoalEscalationPolicy(input.input.escalationPolicy);
    const authorityReason = readText(input.input.authorityReason);
    const workflowProfile = readText(input.input.workflowProfile);
    const ownerSessionId = readText(input.input.ownerSessionId) ?? this.ownerSessionId;

    const missingFields = [
      ...(!objective ? ["objective"] : []),
      ...(!ownerSessionId ? ["ownerSessionId"] : []),
      ...(!planId ? ["planId"] : []),
      ...(workItemIds.length === 0 ? ["workItemIds"] : []),
      ...(!maximumAuthority ? ["maximumAuthority"] : []),
      ...(!escalationPolicy ? ["escalationPolicy"] : []),
      ...(!authorityReason ? ["authorityReason"] : []),
      ...(!workflowProfile ? ["workflowProfile"] : []),
    ];
    if (missingFields.length > 0) {
      return goalCreateContractError({
        code: "invalid_input",
        message: "goal.create requires objective, ownerSessionId, planId, at least one workItemId, authority envelope, and workflowProfile.",
        missingFields,
      });
    }

    const goalObjective = objective!;
    const goalPlanId = planId!;
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
      const planHash = readText(input.input.planHash);
      const preferredRouteId = readText(input.input.preferredRouteId);
      const managedAgentProfile = readText(input.input.managedAgentProfile);
      if (preferredRouteId && managedAgentProfile) {
        return goalCreateContractError({
          code: "invalid_input",
          message: "goal.create cannot combine preferredRouteId and managedAgentProfile. Use managedAgentProfile when an agent profile owns route selection, or preferredRouteId when the caller owns the exact route.",
          missingFields: ["preferredRouteId", "managedAgentProfile"],
        });
      }
      const currentPhase = readText(input.input.currentPhase);
      const goal = this.goalRunStore.create({
        id: readText(input.input.id),
        objective: goalObjective,
        ownerSessionId: ownerSessionId!,
        planId: goalPlanId,
        ...(planHash ? { planHash } : {}),
        workItemIds,
        authorityEnvelope: {
          maximumAuthority: goalMaximumAuthority,
          escalationPolicy: goalEscalationPolicy,
          reason: goalAuthorityReason,
        },
        routePolicy: {
          workflowProfile: profile.id,
          ...(preferredRouteId ? { preferredRouteId } : {}),
          ...(managedAgentProfile ? { managedAgentProfile } : {}),
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

  readonly annotations = {
    readOnly: false,
    idempotent: false,
  };

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
      managedProfile: {
        type: "string",
        enum: MANAGED_INVOCATION_PROFILES,
        description: "Managed invocation authority profile to include in the suggested managed_agent.invoke request.",
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
              planId: "approved plan id",
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

  readonly annotations = {
    readOnly: false,
    idempotent: false,
  };

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
      const finished = finishGoalExecutionAttempt({
        goalRunStore: this.goalRunStore,
        workItemStore: this.workItemStore,
        goalRunId,
        workItemId,
        attemptId,
        providedEvidence: readEvidence(input.input.providedEvidence),
        skippedVerificationGates: readTextArray(input.input.skippedVerificationGates),
        verificationGateResults: readVerificationGateResults(input.input.verificationGateResults),
        residualRisk: readText(input.input.residualRisk),
        summary: readText(input.input.summary),
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
          ...(missing.length > 0 ? { errorCode: "missing_evidence" } : {}),
        }),
        isError: missing.length > 0,
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
          planId: "approved plan id",
          workItemIds: ["existing work item id"],
          maximumAuthority: GOAL_AUTHORITY_LEVELS,
          escalationPolicy: GOAL_ESCALATION_POLICIES,
          authorityReason: "string",
          workflowProfile: "canonical workflow profile id",
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
    planId: goal.planId,
    goalRunId: goal.id,
    executionAttempts: item.executionAttempts,
    ...(item.risk ? { risk: item.risk } : {}),
    ...(item.surface ? { surface: item.surface } : {}),
    ...(item.assignedAgentProfile ? { assignedAgentProfile: item.assignedAgentProfile } : {}),
    ...(routeId ? { routeId } : {}),
    ...(item.authorityProfile ? { authorityProfile: item.authorityProfile } : {}),
    ...(item.residualRisk ? { residualRisk: item.residualRisk } : {}),
    ...(goal.planHash ? { planHash: goal.planHash } : {}),
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
  const agentProfile = step.workItem.assignedAgentProfile
    ?? step.workItem.routingRecommendation?.agentProfile
    ?? goal.routePolicy.managedAgentProfile;
  const goalOwnedRouteId = agentProfile ? undefined : goal.routePolicy.preferredRouteId;
  const routeId = step.workItem.routeId ?? step.workItem.routingRecommendation?.routeId ?? goalOwnedRouteId;
  const providerId = readText(input.managedProviderId);
  const model = readText(input.managedModel);
  const reasoningEffort = readText(input.managedReasoningEffort)
    ?? step.workItem.routingRecommendation?.reasoningEffort;
  const expectedEvidence = step.requiredEvidence;
  const residualRiskRequired = expectedEvidence.includes("residual-risk");
  const request: Record<string, unknown> = {
    profile: readManagedInvocationProfile(input.managedProfile)
      ?? readManagedInvocationProfile(step.workItem.authorityProfile)
      ?? "foundation-readonly-plan",
    ...(routeId ? { routeId } : {}),
    ...(providerId
      ? {
        providerRoute: {
          providerId,
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
      }
      : {}),
    requestedAuthority: readManagedInvocationAuthority(input.requestedAuthority)
      ?? readManagedInvocationAuthority(step.workItem.authorityProfile)
      ?? goal.authorityEnvelope.maximumAuthority,
    task: formatManagedInvocationTask(goal, step),
    summary: step.workItem.summary,
    workItemId: step.workItemId,
    ...(agentProfile ? { agentProfile } : {}),
    roleIntent: `Execute governed work item ${step.workItemId} for goal ${goal.id}.`,
    expectedEvidence,
    requiredResultFields: managedInvocationResultFields(expectedEvidence),
    doneCriteria: managedInvocationDoneCriteria(step),
    residualRiskRequired,
  };

  return {
    routeId,
    agentProfile,
    missingFields: providerId || routeId ? [] : ["providerRoute.providerId"],
    request,
  };
}

function formatManagedInvocationTask(goal: GoalRun, step: ReadyGoalExecutionStep): string {
  const lines = [
    step.workItem.summary,
    `Goal: ${goal.objective}`,
    `Work item id: ${step.workItemId}`,
  ];
  if (step.requiredEvidence.length > 0) {
    lines.push(`Produce evidence: ${step.requiredEvidence.join(", ")}.`);
  }
  if (step.workItem.verificationGates.length > 0) {
    lines.push(`Verification gates: ${step.workItem.verificationGates.join("; ")}.`);
  }
  lines.push("Return a concise handoff with summary, evidence, checks, and residual risk when required.");
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

function managedInvocationDoneCriteria(step: ReadyGoalExecutionStep): readonly string[] {
  return uniqueText([
    ...step.workItem.verificationGates,
    ...(step.requiredEvidence.length > 0
      ? [`Produce required evidence: ${step.requiredEvidence.join(", ")}.`]
      : []),
    ...(step.requiredEvidence.includes("residual-risk")
      ? ["Document residual risk before closeout."]
      : []),
  ]);
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
