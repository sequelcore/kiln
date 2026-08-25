import { isAbsolute, relative, resolve } from "node:path";
import type {
  ActionEffectEnvelope,
  AnalysisStateStore,
  AuthorityStateStore,
  AuthorityDescriptor,
  Capability,
  DevTool,
  DefaultBuiltinToolSurface,
  DefaultBuiltinToolRegistryOptions,
  DiscoveredDirectProviderModelCapabilities,
  ManagedAgentAdmissionProfile,
  ManagedAgentCallerAttachmentIdentity,
  InvocationAdmission,
  ToolDefinition,
  ToolResultMetadata,
  ToolResourceDisplayDescriptor,
  ToolResourceReadOptions,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
  SpecificationStateStore,
  ToolResultContentPart,
  WorkItemStore,
} from "@kilnai/core";
import type { PlanStateStore, SessionPlan, WorkflowProfile } from "@kilnai/core";
import {
  createDefaultBuiltinToolSurface,
  createSessionBuiltinToolOptions,
  isDirectProviderId,
  projectDevToolCapabilities,
  projectDevToolDefinitions,
  projectToolResourceDescriptor,
  projectToolResultResourceLinks,
  ResourceListTool,
  ResourceReadTool,
  ResourceTemplateListTool,
  resolveDirectProviderExecutionProfile,
  getBuiltinEffectEnvelope,
  knownModelCommunicationCapabilities,
} from "@kilnai/core";
import type {
  OperatorExecutionMode,
  OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";
import { OPERATOR_THEME_NAMES, isOperatorThemeName } from "@kilnai/operator-appearance";
import {
  FORMAL_VERIFICATION_FINISH_TRANSPORT,
  OPERATOR_ADOPTION_DECISION_TRANSPORT,
  parseFormalVerificationToolResultMetadata,
  type DevToolExecutionContext,
  type FormalVerificationFinishExecutionScope,
  type FormalVerificationFinishTransportEnvelope,
  type FormalVerificationFinishTransportObservation,
} from "@kilnai/core/tools";
import type {
  OperatorSurfaceController,
  OperatorSurfaceThemeController,
} from "../operator/operator-surface-controller.js";
import type {
  PerCallToolConfig,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
} from "../session/runtime-session-orchestrator.js";
import type { RuntimeAuthorityAdmissionCandidateConfig } from "../session/runtime-session-orchestrator.types.js";
import { isRuntimeOwnedFormalVerificationObservation } from "../work-governance/formal-verification-observations.js";
import { runRuntimeFormalVerificationFinishInvocation } from "../work-governance/formal-verification-invocation-state.js";
import type { EffectiveTurnAuthorityAdmissionContext } from "../session/effective-turn-authority.js";
import { projectEffectiveTurnAuthorityPerCallConfig } from "../session/effective-turn-authority.js";
import {
  createManagedAgentStartToolDefinition,
  createManagedAgentInvokeToolDefinition,
  createManagedAgentOrchestrateToolDefinition,
  createManagedInvocationToolCallMetadataResolver,
  createManagedInvocationToolExecutor,
  createManagedInvocationLifecycleToolExecutors,
  MANAGED_AGENT_CANCEL_CAPABILITY,
  MANAGED_AGENT_CANCEL_TOOL,
  MANAGED_AGENT_JOIN_CAPABILITY,
  MANAGED_AGENT_JOIN_TOOL,
  MANAGED_AGENT_LIST_CAPABILITY,
  MANAGED_AGENT_LIST_TOOL,
  MANAGED_AGENT_ORCHESTRATE_CAPABILITY,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  MANAGED_AGENT_START_CAPABILITY,
  MANAGED_AGENT_START_TOOL,
  MANAGED_AGENT_STATUS_CAPABILITY,
  MANAGED_AGENT_STATUS_TOOL,
  resolveManagedInvocationRouteProfile,
  resolveManagedInvocationService,
  type ManagedInvocationToolOptions,
  type ManagedInvocationToolAttachment,
  type ManagedInvocationBoundedWorkAdmission,
} from "../agents/managed-invocation/runtime-tool/index.js";
import { resolveManagedInvocationAgentProfile } from "../agents/managed-invocation/agent-profile-catalog.js";
import {
  createManagedAgentInvocationResourceProvider,
  isManagedAgentInvocationResourceProvider,
} from "../agents/managed-invocation/resource-provider.js";
import {
  buildManagedInvocationPhaseRecovery,
  managedInvocationFailureReasonFromStatus,
} from "../agents/managed-invocation/phase-recovery.js";
import { authorityFromCapability } from "./tool-authority.js";
import type { SqliteBoundedWorkAuthority } from "../work-governance/index.js";

export interface AttachedRuntimeBuiltinToolSurface {
  readonly callBuiltinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly materializableTools: ReadonlyMap<string, ToolDefinition>;
  readonly materializableCapabilities: ReadonlyMap<string, Capability>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor>;
  readonly toolInvocationAdmission?: InvocationAdmission;
  readonly toolCallMetadata: NonNullable<PerCallToolConfig["toolCallMetadata"]>;
  readonly analysisStateStore?: AnalysisStateStore;
  readonly authorityStateStore?: AuthorityStateStore;
  readonly planStateStore?: PlanStateStore;
  readonly specificationStateStore?: SpecificationStateStore;
  listResources(): readonly ToolResourceDisplayDescriptor[];
  listResourceTemplates(): readonly ToolResourceTemplateDescriptor[];
  readResource(uri: string, options?: ToolResourceReadOptions): Promise<ToolResourceReadResult>;
  dispose(): Promise<void>;
}

export type AttachedRuntimeManagedInvocationConfig =
  | ManagedInvocationToolAttachment
  | (ManagedInvocationToolOptions & {
    readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  });

export interface AttachedRuntimeBuiltinToolSurfaceOptions {
  readonly operatorSurface?: OperatorSurfaceController;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly executionMode?: OperatorExecutionMode;
  readonly managedInvocation?: AttachedRuntimeManagedInvocationConfig;
  readonly boundedWork?: {
    readonly projectRuntimeId: string;
    readonly authority: SqliteBoundedWorkAuthority;
  };
}

const RUNTIME_OBSERVE_METADATA_EGRESS: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const RUNTIME_IDEMPOTENT_MUTATE_LOCAL: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};

const DEFAULT_CORE_BUILTIN_TOOL_SURFACE = createDefaultBuiltinToolSurface();
const DEFAULT_BUILTIN_TOOL_SURFACE: AttachedRuntimeBuiltinToolSurface = buildRuntimeSurface(
  DEFAULT_CORE_BUILTIN_TOOL_SURFACE,
);
const WORK_ITEM_EXECUTION_START_TOOL_NAME = "work_item.execution.start";

const OPERATOR_SET_THEME_TOOL: ToolDefinition = {
  name: "operator_set_theme",
  description: "Change the theme of the connected live operator surface for this session.",
  inputSchema: {
    type: "object",
    properties: {
      theme: {
        type: "string",
        enum: OPERATOR_THEME_NAMES,
        description: "Theme name to apply.",
      },
      reason: {
        type: "string",
        description: "Short operator-facing reason for changing the theme.",
      },
    },
    required: ["theme"],
    additionalProperties: false,
  },
  tags: new Set<string>(["operator-ui"]),
};

const OPERATOR_SET_THEME_CAPABILITY: Capability = {
  name: OPERATOR_SET_THEME_TOOL.name,
  description: OPERATOR_SET_THEME_TOOL.description,
  schema: OPERATOR_SET_THEME_TOOL.inputSchema,
  tags: ["operator-ui"],
  effectEnvelope: RUNTIME_IDEMPOTENT_MUTATE_LOCAL,
};

const SUBMIT_PLAN_TOOL: ToolDefinition = {
  name: "submit_plan",
  description: "Submit a structured governed plan artifact for operator review. This tool is only available while the turn runs in plan mode and must not perform implementation work.",
  inputSchema: {
    type: "object",
    properties: {
      planId: {
        type: "string",
        description: "Optional plan id to update. Omit to create a new plan artifact.",
      },
      objective: { type: "string" },
      nonGoals: { type: "array", items: { type: "string" } },
      operatorDecisionsRequired: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      affectedSurfaces: { type: "array", items: { type: "string" } },
      riskClassification: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
      },
      workGovernanceRecommendation: {
        type: "object",
        properties: {
          posture: {
            type: "string",
            enum: ["direct", "orchestrate", "delegate"],
          },
          rationale: { type: "string" },
          workflowProfile: {
            type: "string",
            enum: [
              "small-fix",
              "bug-diagnosis",
              "architecture-review",
              "architecture-change",
              "ui-change",
              "managed-agent-change",
              "config-change",
              "verification-heavy",
              "formal-proof-candidate",
            ],
          },
        },
        required: ["posture", "rationale", "workflowProfile"],
        additionalProperties: false,
      },
      proposedWorkItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            summary: { type: "string" },
            workflowProfile: {
              type: "string",
              enum: [
                "small-fix",
                "bug-diagnosis",
                "architecture-review",
                "architecture-change",
                "ui-change",
                "managed-agent-change",
                "config-change",
                "verification-heavy",
                "formal-proof-candidate",
              ],
            },
            risk: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
            expectedEvidence: {
              type: "array",
              items: { type: "string" },
            },
            verificationGates: {
              type: "array",
              items: { type: "string" },
            },
            dependencies: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "id",
            "summary",
            "workflowProfile",
            "risk",
            "expectedEvidence",
            "verificationGates",
            "dependencies",
          ],
          additionalProperties: false,
        },
      },
      expectedEvidence: { type: "array", items: { type: "string" } },
      verificationGates: { type: "array", items: { type: "string" } },
      managedAgentDelegationCandidates: { type: "array", items: { type: "string" } },
      approvalBoundaries: { type: "array", items: { type: "string" } },
      rollbackNotes: { type: "string" },
      residualRisks: { type: "array", items: { type: "string" } },
      sourceSpecificationId: { type: "string" },
      clarificationRecordIds: { type: "array", items: { type: "string" } },
      constitutionSnapshot: {
        type: "object",
        properties: {
          instructionProfileHash: { type: "string" },
          instructionProfileIds: { type: "array", items: { type: "string" } },
        },
        required: ["instructionProfileHash", "instructionProfileIds"],
        additionalProperties: false,
      },
    },
    required: [
      "objective",
      "nonGoals",
      "operatorDecisionsRequired",
      "assumptions",
      "affectedSurfaces",
      "riskClassification",
      "workGovernanceRecommendation",
      "proposedWorkItems",
      "expectedEvidence",
      "verificationGates",
      "managedAgentDelegationCandidates",
      "approvalBoundaries",
      "rollbackNotes",
      "residualRisks",
      "sourceSpecificationId",
      "clarificationRecordIds",
      "constitutionSnapshot",
    ],
    additionalProperties: false,
  },
  tags: new Set<string>(["operator-mode", "planning"]),
};

const SUBMIT_PLAN_CAPABILITY: Capability = {
  name: SUBMIT_PLAN_TOOL.name,
  description: SUBMIT_PLAN_TOOL.description,
  schema: SUBMIT_PLAN_TOOL.inputSchema,
  tags: ["operator-mode", "planning"],
  effectEnvelope: RUNTIME_OBSERVE_METADATA_EGRESS,
};

