import type {
  DevTool,
  ToolInput,
  ToolResult,
  WorkItemPauseRequirement,
  WorkItemPauseRequirementKind,
  WorkItemPauseRequirementStatus,
  WorkItemStatus,
} from "@kilnai/core";
import {
  finishGoalExecutionAttempt,
  GoalRunStore,
  selectNextGoalExecutionStep,
  startGoalExecutionAttempt,
  WorkItemStore,
  workItemToolMetadata,
} from "@kilnai/core";
import type { GoalExecutionStep, GoalRun } from "@kilnai/core";
import type {
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceEvidence,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";
import { assessWorkGovernance } from "./work-governance-policy.js";
import {
  chooseWorkflowProfile,
  findWorkflowProfile,
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
  "browser-qa",
  "managed-agent-review",
  "formal-proof",
  "residual-risk",
];

const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ["pending", "in_progress", "blocked", "completed", "cancelled"];
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
        enum: RISKS,
        description: "Optional preliminary risk estimate.",
      },
      triggers: {
        type: "array",
        items: { enum: TRIGGERS },
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
      triggers: { type: "array", items: { enum: TRIGGERS } },
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
      status: { enum: WORK_ITEM_STATUSES, description: "Optional lifecycle status." },
      workflowProfile: {
        enum: WORK_GOVERNANCE_WORKFLOW_PROFILES.map((profile) => profile.id),
        description: "Optional workflow profile. When omitted, Kiln infers one from triggers and risk.",
      },
      risk: { enum: RISKS, description: "Optional risk estimate." },
      triggers: {
        type: "array",
        items: { enum: TRIGGERS },
        description: "Governance triggers that apply to this work item.",
      },
      surface: { type: "string", description: "Optional affected surface, such as gui, cli, tui, runtime, or docs." },
      assignedAgentProfile: { type: "string", description: "Optional configured Kiln agent profile assigned to the work item." },
      routeId: { type: "string", description: "Optional managed invocation route id." },
      authorityProfile: { type: "string", description: "Optional authority profile for the assigned work." },
      expectedEvidence: {
        type: "array",
        items: { enum: EVIDENCE },
        description: "Optional extra or overriding evidence expected before closeout.",
      },
      providedEvidence: {
        type: "array",
        items: { enum: EVIDENCE },
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
            kind: { enum: WORK_ITEM_PAUSE_REQUIREMENT_KINDS },
            summary: { type: "string", minLength: 1 },
            status: { enum: WORK_ITEM_PAUSE_REQUIREMENT_STATUSES },
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
      ...workflowProfile.requiredEvidence,
      ...assessment.requiredEvidence,
      ...readEvidence(input.input.expectedEvidence),
    ]);
    const verificationGates = uniqueText([
      ...workflowProfile.verificationGates,
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

    return {
      output: JSON.stringify({ item }, null, 2),
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
      status: { enum: WORK_ITEM_STATUSES, description: "Optional status filter." },
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
        items: { enum: EVIDENCE },
        description: "Evidence produced for this work item.",
      },
      residualRisk: { type: "string", description: "Residual-risk closeout. Required when residual-risk is expected evidence." },
      skippedVerificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Verification gates intentionally skipped during closeout. Requires residual-risk closeout.",
      },
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
      residualRisk: readText(input.input.residualRisk),
    });
    if (!completion) {
      return { output: `Work item not found: ${id}`, isError: true };
    }

    const missing = [
      ...completion.missingEvidence,
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
        missingResidualRisk: completion.missingResidualRisk,
        sequence: completion.item.sequence,
      }),
      isError: false,
    };
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
        enum: MANAGED_INVOCATION_PROFILES,
        description: "Managed invocation authority profile to include in the suggested managed_agent.invoke request.",
      },
      requestedAuthority: {
        enum: MANAGED_INVOCATION_AUTHORITIES,
        description: "Requested child authority to include in the suggested managed_agent.invoke request.",
      },
      governanceRecommendation: {
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
      return { output: `Goal not found: ${goalRunId}`, isError: true };
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
        items: { enum: EVIDENCE },
        description: "Evidence produced by the attempt.",
      },
      residualRisk: { type: "string", description: "Residual-risk closeout." },
      skippedVerificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Verification gates intentionally skipped by the attempt. Requires residual-risk closeout.",
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
      const finished = finishGoalExecutionAttempt({
        goalRunStore: this.goalRunStore,
        workItemStore: this.workItemStore,
        goalRunId,
        workItemId,
        attemptId,
        providedEvidence: readEvidence(input.input.providedEvidence),
        skippedVerificationGates: readTextArray(input.input.skippedVerificationGates),
        residualRisk: readText(input.input.residualRisk),
        summary: readText(input.input.summary),
        closeoutSummary: readText(input.input.closeoutSummary),
      });
      const missing = [
        ...finished.missingEvidence,
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
  const routeId = step.workItem.routeId ?? step.workItem.routingRecommendation?.routeId ?? goal.routePolicy.preferredRouteId;
  const agentProfile = step.workItem.assignedAgentProfile
    ?? step.workItem.routingRecommendation?.agentProfile
    ?? goal.routePolicy.managedAgentProfile;
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
    missingFields: providerId ? [] : ["providerRoute.providerId"],
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
  if (value === undefined) {
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