const SUBMIT_SPECIFICATION_TOOL: ToolDefinition = {
  name: "submit_specification",
  description: "Submit or update a structured feature specification during plan mode. The runtime validates ambiguity and missing sections before plan approval.",
  inputSchema: {
    type: "object",
    properties: {
      specificationId: {
        type: "string",
        description: "Optional specification id to update. Omit to create a new specification.",
      },
      title: {
        type: "string",
        description: "Short specification title.",
      },
      objective: {
        type: "string",
        description: "What should be built and why.",
      },
      nonGoals: {
        type: "array",
        items: { type: "string" },
      },
      successCriteria: {
        type: "array",
        items: { type: "string" },
      },
      actors: {
        type: "array",
        items: { type: "string" },
      },
      dataLifecycle: {
        type: "string",
        description: "How input data is received, processed, stored, and deleted.",
      },
      uxEdgeCases: {
        type: "array",
        items: { type: "string" },
      },
      securityPrivacy: {
        type: "string",
        description: "Security/privacy posture and constraints.",
      },
      externalDependencies: {
        type: "array",
        items: { type: "string" },
      },
      completionSignals: {
        type: "array",
        items: { type: "string" },
      },
      constitutionSnapshot: {
        type: "object",
        properties: {
          instructionProfileHash: { type: "string" },
          instructionProfileIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["instructionProfileHash", "instructionProfileIds"],
        additionalProperties: false,
      },
    },
    required: [
      "title",
      "objective",
      "nonGoals",
      "successCriteria",
      "actors",
      "dataLifecycle",
      "uxEdgeCases",
      "securityPrivacy",
      "externalDependencies",
      "completionSignals",
      "constitutionSnapshot",
    ],
    additionalProperties: false,
  },
  tags: new Set<string>(["operator-mode", "planning", "specification"]),
};

const SUBMIT_SPECIFICATION_CAPABILITY: Capability = {
  name: SUBMIT_SPECIFICATION_TOOL.name,
  description: SUBMIT_SPECIFICATION_TOOL.description,
  schema: SUBMIT_SPECIFICATION_TOOL.inputSchema,
  tags: ["operator-mode", "planning", "specification"],
  effectEnvelope: RUNTIME_OBSERVE_METADATA_EGRESS,
};

const RECORD_CLARIFICATION_TOOL: ToolDefinition = {
  name: "record_clarification",
  description: "Record a clarification answer against a structured specification during plan mode.",
  inputSchema: {
    type: "object",
    properties: {
      specificationId: { type: "string" },
      question: { type: "string" },
      answer: { type: "string" },
      affectedSection: { type: "string" },
      rationale: { type: "string" },
    },
    required: ["specificationId", "question", "answer", "affectedSection", "rationale"],
    additionalProperties: false,
  },
  tags: new Set<string>(["operator-mode", "planning", "specification"]),
};

const RECORD_CLARIFICATION_CAPABILITY: Capability = {
  name: RECORD_CLARIFICATION_TOOL.name,
  description: RECORD_CLARIFICATION_TOOL.description,
  schema: RECORD_CLARIFICATION_TOOL.inputSchema,
  tags: ["operator-mode", "planning", "specification"],
  effectEnvelope: RUNTIME_OBSERVE_METADATA_EGRESS,
};

const GOAL_CREATE_TOOL_NAME = "goal.create";
const GOAL_CONTRACT_SUPERSEDE_TOOL_NAME = "goal.bounded_work_contract.supersede";

export function createAttachedRuntimeBuiltinToolSurface(
  options: AttachedRuntimeBuiltinToolSurfaceOptions = {},
): AttachedRuntimeBuiltinToolSurface {
  const themeController = options.operatorSurface?.theme;
  const managedInvocationAttachment = options.managedInvocation
    ? normalizeManagedInvocationAttachment(options.managedInvocation)
    : undefined;
  const requiresPlanningStores = options.executionMode === "plan";
  const coreSurface = options.builtinToolOptions
    ? createDefaultBuiltinToolSurface(
      requiresPlanningStores
        ? createSessionBuiltinToolOptions(options.builtinToolOptions)
        : options.builtinToolOptions,
    )
    : requiresPlanningStores
      ? createDefaultBuiltinToolSurface(createSessionBuiltinToolOptions())
      : DEFAULT_CORE_BUILTIN_TOOL_SURFACE;
  const baseSurface = options.builtinToolOptions || requiresPlanningStores
      ? buildRuntimeSurface(coreSurface, {
        requireSessionStores: requiresPlanningStores,
        ...(options.builtinToolOptions?.invocationAdmission
          ? { toolInvocationAdmission: options.builtinToolOptions.invocationAdmission }
          : {}),
      })
    : DEFAULT_BUILTIN_TOOL_SURFACE;
  const managedInvocation = managedInvocationAttachment
    ? {
        ...managedInvocationAttachment,
        options: {
          ...managedInvocationAttachment.options,
          invocationOwner: managedInvocationAttachment.options.invocationOwner ?? {},
          pauseRequirementResolver: managedInvocationAttachment.options.pauseRequirementResolver
            ?? ((workItemId: string) => coreSurface.workItemStore?.get(workItemId)?.pauseRequirements),
        },
        governedScopeAdmission: managedInvocationAttachment.governedScopeAdmission
          ?? createManagedInvocationGovernedScopeAdmission(coreSurface),
        boundedWorkAdmission: managedInvocationAttachment.boundedWorkAdmission
          ?? createManagedInvocationBoundedWorkAdmission(coreSurface, options.boundedWork),
      }
    : undefined;

  const callBuiltinTools = new Map(baseSurface.callBuiltinTools);
  const capabilities = new Map(baseSurface.capabilities);
  const materializableTools = new Map(baseSurface.materializableTools);
  const materializableCapabilities = new Map(baseSurface.materializableCapabilities);
  const toolAuthority = new Map(baseSurface.toolAuthority);
  const toolCallMetadata = new Map(baseSurface.toolCallMetadata);
  const toolDefinitions = [...baseSurface.toolDefinitions];
  let dispose = async (): Promise<void> => undefined;
  const strictToolAllowlist = options.builtinToolOptions?.toolProjection?.mode === "strict"
    ? new Set(options.builtinToolOptions.toolProjection.alwaysOnTools ?? [])
    : undefined;

  const goalCreateExecutor = callBuiltinTools.get(GOAL_CREATE_TOOL_NAME);
  if (goalCreateExecutor) {
    callBuiltinTools.set(GOAL_CREATE_TOOL_NAME, createSessionAwareGoalCreateExecutor(goalCreateExecutor));
  }
  const goalContractSupersedeExecutor = callBuiltinTools.get(GOAL_CONTRACT_SUPERSEDE_TOOL_NAME);
  if (goalContractSupersedeExecutor) {
    callBuiltinTools.set(
      GOAL_CONTRACT_SUPERSEDE_TOOL_NAME,
      createSessionAwareGoalContractSupersedeExecutor(goalContractSupersedeExecutor),
    );
  }
  const registerRuntimeTool = (tool: ToolDefinition, capability: Capability): void => {
    toolDefinitions.push(tool);
    capabilities.set(tool.name, capability);
    toolAuthority.set(tool.name, authorityFromCapability(tool.name, capability));
  };

  const registerMaterializableRuntimeTool = (tool: ToolDefinition, capability: Capability): void => {
    registerRuntimeTool(tool, capability);
    materializableTools.set(tool.name, tool);
    materializableCapabilities.set(tool.name, capability);
  };

  if (!themeController && options.executionMode !== "plan" && !managedInvocation && !goalCreateExecutor && !options.boundedWork) {
    return baseSurface;
  }

  if (themeController) {
    callBuiltinTools.set(OPERATOR_SET_THEME_TOOL.name, async (input) => executeOperatorSetTheme(input, themeController));
    registerRuntimeTool(OPERATOR_SET_THEME_TOOL, OPERATOR_SET_THEME_CAPABILITY);
  }

  if (options.executionMode === "plan") {
    const analysisStateStore = baseSurface.analysisStateStore;
    const planStateStore = baseSurface.planStateStore;
    const specificationStateStore = baseSurface.specificationStateStore;
    if (!analysisStateStore || !planStateStore || !specificationStateStore) {
      throw new Error("Plan mode requires analysis, plan, and specification state stores.");
    }
    callBuiltinTools.set(
      SUBMIT_PLAN_TOOL.name,
      async (input) => executeSubmitPlan(
        input,
        analysisStateStore,
        planStateStore,
        specificationStateStore,
      ),
    );
    registerRuntimeTool(SUBMIT_PLAN_TOOL, SUBMIT_PLAN_CAPABILITY);

    callBuiltinTools.set(
      SUBMIT_SPECIFICATION_TOOL.name,
      async (input) => executeSubmitSpecification(input, specificationStateStore),
    );
    registerRuntimeTool(SUBMIT_SPECIFICATION_TOOL, SUBMIT_SPECIFICATION_CAPABILITY);

    callBuiltinTools.set(
      RECORD_CLARIFICATION_TOOL.name,
      async (input) => executeRecordClarification(input, specificationStateStore),
    );
    registerRuntimeTool(RECORD_CLARIFICATION_TOOL, RECORD_CLARIFICATION_CAPABILITY);
  }

  if (managedInvocation) {
    const managedInvocationOptions = managedInvocation.options;
    const managedInvocationService = resolveManagedInvocationService(managedInvocationOptions);
    let disposePromise: Promise<void> | undefined;
    dispose = async () => {
      disposePromise ??= managedInvocationService.shutdownOwner(
        managedInvocationOptions.invocationOwner!,
        "Attached runtime tool surface disposed.",
      )
        .then(() => undefined);
      await disposePromise;
    };
    const managedInvocationExecutors = createManagedInvocationLifecycleToolExecutors(
      managedInvocation,
      managedInvocationService,
    );
    const managedInvocationExecutor = managedInvocationExecutors.get(MANAGED_AGENT_INVOKE_TOOL.name);
    for (const [toolName, executor] of managedInvocationExecutors) {
      callBuiltinTools.set(toolName, executor);
    }
    const workItemExecutionStart = callBuiltinTools.get(WORK_ITEM_EXECUTION_START_TOOL_NAME);
    const workItemUpdate = callBuiltinTools.get("work_item.update");
    const workItemExecutionFinish = callBuiltinTools.get("work_item.execution.finish");
    if (workItemExecutionStart && managedInvocationExecutor) {
      callBuiltinTools.set(
        WORK_ITEM_EXECUTION_START_TOOL_NAME,
        createManagedDelegationWorkItemStartExecutor(
          workItemExecutionStart,
          workItemUpdate,
          workItemExecutionFinish,
          createManagedInvocationToolExecutor(
            managedInvocation,
            managedInvocationService,
            "already-admitted",
          ),
          managedInvocationOptions,
          coreSurface.workItemStore,
        ),
      );
    }
    const managedToolDefinitions = [
      createManagedAgentInvokeToolDefinition(managedInvocationOptions),
      createManagedAgentStartToolDefinition(managedInvocationOptions),
      MANAGED_AGENT_STATUS_TOOL,
      MANAGED_AGENT_LIST_TOOL,
      MANAGED_AGENT_JOIN_TOOL,
      MANAGED_AGENT_CANCEL_TOOL,
      createManagedAgentOrchestrateToolDefinition(managedInvocationOptions),
    ] as const;
    const managedCapabilities = [
      MANAGED_AGENT_INVOKE_CAPABILITY,
      MANAGED_AGENT_START_CAPABILITY,
      MANAGED_AGENT_STATUS_CAPABILITY,
      MANAGED_AGENT_LIST_CAPABILITY,
      MANAGED_AGENT_JOIN_CAPABILITY,
      MANAGED_AGENT_CANCEL_CAPABILITY,
      MANAGED_AGENT_ORCHESTRATE_CAPABILITY,
    ] as const;
    for (const [index, tool] of managedToolDefinitions.entries()) {
      const capability = managedCapabilities[index];
      if (capability) {
        registerMaterializableRuntimeTool(tool, capability);
      }
    }
    if (
      managedInvocationOptions.invocationService
      && !coreSurface.resources.hasProvider(isManagedAgentInvocationResourceProvider)
    ) {
      attachSessionScopedManagedResourceExecutors(
        callBuiltinTools,
        coreSurface,
        managedInvocationOptions,
      );
    }
    toolCallMetadata.set(
      MANAGED_AGENT_INVOKE_TOOL.name,
      createManagedInvocationToolCallMetadataResolver(managedInvocationOptions),
    );
    toolCallMetadata.set(
      MANAGED_AGENT_START_TOOL.name,
      createManagedInvocationToolCallMetadataResolver(managedInvocationOptions),
    );
  }

  // Project bounded-work evidence after all runtime wrappers have completed so
  // managed delegation, candidate closeout, and accounting updates are visible
  // in the same terminal event delivered to operator surfaces.
  if (options.boundedWork) {
    for (const [toolName, executor] of callBuiltinTools) {
      if (toolName.startsWith("work_item.")) {
        callBuiltinTools.set(toolName, createBoundedWorkProjectionExecutor(executor, coreSurface, options.boundedWork));
      }
    }
  }

  return {
    callBuiltinTools: strictToolAllowlist
      ? filterMapByAllowlist(callBuiltinTools, strictToolAllowlist) ?? new Map()
      : callBuiltinTools,
    toolDefinitions: strictToolAllowlist
      ? toolDefinitions.filter((tool) => strictToolAllowlist.has(tool.name))
      : toolDefinitions,
    capabilities: strictToolAllowlist
      ? filterMapByAllowlist(capabilities, strictToolAllowlist) ?? new Map()
      : capabilities,
    materializableTools: strictToolAllowlist
      ? filterMapByAllowlist(materializableTools, strictToolAllowlist) ?? new Map()
      : materializableTools,
    materializableCapabilities: strictToolAllowlist
      ? filterMapByAllowlist(materializableCapabilities, strictToolAllowlist) ?? new Map()
      : materializableCapabilities,
    toolAuthority: strictToolAllowlist
      ? filterMapByAllowlist(toolAuthority, strictToolAllowlist) ?? new Map()
      : toolAuthority,
    ...(baseSurface.toolInvocationAdmission
      ? { toolInvocationAdmission: baseSurface.toolInvocationAdmission }
      : {}),
    toolCallMetadata: strictToolAllowlist
      ? filterMapByAllowlist(toolCallMetadata, strictToolAllowlist) ?? new Map()
      : toolCallMetadata,
    analysisStateStore: baseSurface.analysisStateStore,
    authorityStateStore: baseSurface.authorityStateStore,
    planStateStore: baseSurface.planStateStore,
    specificationStateStore: baseSurface.specificationStateStore,
    listResources: baseSurface.listResources,
    listResourceTemplates: baseSurface.listResourceTemplates,
    readResource: baseSurface.readResource,
    dispose,
  };
}

function createManagedInvocationGovernedScopeAdmission(
  surface: DefaultBuiltinToolSurface,
): NonNullable<ManagedInvocationToolAttachment["governedScopeAdmission"]> {
  return (input) => {
    const goalRunStore = surface.goalRunStore;
    const workItemStore = surface.workItemStore;
    if (!goalRunStore || !workItemStore) {
      return {
        admitted: false,
        code: "governed_scope_store_unavailable",
        message: "Managed invocation governed scope requires the session goal and work item stores.",
      };
    }
    const goal = goalRunStore.get(input.goalRunId);
    if (!goal) {
      return {
        admitted: false,
        code: "goal_not_found",
        message: `Goal not found: ${input.goalRunId}`,
        suggestedNextTool: "goal.create",
      };
    }
    if (goal.ownerSessionId !== input.parentSessionId) {
      return {
        admitted: false,
        code: "goal_session_mismatch",
        message: `Goal ${goal.id} does not belong to runtime session ${input.parentSessionId}.`,
      };
    }
    if (goal.status !== "active") {
      return {
        admitted: false,
        code: "goal_not_active",
        message: `Goal ${goal.id} is ${goal.status}; managed invocation requires an active goal.`,
      };
    }
    if (
      goal.authorityEnvelope.maximumAuthority === "read_only"
      && (
        input.profile !== "foundation-readonly-plan"
        || (input.requestedAuthority !== "read_only" && input.requestedAuthority !== "auto")
      )
    ) {
      return {
        admitted: false,
        code: "goal_authority_exceeded",
        message: `Goal ${goal.id} is limited to read_only managed authority.`,
      };
    }
    if (
      goal.authorityEnvelope.maximumAuthority === "audited"
      && input.requestedAuthority === "destructive"
    ) {
      return {
        admitted: false,
        code: "goal_authority_exceeded",
        message: `Goal ${goal.id} is limited to audited managed authority.`,
      };
    }
    if (!input.workItemId) {
      return { admitted: true };
    }
    const workItem = workItemStore.get(input.workItemId);
    if (!workItem) {
      return {
        admitted: false,
        code: "work_item_not_found",
        message: `Work item not found: ${input.workItemId}`,
        suggestedNextTool: "work_item.update",
      };
    }
    if (workItem.goalRunId !== goal.id || !goal.workItemIds.includes(workItem.id)) {
      return {
        admitted: false,
        code: "governed_scope_mismatch",
        message: `Work item ${workItem.id} is not governed by goal ${goal.id}.`,
      };
    }
    if (workItem.status === "completed" || workItem.status === "cancelled") {
      return {
        admitted: false,
        code: "work_item_not_active",
        message: `Work item ${workItem.id} is ${workItem.status}; managed invocation requires an open work item.`,
      };
    }
    if (!input.attemptId) return { admitted: true };
    const attempt = workItem.executionAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) {
      return {
        admitted: false,
        code: "execution_attempt_not_found",
        message: `Execution attempt not found: ${input.attemptId}`,
      };
    }
    if (attempt.goalRunId !== goal.id || attempt.workItemId !== workItem.id || attempt.status !== "started") {
      return {
        admitted: false,
        code: "execution_attempt_not_active",
        message: `Execution attempt ${attempt.id} is not an active attempt for work item ${workItem.id} and goal ${goal.id}.`,
      };
    }
    if (attempt.boundedWorkContractRevisionDigest !== goal.boundedWorkContractRevision.revisionDigest) {
      return {
        admitted: false,
        code: "bounded_work_attempt_revision_stale",
        message: `Execution attempt ${attempt.id} is bound to a superseded bounded-work contract revision.`,
      };
    }
    return { admitted: true };
  };
}

function createManagedInvocationBoundedWorkAdmission(
  surface: DefaultBuiltinToolSurface,
  boundedWork: AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"],
): ManagedInvocationBoundedWorkAdmission | undefined {
  if (!boundedWork) return undefined;
  return (input) => {
    const goal = surface.goalRunStore?.get(input.goalRunId);
    const workItem = surface.workItemStore?.get(input.workItemId);
    if (!goal || !workItem || goal.ownerSessionId !== input.parentSessionId) {
      return {
        admitted: false,
        code: "bounded_work_attribution_invalid",
        message: "Managed invocation bounded-work attribution is no longer valid.",
      };
    }
    const attempt = input.attemptId
      ? workItem.executionAttempts.find((candidate) => candidate.id === input.attemptId)
      : undefined;
    if (
      workItem.goalRunId !== goal.id
      || !goal.workItemIds.includes(workItem.id)
      || (input.attemptId !== undefined && (
        !attempt
        || attempt.status !== "started"
        || attempt.boundedWorkContractRevisionDigest !== goal.boundedWorkContractRevision.revisionDigest
      ))
    ) {
      return {
        admitted: false,
        code: "bounded_work_attempt_invalid",
        message: "Managed invocation requires a current active execution attempt.",
      };
    }
    const permittedEffects = new Set(goal.boundedWorkContractRevision.contract.scope.permittedEffects);
    const writeEffects = input.requestedEffects.filter((effect) =>
      effect === "modify_source"
      || effect === "modify_tests"
      || effect === "modify_documentation"
      || effect === "modify_configuration"
      || effect === "external_write");
    if (
      input.writeRequested
      && (writeEffects.length === 0 || input.requestedEffects.some((effect) => !permittedEffects.has(effect)))
    ) {
      return {
        admitted: false,
        code: "bounded_work_effect_authority_denied",
        message: "Governed write delegation requires explicit requested effects contained by the bounded-work contract.",
      };
    }
    const reservation = boundedWork.authority.reserve({
      projectRuntimeId: boundedWork.projectRuntimeId,
      goalRunId: goal.id,
      workItemId: workItem.id,
      contractRevision: goal.boundedWorkContractRevision,
      idempotencyKey: `managed:${input.invocationId}`,
      route: { routeId: input.routeId, harnessId: input.harnessId },
      harnessCapability: "authoritative",
      scope: {
        workItemId: workItem.id,
        effect: "invoke_managed_agent",
        surface: workItem.surface ?? goal.boundedWorkContractRevision.contract.scope.permittedSurfaces[0]!,
        paths: workItem.referenceRoots ?? [],
      },
      reservation: { kind: "managed_invocation", amount: 1, childDepth: input.childDepth },
    });
    if (reservation.decision.kind !== "admitted") {
      return {
        admitted: false,
        code: reservation.decision.kind,
        message: boundedWorkDecisionMessage(reservation.decision),
        suggestedNextTool: reservation.decision.kind === "pause_scope_revision_required"
          ? "goal.bounded_work_contract.supersede"
          : undefined,
      };
    }
    const workspaceAuthority = intersectBoundedWorkspaceAuthority({
      workspaceRoot: input.workspaceRoot,
      contractAllowedRoots: goal.boundedWorkContractRevision.contract.scope.allowedRoots,
      contractDeniedRoots: goal.boundedWorkContractRevision.contract.scope.deniedRoots,
      routeAllowedPaths: input.routeWriteAllowedPaths,
      routeDeniedPaths: input.routeWriteDeniedPaths,
    });
    if (input.writeRequested && workspaceAuthority.allowedPaths.length === 0) {
      boundedWork.authority.releaseBeforeDispatch({
        reservationId: reservation.reservation!.reservationId,
        expectedReservationRevision: reservation.reservation!.revision,
      });
      return {
        admitted: false,
        code: "bounded_work_workspace_authority_empty",
        message: "The bounded-work roots and route write authority do not overlap.",
      };
    }
    let receipt = reservation.reservation!;
    return {
      admitted: true,
      workspaceAuthority,
      lifecycle: {
        markDispatched(dispatchId) {
          receipt = boundedWork.authority.markDispatched({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
            dispatchId,
          });
        },
        releaseBeforeDispatch() {
          receipt = boundedWork.authority.releaseBeforeDispatch({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
          });
        },
        settleTerminal(outcome, evidenceDigest) {
          receipt = boundedWork.authority.settleTerminal({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
            terminalOutcome: outcome,
            terminalEvidenceDigest: evidenceDigest,
          });
        },
        settleUnknown(reason) {
          receipt = boundedWork.authority.settleUnknown({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
            reason,
          });
        },
      },
    };
  };
}

function intersectBoundedWorkspaceAuthority(input: {
  readonly workspaceRoot: string;
  readonly contractAllowedRoots: readonly string[];
  readonly contractDeniedRoots: readonly string[];
  readonly routeAllowedPaths: readonly string[];
  readonly routeDeniedPaths: readonly string[];
}): { readonly allowedPaths: readonly string[]; readonly deniedPaths: readonly string[] } {
  const workspaceRoot = resolve(input.workspaceRoot);
  const contractAllowed = input.contractAllowedRoots.map((path) => resolve(workspaceRoot, path));
  const routeAllowed = input.routeAllowedPaths.map((path) => resolve(workspaceRoot, path));
  const allowedPaths = uniquePaths(contractAllowed.flatMap((contractPath) =>
    routeAllowed.flatMap((routePath) => {
      if (containsPath(contractPath, routePath)) return [routePath];
      if (containsPath(routePath, contractPath)) return [contractPath];
      return [];
    })));
  return {
    allowedPaths,
    deniedPaths: uniquePaths([
      ...input.contractDeniedRoots.map((path) => resolve(workspaceRoot, path)),
      ...input.routeDeniedPaths.map((path) => isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path)),
    ]),
  };
}

function containsPath(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map((path) => resolve(path)))].sort();
}

function boundedWorkDecisionMessage(
  decision: Exclude<ReturnType<SqliteBoundedWorkAuthority["reserve"]>["decision"], { readonly kind: "admitted" }>,
): string {
  switch (decision.kind) {
    case "pause_scope_revision_required":
      return `Managed invocation requires a bounded-work scope revision: ${decision.violations.map((entry) => entry.kind).join(", ")}.`;
    case "pause_budget_exhausted":
    case "stop_budget_exhausted":
      return `Managed invocation bounded-work limits are exhausted: ${decision.exhaustedLimits.join(", ")}.`;
    case "pause_capability_unavailable":
      return `Managed invocation lacks required bounded-work capability: ${decision.unavailableMetrics.join(", ")}.`;
  }
}

function attachSessionScopedManagedResourceExecutors(
  executors: Map<string, RuntimeBuiltinToolExecutor>,
  surface: DefaultBuiltinToolSurface,
  options: ManagedInvocationToolOptions,
): void {
  const invocationService = options.invocationService;
  if (!invocationService) {
    return;
  }
  const tools = [
    new ResourceListTool({ resources: () => undefined }),
    new ResourceTemplateListTool({ resources: () => undefined }),
    new ResourceReadTool({ resources: () => undefined }),
  ] as const;
  for (const tool of tools) {
    executors.set(tool.name, async (input, context) => {
      const parentSessionId = context?.session.id;
      if (!parentSessionId) {
        return {
          output: "Managed invocation resources require an attached runtime session.",
          isError: true,
          metadata: { errorCode: "session_boundary_required" },
        };
      }
      const resources = surface.resources.withAdditionalProviders([
        createManagedAgentInvocationResourceProvider({
          service: invocationService,
          parentSessionId,
          artifactStore: options.artifactStore ?? surface.artifactStore,
        }),
      ]);
      const scopedTool = tool.name === "resource_list"
        ? new ResourceListTool({ resources: () => resources })
        : tool.name === "resource_template_list"
          ? new ResourceTemplateListTool({ resources: () => resources })
          : new ResourceReadTool({ resources: () => resources });
      const result = await scopedTool.execute({ name: scopedTool.name, input });
      const resourceLinks = projectToolResultResourceLinks(result);
      const resourceLinkContent = (result.content ?? []).filter(isResourceLinkContent);
      return {
        output: resourceLinks.length > 0 ? formatLinkedOutput(resourceLinks, result.metadata) : result.output,
        isError: result.isError,
        metadata: result.metadata,
        ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
        ...(resourceLinkContent.length > 0 ? { content: resourceLinkContent } : {}),
      };
    });
  }
}

function normalizeManagedInvocationAttachment(
  managedInvocation: AttachedRuntimeManagedInvocationConfig,
): ManagedInvocationToolAttachment {
  if ("options" in managedInvocation && "callerIdentity" in managedInvocation) {
    return managedInvocation;
  }
  const { callerIdentity, ...options } = managedInvocation;
  return {
    options,
    callerIdentity: callerIdentity ?? {
      kind: "kiln-runtime",
      surface: "runtime",
      attachmentId: "attachment:runtime",
    },
  };
}

function createSessionAwareGoalCreateExecutor(goalCreateExecutor: RuntimeBuiltinToolExecutor): RuntimeBuiltinToolExecutor {
  return async (input, context) => {
    if (!context?.operatorAdoptionDecision) {
      return {
        output: JSON.stringify({
          error: {
            code: "operator_adoption_decision_missing",
            message: "goal.create requires a canonical runtime operator adoption decision.",
            recoverable: false,
          },
        }, null, 2),
        isError: true,
      };
    }
    return goalCreateExecutor({
      ...input,
      ownerSessionId: context.operatorAdoptionDecision.ownerSessionId,
      operatorTurnId: context.operatorAdoptionDecision.operatorTurnId,
      contractAuthority: context.operatorAdoptionDecision.contractAuthority,
    }, context);
  };
}

function createBoundedWorkProjectionExecutor(
  executor: RuntimeBuiltinToolExecutor,
  surface: DefaultBuiltinToolSurface,
  boundedWork: NonNullable<AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"]>,
): RuntimeBuiltinToolExecutor {
  return async (input, context) => {
    const rawResult = await executor(input, context);
    if (!rawResult || typeof rawResult !== "object") return rawResult;
    const result = rawResult as { readonly metadata?: unknown; readonly [key: string]: unknown };
    const metadata = result.metadata as Record<string, unknown> | undefined;
    const item = metadata?.item as Record<string, unknown> | undefined;
    const goalRunId = typeof item?.goalRunId === "string" ? item.goalRunId : undefined;
    const goal = goalRunId ? surface.goalRunStore?.get(goalRunId) : undefined;
    const state = goal ? boundedWork.authority.inspectProjection({
      projectRuntimeId: boundedWork.projectRuntimeId,
      accountingLineageId: goal.id,
    }) : undefined;
    if (!metadata || !item || !goal || !state) return result;
    const limits = goal.boundedWorkContractRevision.contract.limits;
    const latestAttempt = (item.executionAttempts as readonly Record<string, unknown>[] | undefined)?.at(-1);
    const candidate = latestAttempt?.candidate as Record<string, unknown> | undefined;
    return {
      ...result,
      metadata: {
        ...metadata,
        item: {
          ...item,
          boundedWork: {
            contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
            ...(typeof candidate?.candidateDigest === "string" ? { candidateDigest: candidate.candidateDigest } : {}),
            accounting: {
              revision: state.accounting.revision,
              executionAttempts: { used: state.accounting.executionAttempts, limit: limits.maxExecutionAttempts },
              managedInvocations: {
                used: state.accounting.managedInvocations,
                active: state.accounting.activeManagedInvocations,
                limit: limits.maxManagedInvocations,
              },
              reviewRounds: { used: state.accounting.reviewRounds, limit: limits.maxReviewRounds },
              remediationRounds: { used: state.accounting.remediationRounds, limit: limits.maxRemediationRounds },
              ...(limits.maxToolCalls !== undefined
                ? { toolCalls: { ...state.accounting.toolCalls, limit: limits.maxToolCalls } }
                : {}),
              ...(limits.maxActiveDurationMs !== undefined
                ? { activeDurationMs: { ...state.accounting.activeDurationMs, limit: limits.maxActiveDurationMs } }
                : {}),
            },
            decision: state.decision ?? {
              kind: "admitted",
              contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
              accountingRevision: state.accounting.revision,
              reserved: {},
              diagnostics: [],
            },
          },
        },
      } as typeof result.metadata,
    };
  };
}

function createManagedDelegationWorkItemStartExecutor(
  startExecutor: RuntimeBuiltinToolExecutor,
  updateExecutor: RuntimeBuiltinToolExecutor | undefined,
  finishExecutor: RuntimeBuiltinToolExecutor | undefined,
  managedInvocationExecutor: RuntimeBuiltinToolExecutor,
  managedInvocationOptions: ManagedInvocationToolOptions,
  workItemStore: WorkItemStore | undefined,
): RuntimeBuiltinToolExecutor {
  return async (input, context) => {
    const managedInvocations: Record<string, unknown>[] = [];
    const visitedPhaseIds = new Set<string>();
    while (true) {
      const initialResult = await startExecutor(input, context);
      const managedPause = parseManagedDelegationPause(initialResult);
      if (!managedPause) return initialResult;

      const preparedRequest = prepareManagedInvocationRequest(managedPause.request, managedInvocationOptions);
      const managedRequest = preparedRequest.request;
      const phaseId = readTextFromUnknown(readRecord(managedRequest.executionPhase)?.id);
      if (phaseId && visitedPhaseIds.has(phaseId)) {
        return {
          output: `Managed delegation repeated phase ${phaseId} without advancing governed state.`,
          isError: true,
          metadata: { errorCode: "managed_phase_progress_stalled", phaseId, managedInvocations },
        };
      }
      if (phaseId) visitedPhaseIds.add(phaseId);
      const recoveryInvocationId = deriveRecoveryInvocationId(context, phaseId);
      const managedContext = context
        ? {
          ...context,
          toolCall: {
            ...context.toolCall,
            id: recoveryInvocationId,
            name: MANAGED_AGENT_INVOKE_TOOL.name,
            input: managedRequest,
          },
        } satisfies RuntimeBuiltinToolExecutionContext
        : undefined;
      const managedResult = await managedInvocationExecutor(managedRequest, managedContext);
      const managedEnvelope = readRuntimeToolResultEnvelope(managedResult);
      if (!managedEnvelope || managedEnvelope.isError) {
        return managedDelegationPausedResult(initialResult, managedEnvelope, "Managed child invocation failed before work item execution could start.", workItemStore, recoveryInvocationId);
      }
      const managedInvocationId = readTextFromUnknown(managedEnvelope.metadata?.invocationId);
      if (!managedInvocationId) {
        return managedDelegationPausedResult(initialResult, managedEnvelope, "Managed child invocation completed without an invocation id.", workItemStore, recoveryInvocationId);
      }
      managedInvocations.push({
        invocationId: managedInvocationId,
        ...(readTextFromUnknown(managedEnvelope.metadata?.status)
          ? { status: readTextFromUnknown(managedEnvelope.metadata?.status) }
          : {}),
        ...(readTextFromUnknown(managedEnvelope.metadata?.routeId)
          ? { routeId: readTextFromUnknown(managedEnvelope.metadata?.routeId) }
          : {}),
      });
      const phaseCompletion = readRecord(managedEnvelope.metadata?.managedInvocationPhaseCompletion);
      const completionTool = readTextFromUnknown(readRecord(managedRequest.executionPhase)?.completionTool);
      if (!phaseCompletion) {
        if (!completionTool) {
          const resumedEnvelope = readRuntimeToolResultEnvelope(await startExecutor({ ...input, managedInvocationId }, context));
          if (!resumedEnvelope) return initialResult;
          return {
            ...resumedEnvelope,
            metadata: {
              ...(resumedEnvelope.metadata ?? {}),
              managedInvocationAutoStarted: true,
              managedInvocationId,
              managedInvocations,
              ...(managedEnvelope.metadata ? { managedInvocation: managedEnvelope.metadata } : {}),
            },
          };
        }
        return managedDelegationPausedResult(initialResult, managedEnvelope, "Managed child invocation completed without a validated phase transition.", workItemStore, recoveryInvocationId);
      }

      if (completionTool === "work_item.update") {
        const updateInput = readRecord(phaseCompletion.workItemUpdateInputTemplate);
        if (!updateInput) {
          return managedDelegationPausedResult(initialResult, managedEnvelope, "Validated intermediate phase did not provide a work-item transition.", workItemStore, recoveryInvocationId);
        }
        if (!updateExecutor) {
          return managedPhaseTransitionRequiredResult(
            initialResult,
            managedRequest,
            managedEnvelope,
            managedInvocationId,
            preparedRequest.metadata,
          );
        }
        const updateResult = readRuntimeToolResultEnvelope(await updateExecutor(updateInput, context));
        if (!updateResult || updateResult.isError) return updateResult ?? initialResult;
        continue;
      }

      const resumedEnvelope = readRuntimeToolResultEnvelope(await startExecutor({ ...input, managedInvocationId }, context));
      if (!resumedEnvelope || resumedEnvelope.isError) return resumedEnvelope ?? initialResult;
      const resumedOutput = parseJsonRecord(resumedEnvelope.output);
      const attemptId = readTextFromUnknown(readRecord(resumedOutput?.attempt)?.id)
        ?? readTextFromUnknown(readRecord(resumedEnvelope.metadata?.attempt)?.id);
      const finishTemplate = readRecord(phaseCompletion.workItemExecutionFinishInputTemplate);
      if (!attemptId || !finishTemplate || !finishExecutor) {
        return managedDelegationPausedResult(resumedEnvelope, managedEnvelope, "Validated final phase could not be attached to an execution attempt.", workItemStore, recoveryInvocationId);
      }
      const finishedEnvelope = readRuntimeToolResultEnvelope(await finishExecutor({
        ...finishTemplate,
        attemptId,
      }, context));
      if (!finishedEnvelope) return resumedEnvelope;
      return {
        ...finishedEnvelope,
        metadata: {
          ...(finishedEnvelope.metadata ?? {}),
          managedInvocationAutoCompleted: true,
          managedInvocationId,
          managedInvocations,
        },
      };
    }
  };
}

function managedPhaseTransitionRequiredResult(
  initialResult: unknown,
  managedRequest: Record<string, unknown>,
  managedResult: RuntimeToolResultEnvelope,
  managedInvocationId: string,
  requestMetadata: Record<string, unknown> | undefined,
): RuntimeToolResultEnvelope {
  const initialEnvelope = readRuntimeToolResultEnvelope(initialResult);
  const initialOutput = initialEnvelope ? parseJsonRecord(initialEnvelope.output) : undefined;
  const managedOutput = parseJsonRecord(managedResult.output);
  return {
    output: JSON.stringify({
      ...(initialOutput ?? {}),
      status: "paused",
      reason: "Managed child completed the intermediate evidence phase; this tool surface does not expose the work-item transition capability.",
      nextTool: "work_item.update",
      managedInvocationId,
      ...(managedOutput ? { managedInvocation: managedOutput } : {}),
      managedInvocationRequest: managedRequest,
    }, null, 2),
    isError: false,
    metadata: {
      ...(initialEnvelope?.metadata ?? {}),
      operation: "managed_intermediate_phase_completed",
      managedInvocationAutoStarted: true,
      managedInvocationId,
      ...(managedResult.metadata ? { managedInvocation: managedResult.metadata } : {}),
      ...(requestMetadata ?? {}),
    },
  };
}

function prepareManagedInvocationRequest(
  request: Record<string, unknown>,
  options: ManagedInvocationToolOptions,
): { readonly request: Record<string, unknown>; readonly metadata?: Record<string, unknown> } {
  const hydrated = hydrateManagedInvocationRequest(request, options);
  const repaired = repairManagedInvocationRouteForRequiredTools(hydrated, options);
  return {
    request: attachMatchingAgentProfile(repaired.request, options),
    ...(repaired.metadata ? { metadata: repaired.metadata } : {}),
  };
}

function hydrateManagedInvocationRequest(
  request: Record<string, unknown>,
  options: ManagedInvocationToolOptions,
): Record<string, unknown> {
  const providerRoute = readRecord(request.providerRoute);
  const routeId = readTextFromUnknown(request.routeId);
  const forbiddenInputFields = readTextArray(request.forbiddenInputFields);
  const requestedProfile = (readTextFromUnknown(request.profile) ?? "foundation-readonly-plan") as ManagedAgentAdmissionProfile;
  const requiredToolNames = requiredToolNamesFromManagedRequest(request);
  const exactRoute = routeId
    ? options.routes.find((route) => route.routeId === routeId)
    : undefined;
  const configuredAgent = resolveManagedInvocationAgentProfile(options, readTextFromUnknown(request.agentProfile));
  if (exactRoute && resolveManagedInvocationRouteProfile(exactRoute, requestedProfile, configuredAgent) !== undefined) {
    return {
      ...request,
      routeId: exactRoute.routeId,
      profile: requestedProfile,
      providerRoute: {
        ...providerRouteInputProjection(providerRoute, forbiddenInputFields),
        providerId: exactRoute.providerId,
        ...exactRouteProviderModelProjection(providerRoute, exactRoute.model, forbiddenInputFields),
      },
    };
  }
  const profile = requestedProfile;
  const matches = options.routes.filter((route) =>
    (!routeId || route.routeId === routeId)
    && resolveManagedInvocationRouteProfile(route, profile, configuredAgent) !== undefined
    && routeSupportsRequiredTools(route, profile, requiredToolNames, configuredAgent)
  );
  const route = matches.length === 1 ? matches[0] : selectUniqueSuitableRoute(matches, request);
  if (!route) {
    return request;
  }
  return {
    ...request,
    routeId: routeId ?? route.routeId,
    providerRoute: {
      ...(providerRoute ?? {}),
      providerId: route.providerId,
      ...(readTextFromUnknown(providerRoute?.model) || !route.model
        ? {}
        : { model: route.model }),
    },
  };
}

function repairManagedInvocationRouteForRequiredTools(
  request: Record<string, unknown>,
  options: ManagedInvocationToolOptions,
): { readonly request: Record<string, unknown>; readonly metadata?: Record<string, unknown> } {
  const routeId = readTextFromUnknown(request.routeId);
  const requiredToolNames = requiredToolNamesFromManagedRequest(request);
  if (!routeId || requiredToolNames.length === 0) {
    return { request };
  }
  const route = options.routes.find((candidate) => candidate.routeId === routeId);
  const profile = (readTextFromUnknown(request.profile) ?? "foundation-readonly-plan") as ManagedAgentAdmissionProfile;
  const configuredAgent = resolveManagedInvocationAgentProfile(options, readTextFromUnknown(request.agentProfile));
  if (!route || routeSupportsRequiredTools(route, profile, requiredToolNames, configuredAgent)) {
    return { request };
  }
  const compatibleRoutes = options.routes.filter((candidate) =>
    candidate.routeId !== routeId
    && routeSupportsRequiredTools(candidate, profile, requiredToolNames, configuredAgent)
  );
  const replacement = compatibleRoutes.length === 1
    ? compatibleRoutes[0]
    : selectUniqueSuitableRoute(compatibleRoutes, request);
  if (!replacement) {
    return { request };
  }
  const providerRoute = readRecord(request.providerRoute);
  return {
    request: {
      ...request,
      routeId: replacement.routeId,
      providerRoute: {
        ...(providerRoute ?? {}),
        providerId: replacement.providerId,
        ...(replacement.model ? { model: replacement.model } : {}),
      },
    },
    metadata: {
      managedInvocationRouteRepair: {
        fromRouteId: routeId,
        toRouteId: replacement.routeId,
        reason: "required_tools_missing",
        missingRequiredTools: requiredToolNames.filter((toolName) =>
          !routeSupportsRequiredTools(route, profile, [toolName], configuredAgent)
        ),
      },
    },
  };
}

function attachMatchingAgentProfile(
  request: Record<string, unknown>,
  options: ManagedInvocationToolOptions,
): Record<string, unknown> {
  if (readTextArray(request.forbiddenInputFields).includes("agentProfile")) {
    return request;
  }
  if (readTextFromUnknown(request.agentProfile)) {
    return request;
  }
  const routeId = readTextFromUnknown(request.routeId);
  if (!routeId) {
    return request;
  }
  const profile = (readTextFromUnknown(request.profile) ?? "foundation-readonly-plan") as ManagedAgentAdmissionProfile;
  const route = options.routes.find((candidate) => candidate.routeId === routeId);
  if (!route || !resolveManagedInvocationRouteProfile(route, profile)) {
    return request;
  }
  const matches = (options.agentCatalog ?? []).filter((agent) =>
    agent.routeId === routeId
    && resolveManagedInvocationRouteProfile(route, profile, agent) !== undefined
  );
  if (matches.length !== 1) {
    return request;
  }
  return {
    ...request,
    agentProfile: matches[0]!.name,
  };
}

function providerRouteInputProjection(
  providerRoute: Record<string, unknown> | undefined,
  forbiddenInputFields: readonly string[],
): Record<string, unknown> {
  if (!forbiddenInputFields.includes("agentProfile")) {
    return providerRoute ?? {};
  }
  return Object.fromEntries(
    Object.entries(providerRoute ?? {}).filter(([key]) => key !== "model"),
  );
}

function exactRouteProviderModelProjection(
  providerRoute: Record<string, unknown> | undefined,
  routeModel: string | undefined,
  forbiddenInputFields: readonly string[],
): Record<string, unknown> {
  const requestModel = readTextFromUnknown(providerRoute?.model);
  if (forbiddenInputFields.includes("agentProfile")) {
    return routeModel ? { model: routeModel } : {};
  }
  if (requestModel || !routeModel) {
    return {};
  }
  return { model: routeModel };
}

function requiredToolNamesFromManagedRequest(request: Record<string, unknown>): readonly string[] {
  const direct = readTextArray(request.requiredToolNames);
  if (direct.length > 0) {
    return direct;
  }
  const executionPhase = readRecord(request.executionPhase);
  return readTextArray(executionPhase?.requiredToolNames);
}

function routeSupportsRequiredTools(
  route: ManagedInvocationToolOptions["routes"][number],
  profile: ManagedAgentAdmissionProfile,
  requiredToolNames: readonly string[],
  agent?: NonNullable<ManagedInvocationToolOptions["agentCatalog"]>[number],
): boolean {
  const routeProfile = resolveManagedInvocationRouteProfile(route, profile, agent);
  if (!routeProfile) {
    return false;
  }
  const allowedTools = new Set(routeProfile.allowedToolNames);
  return requiredToolNames.every((toolName) => allowedTools.has(toolName));
}

function parseManagedDelegationPause(result: unknown): { readonly request: Record<string, unknown> } | undefined {
  const envelope = readRuntimeToolResultEnvelope(result);
  if (!envelope?.isError) {
    return undefined;
  }
  const output = parseJsonRecord(envelope.output);
  if (!output || output.status !== "paused" || output.nextTool !== MANAGED_AGENT_INVOKE_TOOL.name) {
    return undefined;
  }
  const request = readRecord(output.managedInvocationRequest);
  return request ? { request } : undefined;
}

/**
 * Replay-stable identity for a single managed-invocation recovery attempt.
 *
 * Scoped by the STABLE execution phase id, never a same-run loop ordinal:
 * an ordinal changes across replays whenever an earlier phase in the same
 * wrapper run has since completed and been persisted (so a later phase's
 * position in the loop shifts), which would derive a different id for the
 * identical logical failure. The phase id does not move.
 *
 * Combined with the outer work_item.execution.start tool call's own id, so
 * two distinct outer calls (a real retry after a failure) never derive the
 * same id, while an exact replay of the same outer call always does.
 *
 * The provider boundary validates `context.toolCall.id` before execution.
 * Direct callers of this lower-level surface must satisfy the same invariant;
 * accepting an absent or invalid id would make recovery non-replayable.
 */
function deriveRecoveryInvocationId(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  phaseId: string | undefined,
): string {
  const toolCallId = context?.toolCall.id;
  const usableToolCallId = typeof toolCallId === "string" && toolCallId.trim().length > 0
    ? toolCallId.trim()
    : undefined;
  if (!usableToolCallId) {
    throw new Error("Managed invocation recovery requires a non-empty tool call id.");
  }
  return phaseId
    ? `${usableToolCallId}:managed-invocation:${phaseId}`
    : `${usableToolCallId}:managed-invocation`;
}

function managedDelegationPausedResult(
  initialResult: unknown,
  managedResult: RuntimeToolResultEnvelope | undefined,
  reason: string,
  workItemStore: WorkItemStore | undefined,
  recoveryInvocationId: string,
): RuntimeToolResultEnvelope {
  const initialEnvelope = readRuntimeToolResultEnvelope(initialResult);
  const initialOutput = initialEnvelope ? parseJsonRecord(initialEnvelope.output) : undefined;
  const recovery = buildManagedDelegationRecovery(managedResult, initialOutput, workItemStore, recoveryInvocationId);
  return {
    output: JSON.stringify({
      status: "paused",
      reason,
      initial: initialOutput ?? (initialEnvelope ? initialEnvelope.output : initialResult),
      ...(managedResult ? { managedInvocation: managedResult } : {}),
      ...(recovery ? { recovery } : {}),
    }, null, 2),
    isError: true,
    metadata: {
      toolName: WORK_ITEM_EXECUTION_START_TOOL_NAME,
      operation: "managed_invocation_failed",
      managedInvocationAutoStarted: false,
      managedInvocationFailureReason: reason,
      ...(recovery ? { managedInvocationRecovery: recovery } : {}),
      ...(initialEnvelope?.metadata ? { initial: initialEnvelope.metadata } : {}),
      ...(managedResult?.metadata ? { managedInvocation: managedResult.metadata } : {}),
    },
  };
}

function buildManagedDelegationRecovery(
  managedResult: RuntimeToolResultEnvelope | undefined,
  initialOutput: Record<string, unknown> | undefined,
  workItemStore: WorkItemStore | undefined,
  recoveryInvocationId: string,
): Record<string, unknown> | undefined {
  const request = readRecord(initialOutput?.managedInvocationRequest);
  const workItemId = readTextFromUnknown(request?.workItemId);
  const priorPauseRequirements = workItemId ? workItemStore?.get(workItemId)?.pauseRequirements : undefined;
  return buildManagedInvocationPhaseRecovery(
    request,
    managedInvocationFailureReasonFromStatus(
      managedResult?.metadata?.lifecycleState ?? managedResult?.metadata?.status,
    ),
    undefined,
    { priorPauseRequirements, recoveryInvocationId },
  );
}

interface RuntimeToolResultEnvelope {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly resourceLinks?: unknown;
  readonly content?: unknown;
}

function readRuntimeToolResultEnvelope(value: unknown): RuntimeToolResultEnvelope | undefined {
  const record = readRecord(value);
  if (!record || typeof record.output !== "string" || typeof record.isError !== "boolean") {
    return undefined;
  }
  const metadata = readRecord(record.metadata);
  return {
    output: record.output,
    isError: record.isError,
    ...(metadata ? { metadata } : {}),
    ...(record.resourceLinks !== undefined ? { resourceLinks: record.resourceLinks } : {}),
    ...(record.content !== undefined ? { content: record.content } : {}),
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function buildRuntimeSurface(
  coreSurface: DefaultBuiltinToolSurface,
  options: {
    readonly requireSessionStores?: boolean;
    readonly toolInvocationAdmission?: InvocationAdmission;
  } = {},
): AttachedRuntimeBuiltinToolSurface {
  const analysisStateStore = coreSurface.analysisStateStore;
  const authorityStateStore = coreSurface.authorityStateStore;
  const planStateStore = coreSurface.planStateStore;
  const specificationStateStore = coreSurface.specificationStateStore;
  if (options.requireSessionStores && (!analysisStateStore || !planStateStore || !specificationStateStore)) {
    throw new Error("Runtime builtin tool surface requires analysis, plan, and specification state stores.");
  }
  const materializableToolDefinitions = projectDevToolDefinitions(coreSurface.registry.list());
  return {
    callBuiltinTools: buildBuiltinToolExecutors(coreSurface),
    toolDefinitions: coreSurface.toolDefinitions,
    capabilities: coreSurface.capabilities,
    materializableTools: new Map(materializableToolDefinitions.map((tool) => [tool.name, tool] as const)),
    materializableCapabilities: projectDevToolCapabilities(coreSurface.registry.list()),
    toolAuthority: buildBuiltinToolAuthority(coreSurface.capabilities),
    ...(options.toolInvocationAdmission
      ? { toolInvocationAdmission: options.toolInvocationAdmission }
      : {}),
    toolCallMetadata: new Map(),
    analysisStateStore,
    authorityStateStore,
    planStateStore,
    specificationStateStore,
    listResources: () => coreSurface.resources.list().map(projectToolResourceDescriptor),
    listResourceTemplates: () => coreSurface.resources.listTemplates(),
    readResource: (uri: string, options?: ToolResourceReadOptions) => coreSurface.resources.read(uri, options),
    dispose: async () => undefined,
  };
}

export function buildAttachedRuntimePerCallToolConfig(input: {
  readonly tenantId: string;
  readonly workingDirectory?: string;
  readonly governedWorkRequirement?: PerCallToolConfig["governedWorkRequirement"];
  readonly activeProvider?: string;
  readonly activeModel?: string;
  readonly activeModelCapabilities?: DiscoveredDirectProviderModelCapabilities;
  readonly deliberationIntent?: PerCallToolConfig["deliberationIntent"];
  readonly communicationIntent?: PerCallToolConfig["communicationIntent"];
  readonly builtinToolSurface?: AttachedRuntimeBuiltinToolSurface;
  readonly executionMode?: OperatorExecutionMode;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
  readonly temporalContext?: PerCallToolConfig["temporalContext"];
}): RuntimeAuthorityAdmissionCandidateConfig {
  const requestedAuthority = resolveAttachedRuntimeRequestedAuthority(input.requestedAuthority) ?? "auto";
  const executionMode = resolvePerCallExecutionMode(input.executionMode);
  const provider = isDirectProviderId(input.activeProvider)
    ? input.activeProvider
    : undefined;
  const profile = resolveDirectProviderExecutionProfile({
    provider,
    model: input.activeModel,
    discoveredModelCapabilities: input.activeModelCapabilities,
  });
  const modelOverride = provider && profile
    ? {
        provider,
        model: profile.model,
      }
    : undefined;
  const config: RuntimeAuthorityAdmissionCandidateConfig = {
    tenantId: input.tenantId,
    ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
    ...(input.governedWorkRequirement ? { governedWorkRequirement: input.governedWorkRequirement } : {}),
    ...(modelOverride ? { modelOverride } : {}),
    ...(input.deliberationIntent
      ? { deliberationIntent: input.deliberationIntent, deliberationSource: "operator" }
      : {}),
    ...(input.communicationIntent ? { communicationIntent: input.communicationIntent } : {}),
    ...(input.authorityContext ? { authorityContext: input.authorityContext } : {}),
    ...(input.temporalContext ? { temporalContext: input.temporalContext } : {}),
    ...(profile && (input.activeModelCapabilities?.deliberation || input.communicationIntent)
      ? {
          modelRoutingPolicy: {
            routeCapabilities: new Map([
              [`${profile.provider}/${profile.model}`, {
                ...(input.activeModelCapabilities?.deliberation
                  ? { deliberation: input.activeModelCapabilities.deliberation }
                  : {}),
                ...(input.communicationIntent
                  ? { communication: knownModelCommunicationCapabilities(profile.provider, profile.model) }
                  : {}),
              }],
            ]),
          },
        }
      : {}),
  };
  const builtinToolSurface = input.builtinToolSurface
    ?? (executionMode === "plan"
      ? createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" })
      : DEFAULT_BUILTIN_TOOL_SURFACE);
  const runtimeConfig: RuntimeAuthorityAdmissionCandidateConfig = {
    ...config,
    ...(builtinToolSurface.toolInvocationAdmission
      ? { toolInvocationAdmission: builtinToolSurface.toolInvocationAdmission }
      : {}),
  };

  if (profile?.executionMode !== "kiln-executable") {
    const failClosedConfig: RuntimeAuthorityAdmissionCandidateConfig = {
      ...runtimeConfig,
      additionalTools: builtinToolSurface.toolDefinitions,
      toolAuthority: new Map(),
      perCallCapabilities: builtinToolSurface.capabilities,
    };
    return recordRuntimeAuthoritySnapshot(builtinToolSurface, projectEffectiveTurnAuthorityPerCallConfig({
      config: failClosedConfig,
      executionMode,
      sourcePolicy: "provider_profile_gate",
      reason: profile
        ? `Provider profile execution mode '${profile.executionMode}' is not kiln-executable.`
        : "Provider/model authority input is unresolved; execution profile unavailable.",
      sandboxProjection: "none",
      requestedAuthority,
    })!);
  }

  if (executionMode === "plan") {
    const planSurface = builtinToolSurface.analysisStateStore
      && builtinToolSurface.planStateStore
      && builtinToolSurface.specificationStateStore
      ? builtinToolSurface
      : createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    return recordRuntimeAuthoritySnapshot(planSurface, projectEffectiveTurnAuthorityPerCallConfig({
      config: buildPlanModePerCallConfig(runtimeConfig, planSurface),
      executionMode,
      sourcePolicy: "plan_mode_projection",
      reason: "Plan mode narrows the runtime surface to planning and read-only tools.",
      sandboxProjection: "read_only",
      requestedAuthority,
    })!);
  }
  const executeConfig: RuntimeAuthorityAdmissionCandidateConfig = {
    ...runtimeConfig,
    toolAllowlist: new Set<string>(builtinToolSurface.toolDefinitions.map((tool) => tool.name)),
    toolAuthority: buildEffectiveRuntimeToolAuthority({
      baseAuthority: builtinToolSurface.toolAuthority,
      capabilities: builtinToolSurface.capabilities,
      requestedAuthority,
      authorityContext: input.authorityContext,
    }),
    toolCallMetadata: builtinToolSurface.toolCallMetadata,
    additionalTools: builtinToolSurface.toolDefinitions,
    perCallCapabilities: builtinToolSurface.capabilities,
  };
  return recordRuntimeAuthoritySnapshot(builtinToolSurface, projectEffectiveTurnAuthorityPerCallConfig({
    config: executeConfig,
    executionMode,
    sourcePolicy: "runtime_surface_projection",
    reason: "Authority admitted from the attached runtime allowlist and toolAuthority map.",
    sandboxProjection: "workspace_write",
    requestedAuthority,
  })!);
}

function selectUniqueSuitableRoute(
  routes: readonly ManagedInvocationToolOptions["routes"][number][],
  request: Record<string, unknown>,
): ManagedInvocationToolOptions["routes"][number] | undefined {
  const executionPhase = readRecord(request.executionPhase);
  const taskAffinity = readTextArray(executionPhase?.taskAffinity);
  if (taskAffinity.length === 0) {
    return undefined;
  }
  const scored = routes.map((route) => ({
    route,
    score: taskAffinity.reduce((score, task) => {
      const suitability = route.taskSuitability?.find((entry) => entry.task === task);
      return score + (suitability?.level === "preferred" ? 3 : suitability?.level === "capable" ? 2 : suitability?.level === "limited" ? 1 : 0);
    }, 0),
  }));
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  if (bestScore === 0) {
    return undefined;
  }
  const best = scored.filter((entry) => entry.score === bestScore);
  return best.length === 1 ? best[0]!.route : undefined;
}

function buildEffectiveRuntimeToolAuthority(input: {
  readonly baseAuthority: ReadonlyMap<string, AuthorityDescriptor>;
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly requestedAuthority: OperatorTurnRequestedAuthority;
  readonly authorityContext: EffectiveTurnAuthorityAdmissionContext | undefined;
}): ReadonlyMap<string, AuthorityDescriptor> {
  if (!hasGovernedDestructiveTurnAuthority(input.requestedAuthority, input.authorityContext)) {
    return input.baseAuthority;
  }

  const projected = new Map(input.baseAuthority);
  for (const [toolName, descriptor] of input.baseAuthority.entries()) {
    const capability = input.capabilities.get(toolName);
    if (descriptor.level < 4 || descriptor.allowed || !isDestructiveRuntimeCapability(capability)) {
      continue;
    }
    projected.set(toolName, {
      level: 4,
      allowed: true,
      requiresApproval: false,
      reason: "Governed destructive execution admitted by effective turn authority.",
    });
  }
  return projected;
}

function hasGovernedDestructiveTurnAuthority(
  requestedAuthority: OperatorTurnRequestedAuthority,
  authorityContext: EffectiveTurnAuthorityAdmissionContext | undefined,
): boolean {
  if (requestedAuthority !== "destructive") {
    return false;
  }
  if (authorityContext?.executionUse === "operator_interactive") {
    return authorityContext.sessionPolicy?.maximumAuthority === "destructive"
      && authorityContext.tenantPolicy?.maximumAuthority === "destructive"
      && authorityContext.routePolicy?.maximumAuthority === "destructive";
  }
  return authorityContext?.goalEnvelope?.maximumAuthority === "destructive"
    && authorityContext.workItemAuthority?.maximumAuthority === "destructive";
}

function isDestructiveRuntimeCapability(capability: Capability | undefined): boolean {
  const envelope = capability?.effectEnvelope ?? (capability ? getBuiltinEffectEnvelope(capability.name) : undefined);
  if (!envelope) {
    return false;
  }
  return envelope.operation === "mutate"
    && (
      envelope.reversibility === "irreversible"
      || envelope.reversibility === "unknown"
      || envelope.identityUse === "privileged"
      || envelope.identityUse === "unknown"
      || envelope.dataEgress === "unknown"
      || envelope.consequences.includes("unknown")
    );
}

function recordRuntimeAuthoritySnapshot(
  surface: AttachedRuntimeBuiltinToolSurface | undefined,
  config: RuntimeAuthorityAdmissionCandidateConfig,
): RuntimeAuthorityAdmissionCandidateConfig {
  const effectiveTurnAuthority = config.effectiveTurnAuthority;
  if (effectiveTurnAuthority) {
    surface?.authorityStateStore?.record({
      source: "runtime",
      authority: effectiveTurnAuthority,
    });
  }
  return config;
}

export function resolveAttachedRuntimeToolCallMetadata(
  toolCallMetadata: NonNullable<PerCallToolConfig["toolCallMetadata"]>,
  toolName: string | undefined,
  input: unknown,
): { readonly metadata?: Record<string, unknown> } {
  if (!toolName || !input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const resolver = toolCallMetadata.get(toolName);
  if (!resolver) {
    return {};
  }
  try {
    const metadata = resolver(input as Record<string, unknown>);
    return metadata ? { metadata } : {};
  } catch {
    return {};
  }
}

function buildPlanModePerCallConfig(
  config: RuntimeAuthorityAdmissionCandidateConfig,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface,
): RuntimeAuthorityAdmissionCandidateConfig {
  const toolDefinitions = [...builtinToolSurface.toolDefinitions];
  appendIfMissing(toolDefinitions, SUBMIT_PLAN_TOOL);
  appendIfMissing(toolDefinitions, SUBMIT_SPECIFICATION_TOOL);
  appendIfMissing(toolDefinitions, RECORD_CLARIFICATION_TOOL);
  const capabilities = new Map(builtinToolSurface.capabilities);
  capabilities.set(SUBMIT_PLAN_TOOL.name, SUBMIT_PLAN_CAPABILITY);
  capabilities.set(SUBMIT_SPECIFICATION_TOOL.name, SUBMIT_SPECIFICATION_CAPABILITY);
  capabilities.set(RECORD_CLARIFICATION_TOOL.name, RECORD_CLARIFICATION_CAPABILITY);
  const additionalTools = toolDefinitions.filter((tool) => {
    const capability = capabilities.get(tool.name);
    const envelope = capability?.effectEnvelope ?? getBuiltinEffectEnvelope(tool.name);
    return envelope?.operation === "observe"
      || tool.name === SUBMIT_PLAN_TOOL.name
      || tool.name === SUBMIT_SPECIFICATION_TOOL.name
      || tool.name === RECORD_CLARIFICATION_TOOL.name;
  });
  const toolAllowlist = new Set<string>(additionalTools.map((tool) => tool.name));
  const toolAuthority = new Map<string, AuthorityDescriptor>();
  for (const toolName of toolAllowlist) {
    const capability = capabilities.get(toolName);
    const authority = capability ? authorityFromCapability(toolName, capability) : undefined;
    if (authority) {
      toolAuthority.set(toolName, authority);
    }
  }
  return {
    ...config,
    toolAllowlist,
    toolAuthority,
    toolCallMetadata: builtinToolSurface.toolCallMetadata,
    additionalTools,
    perCallCapabilities: filterMapByAllowlist(capabilities, toolAllowlist),
  };
}

function filterMapByAllowlist<T>(
  entries: ReadonlyMap<string, T> | undefined,
  toolAllowlist: ReadonlySet<string>,
): ReadonlyMap<string, T> | undefined {
  if (!entries) {
    return entries;
  }
  const filteredEntries = new Map<string, T>();
  for (const [toolName, entry] of entries.entries()) {
    if (toolAllowlist.has(toolName)) {
      filteredEntries.set(toolName, entry);
    }
  }
  return filteredEntries;
}

function resolvePerCallExecutionMode(
  executionMode: OperatorExecutionMode | undefined,
): "execute" | "plan" {
  return executionMode === "plan" ? "plan" : "execute";
}

function resolveAttachedRuntimeRequestedAuthority(value: unknown): OperatorTurnRequestedAuthority | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "auto" || value === "read_only" || value === "audited" || value === "destructive") {
    return value;
  }
  throw new Error(`Unknown requested authority '${String(value)}'.`);
}

function appendIfMissing(
  tools: ToolDefinition[],
  tool: ToolDefinition,
): void {
  if (!tools.some((candidate) => candidate.name === tool.name)) {
    tools.push(tool);
  }
}

function buildBuiltinToolExecutors(
  surface: DefaultBuiltinToolSurface,
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> {
  const executors = new Map<string, RuntimeBuiltinToolExecutor>();
  for (const tool of surface.registry.list()) {
    const toolName = tool.name;
    executors.set(toolName, async (input, context) => {
      if (!context?.authority || !context.resolvedEffect) {
        throw new Error(`Runtime builtin tool "${toolName}" requires admitted authority and resolved effect evidence.`);
      }
      const authority = context.authority;
      const resolvedEffect = context.resolvedEffect;
      const sandbox = mergeToolSandboxContext(context?.sandbox, context?.allowedToolNames);
      const executionContext = createCoreToolExecutionContext(
        toolName,
        surface,
        context,
        tool,
      );
      const execute = () => surface.bridge.executeAdmitted({
        name: toolName,
        input,
        authority,
        resolvedEffect,
        ...(sandbox !== undefined ? { sandbox } : {}),
        ...(executionContext ? { executionContext } : {}),
      });
      const transport = executionContext?.[FORMAL_VERIFICATION_FINISH_TRANSPORT];
      const execution = transport && toolName === "work_item.execution.finish"
        ? await runRuntimeFormalVerificationFinishInvocation(tool, transport, execute)
        : await execute();
      const result = execution.result;
      const resourceLinks = projectToolResultResourceLinks(result);
      const resourceLinkContent = (result.content ?? []).filter(isResourceLinkContent);
      return {
        output: resourceLinks.length > 0 ? formatLinkedOutput(resourceLinks, result.metadata) : result.output,
        isError: result.isError,
        metadata: result.metadata,
        ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
        ...(resourceLinkContent.length > 0 ? { content: resourceLinkContent } : {}),
      };
    });
  }
  return executors;
}

function createSessionAwareGoalContractSupersedeExecutor(
  goalContractSupersedeExecutor: RuntimeBuiltinToolExecutor,
): RuntimeBuiltinToolExecutor {
  return async (input, context) => {
    if (!context?.operatorAdoptionDecision) {
      return {
        output: JSON.stringify({
          error: {
            code: "operator_adoption_decision_missing",
            message: "goal.bounded_work_contract.supersede requires a canonical runtime operator adoption decision.",
            recoverable: false,
          },
        }, null, 2),
        isError: true,
      };
    }
    return goalContractSupersedeExecutor({
      ...input,
      contractAuthority: context.operatorAdoptionDecision.contractAuthority,
    }, context);
  };
}

function createCoreToolExecutionContext(
  toolName: string,
  surface: DefaultBuiltinToolSurface,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  registeredTool: DevTool,
): DevToolExecutionContext | undefined {
  const transport = toolName === "work_item.execution.finish"
    ? createFormalVerificationFinishTransport(surface, context, registeredTool)
    : undefined;
  const isManagedChild = context?.executionScope?.managedInvocationId !== undefined;
  if (!context?.abortSignal && !context?.emitOutput && !transport && (!context?.operatorAdoptionDecision || isManagedChild)) return undefined;

  const executionContext: DevToolExecutionContext = {
    ...(context?.abortSignal ? { abortSignal: context.abortSignal } : {}),
    ...(context?.emitOutput ? { onOutput: context.emitOutput } : {}),
  };
  if (transport) {
    Object.defineProperty(executionContext, FORMAL_VERIFICATION_FINISH_TRANSPORT, {
      configurable: false,
      enumerable: false,
      value: transport,
      writable: false,
    });
  }
  if (context?.operatorAdoptionDecision && !isManagedChild) {
    Object.defineProperty(executionContext, OPERATOR_ADOPTION_DECISION_TRANSPORT, {
      configurable: false,
      enumerable: false,
      value: context.operatorAdoptionDecision,
      writable: false,
    });
  }
  return executionContext;
}

function createFormalVerificationFinishTransport(
  surface: DefaultBuiltinToolSurface,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  registeredFinishTool: DevTool,
): FormalVerificationFinishTransportEnvelope | undefined {
  const executionScope = normalizeFormalVerificationFinishScope(context?.executionScope);
  const observations = context?.formalVerificationObservations;
  if (
    !executionScope
    || !observations
    || !Array.isArray(observations)
    || observations.length === 0
    || !Object.isFrozen(observations)
  ) return undefined;

  const registeredFormalVerify = surface.registry.lookup("formal_verify");
  if (
    registeredFinishTool.name !== "work_item.execution.finish"
    || !registeredFormalVerify
    || registeredFormalVerify.name !== "formal_verify"
  ) return undefined;

  const observationsByIdentity = new Map<string, FormalVerificationFinishTransportObservation | null>();
  for (const observation of observations) {
    if (
      !observation
      || typeof observation !== "object"
      || !isRuntimeOwnedFormalVerificationObservation(observation)
      || !Object.isFrozen(observation)
      || !isCanonicalTransportId(observation.toolCallScopeId)
      || !isCanonicalTransportId(observation.toolCallId)
    ) {
      return undefined;
    }
    const observationScope = normalizeFormalVerificationFinishScope(observation.executionScope);
    if (!observationScope || !sameFormalVerificationFinishScope(observationScope, executionScope)) return undefined;
    let metadata: FormalVerificationTransportMetadata;
    try {
      metadata = parseFormalVerificationToolResultMetadata(observation.metadata);
    } catch {
      return undefined;
    }
    const normalizedObservation = Object.freeze({
      metadata,
      toolCallScopeId: observation.toolCallScopeId,
      toolCallId: observation.toolCallId,
      executionScope: observationScope,
    });
    const identity = JSON.stringify([normalizedObservation.toolCallScopeId, normalizedObservation.toolCallId]);
    const previous = observationsByIdentity.get(identity);
    if (!observationsByIdentity.has(identity)) {
      observationsByIdentity.set(identity, normalizedObservation);
    } else if (previous && sameFormalVerificationTransportObservation(previous, normalizedObservation)) {
      continue;
    } else {
      observationsByIdentity.set(identity, null);
    }
  }
  const normalizedObservations = [...observationsByIdentity.values()].filter(
    (observation): observation is FormalVerificationFinishTransportObservation => observation !== null,
  );
  if (normalizedObservations.length === 0) return undefined;

  const envelope: FormalVerificationFinishTransportEnvelope = {
    observations: Object.freeze(normalizedObservations),
    executionScope,
    recordedAt: new Date().toISOString(),
    producer: Object.freeze({ kind: "registered_tool", toolName: registeredFormalVerify.name }),
  };
  return Object.freeze(envelope);
}

type FormalVerificationTransportMetadata = FormalVerificationFinishTransportObservation["metadata"];

function sameFormalVerificationTransportObservation(
  left: FormalVerificationFinishTransportObservation,
  right: FormalVerificationFinishTransportObservation,
): boolean {
  return left.toolCallScopeId === right.toolCallScopeId
    && left.toolCallId === right.toolCallId
    && sameFormalVerificationFinishScope(left.executionScope, right.executionScope)
    && JSON.stringify(left.metadata) === JSON.stringify(right.metadata);
}

function normalizeFormalVerificationFinishScope(
  value: RuntimeBuiltinToolExecutionContext["executionScope"] | FormalVerificationFinishExecutionScope | undefined,
): FormalVerificationFinishExecutionScope | undefined {
  if (!value || value.kind !== "work_item") return undefined;
  if (!isNonEmptyTransportString(value.goalRunId) || !isNonEmptyTransportString(value.workItemId)) return undefined;
  if (!isNonEmptyTransportString(value.attemptId)) return undefined;
  if (hasOwnTransportProperty(value, "managedInvocationId") && !isNonEmptyTransportString(value.managedInvocationId)) {
    return undefined;
  }
  return Object.freeze({
    kind: "work_item",
    goalRunId: value.goalRunId,
    workItemId: value.workItemId,
    attemptId: value.attemptId,
    ...(hasOwnTransportProperty(value, "managedInvocationId") ? { managedInvocationId: value.managedInvocationId } : {}),
  });
}

function sameFormalVerificationFinishScope(
  left: FormalVerificationFinishExecutionScope,
  right: FormalVerificationFinishExecutionScope,
): boolean {
  return left.goalRunId === right.goalRunId
    && left.workItemId === right.workItemId
    && left.attemptId === right.attemptId
    && hasOwnTransportProperty(left, "managedInvocationId") === hasOwnTransportProperty(right, "managedInvocationId")
    && (!hasOwnTransportProperty(left, "managedInvocationId") || left.managedInvocationId === right.managedInvocationId);
}

function hasOwnTransportProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNonEmptyTransportString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isCanonicalTransportId(value: unknown): value is string {
  return isNonEmptyTransportString(value);
}

function mergeToolSandboxContext(
  sandbox: unknown,
  allowedToolNames: readonly string[] | undefined,
): unknown {
  if (allowedToolNames === undefined) {
    return sandbox;
  }
  if (sandbox && typeof sandbox === "object" && !Array.isArray(sandbox)) {
    return {
      ...(sandbox as Record<string, unknown>),
      allowedToolNames,
    };
  }
  return { allowedToolNames };
}

function formatLinkedOutput(
  resourceLinks: readonly { readonly uri: string; readonly title?: string }[],
  metadata: ToolResultMetadata | undefined,
): string {
  return [
    ...formatLinkedOutputSourceLedger(metadata),
    "Full tool output is available as resource links:",
    ...resourceLinks.map((link) => `- ${link.title ?? "tool output"}: ${link.uri}`),
  ].join("\n");
}

function formatLinkedOutputSourceLedger(metadata: ToolResultMetadata | undefined): string[] {
  if (metadata?.kind !== "web") {
    return [];
  }

  if (metadata.sources?.length) {
    return [
      "Source summary:",
      ...metadata.sources.slice(0, 8).map((source) => [
        source.rank ? `${source.rank}.` : "-",
        truncateLinkedOutputText(source.title ?? source.url, 120),
        source.url,
      ].join(" ")),
      "",
    ];
  }

  if (metadata.pages?.length) {
    return [
      "Source pages:",
      ...metadata.pages.slice(0, 8).map((page) => [
        page.title ? truncateLinkedOutputText(page.title, 120) : undefined,
        page.url,
      ].filter(Boolean).join(" ")),
      "",
    ];
  }

  if (metadata.url) {
    return ["Source:", metadata.url, ""];
  }

  return [];
}

function truncateLinkedOutputText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function isResourceLinkContent(
  content: ToolResultContentPart,
): content is Extract<ToolResultContentPart, { readonly type: "resource_link" }> {
  return content.type === "resource_link";
}

function buildBuiltinToolAuthority(
  capabilities: ReadonlyMap<string, Capability>,
): ReadonlyMap<string, AuthorityDescriptor> {
  const toolAuthority = new Map<string, AuthorityDescriptor>();
  for (const [toolName, capability] of capabilities.entries()) {
    toolAuthority.set(toolName, authorityFromCapability(toolName, capability));
  }
  return toolAuthority;
}

async function executeOperatorSetTheme(
  input: Record<string, unknown>,
  controller: OperatorSurfaceThemeController,
): Promise<{ readonly output: string; readonly isError: boolean; readonly metadata: Record<string, unknown> }> {
  const theme = typeof input.theme === "string" ? input.theme.trim() : "";
  if (!isOperatorThemeName(theme)) {
    return {
      output: `Unknown operator theme '${theme || "<empty>"}'.`,
      isError: true,
      metadata: { reason: "invalid_theme" },
    };
  }
  const reason = typeof input.reason === "string" && input.reason.trim().length > 0
    ? input.reason.trim()
    : undefined;
  const result = await controller.setTheme({ theme, ...(reason ? { reason } : {}) });
  if (!result.ok) {
    return {
      output: result.error ?? `Theme '${theme}' was not applied.`,
      isError: true,
      metadata: { theme, scope: "session", applied: false, error: result.error },
    };
  }
  return {
    output: `Applied operator theme '${result.appliedTheme ?? theme}' (session).`,
    isError: false,
    metadata: { theme, scope: "session", appliedTheme: result.appliedTheme ?? theme },
  };
}

async function executeSubmitPlan(
  input: Record<string, unknown>,
  analysisStateStore: AnalysisStateStore,
  planStateStore: PlanStateStore,
  specificationStateStore: SpecificationStateStore,
): Promise<{ readonly output: string; readonly isError: boolean; readonly metadata: Record<string, unknown> }> {
  const planId = asOptionalPresentText(input.planId, "planId");
  const objective = asRequiredText(input.objective, "objective");
  const nonGoals = asRequiredTextArray(input.nonGoals, "nonGoals");
  const operatorDecisionsRequired = asRequiredTextArray(input.operatorDecisionsRequired, "operatorDecisionsRequired");
  const assumptions = asRequiredTextArray(input.assumptions, "assumptions");
  const affectedSurfaces = asRequiredTextArray(input.affectedSurfaces, "affectedSurfaces");
  const sourceSpecificationId = asRequiredText(input.sourceSpecificationId, "sourceSpecificationId");
  const riskClassification = asRiskClassification(input.riskClassification);
  const recommendation = asWorkGovernanceRecommendation(input.workGovernanceRecommendation);
  const expectedEvidence = asRequiredTextArray(input.expectedEvidence, "expectedEvidence");
  const verificationGates = asRequiredTextArray(input.verificationGates, "verificationGates");
  const managedAgentDelegationCandidates = asRequiredTextArray(
    input.managedAgentDelegationCandidates,
    "managedAgentDelegationCandidates",
  );
  const approvalBoundaries = asRequiredTextArray(input.approvalBoundaries, "approvalBoundaries");
  const rollbackNotes = asRequiredString(input.rollbackNotes, "rollbackNotes", { allowEmpty: true });
  const residualRisks = asRequiredTextArray(input.residualRisks, "residualRisks");
  const clarificationRecordIds = asRequiredTextArray(input.clarificationRecordIds, "clarificationRecordIds");
  const constitution = asConstitutionSnapshot(input.constitutionSnapshot);
  const proposedWorkItems = asPlanWorkItems(input.proposedWorkItems);
  if (
    !planId.ok
    || !objective.ok
    || !nonGoals.ok
    || !operatorDecisionsRequired.ok
    || !assumptions.ok
    || !affectedSurfaces.ok
    || !sourceSpecificationId.ok
    || !riskClassification.ok
    || !recommendation.ok
    || !expectedEvidence.ok
    || !verificationGates.ok
    || !managedAgentDelegationCandidates.ok
    || !approvalBoundaries.ok
    || !rollbackNotes.ok
    || !residualRisks.ok
    || !clarificationRecordIds.ok
    || !constitution.ok
    || !proposedWorkItems.ok
  ) {
    return {
      output: "Invalid structured plan payload.",
      isError: true,
      metadata: { toolName: SUBMIT_PLAN_TOOL.name, reason: "invalid_input" },
    };
  }

  const sourceSpecification = specificationStateStore.getSpecification(sourceSpecificationId.value);
  if (!sourceSpecification) {
    return {
      output: `Source specification not found: ${sourceSpecificationId.value}.`,
      isError: true,
      metadata: {
        toolName: SUBMIT_PLAN_TOOL.name,
        operation: "submit_plan",
        reason: "missing_specification",
        sourceSpecificationId: sourceSpecificationId.value,
      },
    };
  }
  const blockingIssues = sourceSpecification.issues.filter((issue) => issue.blocking);
  if (blockingIssues.length > 0) {
    return {
      output: "Cannot submit plan while source specification has blocking validation issues.",
      isError: true,
      metadata: {
        toolName: SUBMIT_PLAN_TOOL.name,
        operation: "submit_plan",
        reason: "blocking_specification_issues",
        specificationId: sourceSpecification.id,
        blockingIssueCount: blockingIssues.length,
        blockingIssueCodes: blockingIssues.map((issue) => issue.code),
      },
    };
  }

  const clarificationSet = new Set(specificationStateStore.listClarifications(sourceSpecification.id).map((item) => item.id));
  const unknownClarificationIds = clarificationRecordIds.value.filter((clarificationId) => !clarificationSet.has(clarificationId));
  if (unknownClarificationIds.length > 0) {
    return {
      output: `Unknown clarification ids for specification ${sourceSpecification.id}: ${unknownClarificationIds.join(", ")}.`,
      isError: true,
      metadata: {
        toolName: SUBMIT_PLAN_TOOL.name,
        operation: "submit_plan",
        reason: "unknown_clarification_ids",
        sourceSpecificationId: sourceSpecification.id,
        unknownClarificationIds,
      },
    };
  }

  if (constitution.value.instructionProfileHash !== sourceSpecification.constitutionSnapshot.instructionProfileHash) {
    return {
      output: "Plan constitution snapshot hash does not match the source specification snapshot.",
      isError: true,
      metadata: {
        toolName: SUBMIT_PLAN_TOOL.name,
        operation: "submit_plan",
        reason: "constitution_snapshot_mismatch",
        sourceSpecificationId: sourceSpecification.id,
      },
    };
  }

  const plan = planStateStore.submitPlan({
    planId: planId.value,
    objective: objective.value,
    nonGoals: nonGoals.value,
    operatorDecisionsRequired: operatorDecisionsRequired.value,
    assumptions: assumptions.value,
    affectedSurfaces: affectedSurfaces.value,
    riskClassification: riskClassification.value,
    workGovernanceRecommendation: recommendation.value,
    proposedWorkItems: proposedWorkItems.value,
    expectedEvidence: expectedEvidence.value,
    verificationGates: verificationGates.value,
    managedAgentDelegationCandidates: managedAgentDelegationCandidates.value,
    approvalBoundaries: approvalBoundaries.value,
    rollbackNotes: rollbackNotes.value,
    residualRisks: residualRisks.value,
    sourceSpecificationId: sourceSpecification.id,
    clarificationRecordIds: clarificationRecordIds.value,
    constitutionSnapshot: constitution.value,
  });
  const planBlockingIssues = plan.issues.filter((issue) => issue.blocking);
  if (planBlockingIssues.length > 0) {
    return {
      output: `Plan ${plan.id} submitted with blocking validation issues.`,
      isError: true,
      metadata: {
        toolName: SUBMIT_PLAN_TOOL.name,
        operation: "submit_plan",
        planId: plan.id,
        sourceSpecificationId: sourceSpecification.id,
        planStatus: plan.status,
        blockingIssueCount: planBlockingIssues.length,
        blockingIssueCodes: planBlockingIssues.map((issue) => issue.code),
      },
    };
  }

  const analysisResult = analysisStateStore.analyzePlan({
    specification: sourceSpecification,
    plan,
  });
  const analysisMetadata = {
    analysisReportId: analysisResult.report.id,
    analysisStatus: analysisResult.report.status,
    analysisHighestSeverity: analysisResult.report.highestSeverity,
    analysisFindingCount: analysisResult.report.findingIds.length,
    analysisBlockingFindingCount: analysisResult.report.blockingFindingIds.length,
    analysisFindingIds: analysisResult.report.findingIds,
    analysisBlockingFindingIds: analysisResult.report.blockingFindingIds,
    analysisFindings: analysisResult.findings,
    analysisSummary: analysisResult.report.summary,
  };
  const renderedPlan = renderPlanArtifact(plan);
  const commonMetadata = {
    toolName: SUBMIT_PLAN_TOOL.name,
    operation: "submit_plan",
    planId: plan.id,
    planHash: plan.contentHash,
    planStatus: plan.status,
    sourceSpecificationId: sourceSpecification.id,
    sourceSpecificationStatus: sourceSpecification.status,
    riskClassification: plan.riskClassification,
    workGovernancePosture: plan.workGovernanceRecommendation.posture,
    workflowProfile: plan.workGovernanceRecommendation.workflowProfile,
    workGovernanceRationale: plan.workGovernanceRecommendation.rationale,
    objective: plan.objective,
    nonGoals: plan.nonGoals,
    operatorDecisionsRequired: plan.operatorDecisionsRequired,
    assumptions: plan.assumptions,
    affectedSurfaces: plan.affectedSurfaces,
    expectedEvidence: plan.expectedEvidence,
    verificationGates: plan.verificationGates,
    managedAgentDelegationCandidates: plan.managedAgentDelegationCandidates,
    approvalBoundaries: plan.approvalBoundaries,
    rollbackNotes: plan.rollbackNotes,
    residualRisks: plan.residualRisks,
    clarificationRecordIds: plan.clarificationRecordIds,
    constitutionSnapshotHash: plan.constitutionSnapshot.instructionProfileHash,
    constitutionSnapshotIds: plan.constitutionSnapshot.instructionProfileIds,
    proposedWorkItemCount: plan.proposedWorkItems.length,
    proposedWorkItems: plan.proposedWorkItems,
    clarificationRecordCount: plan.clarificationRecordIds.length,
    summary: plan.objective,
    renderedPlan,
    ...analysisMetadata,
  };

  if (analysisResult.report.status === "blocked") {
    return {
      output: `Plan ${plan.id} blocked by critical analysis findings.`,
      isError: true,
      metadata: commonMetadata,
    };
  }

  return {
    output: renderedPlan,
    isError: false,
    metadata: commonMetadata,
  };
}

function renderPlanArtifact(plan: SessionPlan): string {
  const lines = [
    plan.objective,
    `- risk: ${plan.riskClassification}`,
    `- posture: ${plan.workGovernanceRecommendation.posture}`,
    `- workflow: ${plan.workGovernanceRecommendation.workflowProfile}`,
    `- governance rationale: ${plan.workGovernanceRecommendation.rationale}`,
    `- source specification: ${plan.sourceSpecificationId}`,
    ...plan.clarificationRecordIds.map((clarification) => `- clarification: ${clarification}`),
    ...plan.affectedSurfaces.map((surface) => `- affected surface: ${surface}`),
    ...plan.nonGoals.map((goal) => `- non-goal: ${goal}`),
    ...plan.assumptions.map((assumption) => `- assumption: ${assumption}`),
    ...plan.operatorDecisionsRequired.map((decision) => `- decision: ${decision}`),
    ...plan.expectedEvidence.map((evidence) => `- evidence: ${evidence}`),
    ...plan.verificationGates.map((gate) => `- gate: ${gate}`),
    ...plan.managedAgentDelegationCandidates.map((candidate) => `- delegation candidate: ${candidate}`),
    ...plan.approvalBoundaries.map((boundary) => `- approval boundary: ${boundary}`),
    plan.rollbackNotes ? `- rollback: ${plan.rollbackNotes}` : undefined,
    ...plan.residualRisks.map((risk) => `- residual risk: ${risk}`),
    ...plan.proposedWorkItems.flatMap((item) => [
      `- work item ${item.id}: ${item.summary}`,
      `  workflow: ${item.workflowProfile}`,
      `  risk: ${item.risk}`,
      ...item.expectedEvidence.map((evidence) => `  evidence: ${evidence}`),
      ...item.verificationGates.map((gate) => `  gate: ${gate}`),
      ...item.dependencies.map((dependency) => `  depends on: ${dependency}`),
    ]),
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

async function executeSubmitSpecification(
  input: Record<string, unknown>,
  specificationStateStore: SpecificationStateStore | undefined,
): Promise<{ readonly output: string; readonly isError: boolean; readonly metadata: Record<string, unknown> }> {
  if (!specificationStateStore) {
    return {
      output: "Structured specification store is unavailable for this runtime session.",
      isError: true,
      metadata: { toolName: SUBMIT_SPECIFICATION_TOOL.name, reason: "specification_store_unavailable" },
    };
  }

  const specificationId = asOptionalPresentText(input.specificationId, "specificationId");
  const title = asRequiredText(input.title, "title");
  const objective = asRequiredText(input.objective, "objective");
  const nonGoals = asRequiredTextArray(input.nonGoals, "nonGoals");
  const successCriteria = asRequiredTextArray(input.successCriteria, "successCriteria");
  const actors = asRequiredTextArray(input.actors, "actors");
  const dataLifecycle = asRequiredText(input.dataLifecycle, "dataLifecycle");
  const uxEdgeCases = asRequiredTextArray(input.uxEdgeCases, "uxEdgeCases");
  const securityPrivacy = asRequiredText(input.securityPrivacy, "securityPrivacy");
  const externalDependencies = asRequiredTextArray(input.externalDependencies, "externalDependencies");
  const completionSignals = asRequiredTextArray(input.completionSignals, "completionSignals");
  const constitution = asConstitutionSnapshot(input.constitutionSnapshot);
  if (
    !specificationId.ok
    || !title.ok
    || !objective.ok
    || !nonGoals.ok
    || !successCriteria.ok
    || !actors.ok
    || !dataLifecycle.ok
    || !uxEdgeCases.ok
    || !securityPrivacy.ok
    || !externalDependencies.ok
    || !completionSignals.ok
    || !constitution.ok
  ) {
    return {
      output: "Invalid specification payload.",
      isError: true,
      metadata: {
        toolName: SUBMIT_SPECIFICATION_TOOL.name,
        operation: "submit_specification",
        reason: "invalid_input",
      },
    };
  }

  const specification = specificationStateStore.upsertSpecification({
    id: specificationId.value,
    title: title.value,
    objective: objective.value,
    nonGoals: nonGoals.value,
    successCriteria: successCriteria.value,
    actors: actors.value,
    dataLifecycle: dataLifecycle.value,
    uxEdgeCases: uxEdgeCases.value,
    securityPrivacy: securityPrivacy.value,
    externalDependencies: externalDependencies.value,
    completionSignals: completionSignals.value,
    constitutionSnapshot: constitution.value,
  });
  const blockingIssues = specification.issues.filter((issue) => issue.blocking);

  return {
    output: blockingIssues.length === 0
      ? `Specification ${specification.id} submitted and ready for planning.`
      : `Specification ${specification.id} submitted with blocking issues.`,
    isError: false,
    metadata: {
      toolName: SUBMIT_SPECIFICATION_TOOL.name,
      operation: "submit_specification",
      specificationId: specification.id,
      specificationStatus: specification.status,
      blockingIssueCount: blockingIssues.length,
      blockingIssueCodes: blockingIssues.map((issue) => issue.code),
      issueCount: specification.issues.length,
      issues: specification.issues.map((issue) => ({
        code: issue.code,
        field: issue.field,
        blocking: issue.blocking,
      })),
    },
  };
}

async function executeRecordClarification(
  input: Record<string, unknown>,
  specificationStateStore: SpecificationStateStore | undefined,
): Promise<{ readonly output: string; readonly isError: boolean; readonly metadata: Record<string, unknown> }> {
  if (!specificationStateStore) {
    return {
      output: "Structured specification store is unavailable for this runtime session.",
      isError: true,
      metadata: { toolName: RECORD_CLARIFICATION_TOOL.name, reason: "specification_store_unavailable" },
    };
  }
  const specificationId = asRequiredText(input.specificationId, "specificationId");
  const question = asRequiredText(input.question, "question");
  const answer = asRequiredText(input.answer, "answer");
  const affectedSection = asRequiredText(input.affectedSection, "affectedSection");
  const rationale = asRequiredText(input.rationale, "rationale");
  if (!specificationId.ok || !question.ok || !answer.ok || !affectedSection.ok || !rationale.ok) {
    return {
      output: "Invalid clarification payload.",
      isError: true,
      metadata: {
        toolName: RECORD_CLARIFICATION_TOOL.name,
        operation: "record_clarification",
        reason: "invalid_input",
      },
    };
  }
  const result = specificationStateStore.recordClarification({
    specificationId: specificationId.value,
    question: question.value,
    answer: answer.value,
    affectedSection: affectedSection.value,
    rationale: rationale.value,
  });
  if ("error" in result) {
    return {
      output: result.error,
      isError: true,
      metadata: {
        toolName: RECORD_CLARIFICATION_TOOL.name,
        operation: "record_clarification",
        reason: "clarification_rejected",
        specificationId: specificationId.value,
      },
    };
  }

  return {
    output: `Clarification ${result.clarification.id} recorded for specification ${result.specification.id}.`,
    isError: false,
    metadata: {
      toolName: RECORD_CLARIFICATION_TOOL.name,
      operation: "record_clarification",
      specificationId: result.specification.id,
      clarificationId: result.clarification.id,
      affectedSection: result.clarification.affectedSection,
      specificationStatus: result.specification.status,
      openBlockingIssues: result.specification.issues.filter((issue) => issue.blocking).map((issue) => issue.code),
    },
  };
}

function asRiskClassification(
  value: unknown,
): { readonly ok: true; readonly value: "low" | "medium" | "high" | "critical" } | { readonly ok: false } {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return { ok: true, value };
  }
  return { ok: false };
}

function asWorkflowProfile(value: unknown): WorkflowProfile | undefined {
  if (
    value === "small-fix"
    || value === "bug-diagnosis"
    || value === "architecture-review"
    || value === "architecture-change"
    || value === "ui-change"
    || value === "managed-agent-change"
    || value === "config-change"
    || value === "verification-heavy"
    || value === "formal-proof-candidate"
  ) {
    return value;
  }
  return undefined;
}

function asWorkGovernanceRecommendation(
  value: unknown,
): {
  readonly ok: true;
  readonly value: {
    readonly posture: "direct" | "orchestrate" | "delegate";
    readonly rationale: string;
    readonly workflowProfile: WorkflowProfile;
  };
} | { readonly ok: false } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }
  const record = value as Record<string, unknown>;
  const posture = record.posture;
  if (posture !== "direct" && posture !== "orchestrate" && posture !== "delegate") {
    return { ok: false };
  }
  const rationale = asOptionalText(record.rationale);
  const workflowProfile = asWorkflowProfile(record.workflowProfile);
  if (!rationale || !workflowProfile) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      posture,
      rationale,
      workflowProfile,
    },
  };
}

function asPlanWorkItems(
  value: unknown,
): {
  readonly ok: true;
  readonly value: readonly {
    readonly id: string;
    readonly summary: string;
    readonly workflowProfile: WorkflowProfile;
    readonly risk: "low" | "medium" | "high" | "critical";
    readonly expectedEvidence: readonly string[];
    readonly verificationGates: readonly string[];
    readonly dependencies: readonly string[];
  }[];
} | { readonly ok: false } {
  if (!Array.isArray(value)) {
    return { ok: false };
  }
  const workItems: Array<{
    readonly id: string;
    readonly summary: string;
    readonly workflowProfile: WorkflowProfile;
    readonly risk: "low" | "medium" | "high" | "critical";
    readonly expectedEvidence: readonly string[];
    readonly verificationGates: readonly string[];
    readonly dependencies: readonly string[];
  }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false };
    }
    const record = entry as Record<string, unknown>;
    const id = asOptionalText(record.id);
    const summary = asOptionalText(record.summary);
    const workflowProfile = asWorkflowProfile(record.workflowProfile);
    const risk = asRiskClassification(record.risk);
    const expectedEvidence = asRequiredTextArray(record.expectedEvidence, "expectedEvidence");
    const verificationGates = asRequiredTextArray(record.verificationGates, "verificationGates");
    const dependencies = asRequiredTextArray(record.dependencies, "dependencies");
    if (!id || !summary || !workflowProfile || !risk.ok || !expectedEvidence.ok || !verificationGates.ok || !dependencies.ok) {
      return { ok: false };
    }
    workItems.push({
      id,
      summary,
      workflowProfile,
      risk: risk.value,
      expectedEvidence: expectedEvidence.value,
      verificationGates: verificationGates.value,
      dependencies: dependencies.value,
    });
  }
  return { ok: true, value: workItems };
}

function asOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTextFromUnknown(value: unknown): string | undefined {
  return asOptionalText(value);
}

function readTextArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map((item) => readTextFromUnknown(item)).filter((item): item is string => item !== undefined)
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asRequiredText(
  value: unknown,
  _field: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false } {
  const normalized = asOptionalText(value);
  return normalized ? { ok: true, value: normalized } : { ok: false };
}

function asRequiredString(
  value: unknown,
  _field: string,
  options: { readonly allowEmpty?: boolean } = {},
): { readonly ok: true; readonly value: string } | { readonly ok: false } {
  if (typeof value !== "string") {
    return { ok: false };
  }
  const normalized = value.trim();
  if (!options.allowEmpty && normalized.length === 0) {
    return { ok: false };
  }
  return { ok: true, value: normalized };
}

function asRequiredTextArray(
  value: unknown,
  _field: string,
): { readonly ok: true; readonly value: readonly string[] } | { readonly ok: false } {
  if (!Array.isArray(value)) {
    return { ok: false };
  }
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return { ok: false };
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return { ok: false };
    }
    normalized.push(trimmed);
  }
  return { ok: true, value: [...new Set(normalized)] };
}

function asOptionalPresentText(
  value: unknown,
  _field: string,
): { readonly ok: true; readonly value: string | undefined } | { readonly ok: false } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  const normalized = asOptionalText(value);
  if (!normalized) {
    return { ok: false };
  }
  return { ok: true, value: normalized };
}

function asConstitutionSnapshot(
  value: unknown,
): { readonly ok: true; readonly value: { readonly instructionProfileHash: string; readonly instructionProfileIds: readonly string[] } } | { readonly ok: false } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }
  const record = value as Record<string, unknown>;
  const hash = asOptionalText(record.instructionProfileHash);
  const ids = asRequiredTextArray(record.instructionProfileIds, "constitutionSnapshot.instructionProfileIds");
  if (!hash || !ids.ok || ids.value.length === 0) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      instructionProfileHash: hash,
      instructionProfileIds: ids.value,
    },
  };
}
