import type {
  AnalysisStateStore,
  AuthorityStateStore,
  AuthorityDescriptor,
  Capability,
  DefaultBuiltinToolSurface,
  DefaultBuiltinToolRegistryOptions,
  DiscoveredDirectProviderModelCapabilities,
  ManagedAgentAdmissionProfile,
  ToolDefinition,
  ToolResourceDisplayDescriptor,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
  SpecificationStateStore,
  ToolResultContentPart,
} from "@kilnai/core";
import type { PlanStateStore, SessionPlan, WorkflowProfile } from "@kilnai/core";
import {
  createDefaultBuiltinToolSurface,
  createSessionBuiltinToolOptions,
  isDirectProviderId,
  projectToolResourceDescriptor,
  projectToolResultResourceLinks,
  resolveDirectProviderExecutionProfile,
} from "@kilnai/core";
import {
  OPERATOR_THEME_NAMES,
  isOperatorThemeName,
  type OperatorExecutionMode,
  type OperatorTurnRequestedAuthority,
  type OperatorThemeScope,
} from "@kilnai/gateway-contracts";
import type {
  OperatorSurfaceController,
  OperatorSurfaceThemeController,
} from "../operator/operator-surface-controller.js";
import type {
  PerCallToolConfig,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
} from "../session/runtime-session-orchestrator.js";
import type { EffectiveTurnAuthorityAdmissionContext } from "../session/effective-turn-authority.js";
import { projectEffectiveTurnAuthorityPerCallConfig } from "../session/effective-turn-authority.js";
import {
  createManagedAgentInvokeToolDefinition,
  createManagedInvocationToolCallMetadataResolver,
  createManagedInvocationToolExecutor,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  type ManagedInvocationToolOptions,
} from "../agents/managed-invocation/runtime-tool.js";
import { buildManagedInvocationPhaseRecovery } from "../agents/managed-invocation/phase-recovery.js";
import { authorityFromCapability } from "./tool-authority.js";

export interface AttachedRuntimeBuiltinToolSurface {
  readonly callBuiltinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor>;
  readonly toolCallMetadata: NonNullable<PerCallToolConfig["toolCallMetadata"]>;
  readonly analysisStateStore?: AnalysisStateStore;
  readonly authorityStateStore?: AuthorityStateStore;
  readonly planStateStore?: PlanStateStore;
  readonly specificationStateStore?: SpecificationStateStore;
  listResources(): readonly ToolResourceDisplayDescriptor[];
  listResourceTemplates(): readonly ToolResourceTemplateDescriptor[];
  readResource(uri: string): Promise<ToolResourceReadResult>;
}

export interface AttachedRuntimeBuiltinToolSurfaceOptions {
  readonly operatorSurface?: OperatorSurfaceController;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly executionMode?: OperatorExecutionMode;
  readonly managedInvocation?: ManagedInvocationToolOptions;
}

const DEFAULT_CORE_BUILTIN_TOOL_SURFACE = createDefaultBuiltinToolSurface();
const DEFAULT_BUILTIN_TOOL_SURFACE: AttachedRuntimeBuiltinToolSurface = buildRuntimeSurface(
  DEFAULT_CORE_BUILTIN_TOOL_SURFACE,
);
const WORK_ITEM_EXECUTION_START_TOOL_NAME = "work_item.execution.start";

const OPERATOR_SET_THEME_TOOL: ToolDefinition = {
  name: "operator_set_theme",
  description: "Change the operator surface theme when the connected CLI/GUI/TUI surface supports it. Use scope='session' for the live surface and scope='persisted' only when the operator explicitly asks to save the preference.",
  inputSchema: {
    type: "object",
    properties: {
      theme: {
        type: "string",
        enum: OPERATOR_THEME_NAMES,
        description: "Theme name to apply.",
      },
      scope: {
        type: "string",
        enum: ["session", "persisted"],
        description: "session applies only to the live surface; persisted also asks the surface to save the preference.",
        default: "session",
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
  annotations: { idempotent: true },
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
  annotations: { readOnly: true },
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
  annotations: { readOnly: true },
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
  annotations: { readOnly: true },
};

const GOAL_CREATE_TOOL_NAME = "goal.create";

export function createAttachedRuntimeBuiltinToolSurface(
  options: AttachedRuntimeBuiltinToolSurfaceOptions = {},
): AttachedRuntimeBuiltinToolSurface {
  const themeController = options.operatorSurface?.theme;
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
    ? buildRuntimeSurface(coreSurface, { requireSessionStores: requiresPlanningStores })
    : DEFAULT_BUILTIN_TOOL_SURFACE;

  const callBuiltinTools = new Map(baseSurface.callBuiltinTools);
  const capabilities = new Map(baseSurface.capabilities);
  const toolAuthority = new Map(baseSurface.toolAuthority);
  const toolCallMetadata = new Map(baseSurface.toolCallMetadata);
  const toolDefinitions = [...baseSurface.toolDefinitions];

  const goalCreateExecutor = callBuiltinTools.get(GOAL_CREATE_TOOL_NAME);
  if (goalCreateExecutor) {
    callBuiltinTools.set(GOAL_CREATE_TOOL_NAME, createSessionAwareGoalCreateExecutor(goalCreateExecutor));
  }

  if (!themeController && options.executionMode !== "plan" && !options.managedInvocation && !goalCreateExecutor) {
    return baseSurface;
  }

  if (themeController) {
    callBuiltinTools.set(OPERATOR_SET_THEME_TOOL.name, async (input) => executeOperatorSetTheme(input, themeController));
    capabilities.set(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);
    const authority = authorityFromCapability(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);
    if (authority) {
      toolAuthority.set(OPERATOR_SET_THEME_TOOL.name, authority);
    }
    toolDefinitions.push(OPERATOR_SET_THEME_TOOL);
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
    capabilities.set(SUBMIT_PLAN_TOOL.name, SUBMIT_PLAN_CAPABILITY);
    const authority = authorityFromCapability(SUBMIT_PLAN_TOOL.name, SUBMIT_PLAN_CAPABILITY);
    if (authority) {
      toolAuthority.set(SUBMIT_PLAN_TOOL.name, authority);
    }
    toolDefinitions.push(SUBMIT_PLAN_TOOL);

    callBuiltinTools.set(
      SUBMIT_SPECIFICATION_TOOL.name,
      async (input) => executeSubmitSpecification(input, specificationStateStore),
    );
    capabilities.set(SUBMIT_SPECIFICATION_TOOL.name, SUBMIT_SPECIFICATION_CAPABILITY);
    const specificationAuthority = authorityFromCapability(SUBMIT_SPECIFICATION_TOOL.name, SUBMIT_SPECIFICATION_CAPABILITY);
    if (specificationAuthority) {
      toolAuthority.set(SUBMIT_SPECIFICATION_TOOL.name, specificationAuthority);
    }
    toolDefinitions.push(SUBMIT_SPECIFICATION_TOOL);

    callBuiltinTools.set(
      RECORD_CLARIFICATION_TOOL.name,
      async (input) => executeRecordClarification(input, specificationStateStore),
    );
    capabilities.set(RECORD_CLARIFICATION_TOOL.name, RECORD_CLARIFICATION_CAPABILITY);
    const clarificationAuthority = authorityFromCapability(RECORD_CLARIFICATION_TOOL.name, RECORD_CLARIFICATION_CAPABILITY);
    if (clarificationAuthority) {
      toolAuthority.set(RECORD_CLARIFICATION_TOOL.name, clarificationAuthority);
    }
    toolDefinitions.push(RECORD_CLARIFICATION_TOOL);
  }

  if (options.managedInvocation) {
    const managedInvocationExecutor = createManagedInvocationToolExecutor(options.managedInvocation);
    callBuiltinTools.set(MANAGED_AGENT_INVOKE_TOOL.name, managedInvocationExecutor);
    const workItemExecutionStart = callBuiltinTools.get(WORK_ITEM_EXECUTION_START_TOOL_NAME);
    if (workItemExecutionStart) {
      callBuiltinTools.set(
        WORK_ITEM_EXECUTION_START_TOOL_NAME,
        createManagedDelegationWorkItemStartExecutor(
          workItemExecutionStart,
          managedInvocationExecutor,
          options.managedInvocation,
        ),
      );
    }
    capabilities.set(MANAGED_AGENT_INVOKE_TOOL.name, MANAGED_AGENT_INVOKE_CAPABILITY);
    toolCallMetadata.set(
      MANAGED_AGENT_INVOKE_TOOL.name,
      createManagedInvocationToolCallMetadataResolver(options.managedInvocation),
    );
    const authority = authorityFromCapability(MANAGED_AGENT_INVOKE_TOOL.name, MANAGED_AGENT_INVOKE_CAPABILITY);
    if (authority) {
      toolAuthority.set(MANAGED_AGENT_INVOKE_TOOL.name, authority);
    }
    toolDefinitions.push(createManagedAgentInvokeToolDefinition(options.managedInvocation));
  }

  return {
    callBuiltinTools,
    toolDefinitions,
    capabilities,
    toolAuthority,
    toolCallMetadata,
    analysisStateStore: baseSurface.analysisStateStore,
    authorityStateStore: baseSurface.authorityStateStore,
    planStateStore: baseSurface.planStateStore,
    specificationStateStore: baseSurface.specificationStateStore,
    listResources: baseSurface.listResources,
    listResourceTemplates: baseSurface.listResourceTemplates,
    readResource: baseSurface.readResource,
  };
}

function createSessionAwareGoalCreateExecutor(goalCreateExecutor: RuntimeBuiltinToolExecutor): RuntimeBuiltinToolExecutor {
  return async (input, context) => {
    const ownerSessionId = readTextFromUnknown(input.ownerSessionId);
    if (ownerSessionId || !context?.session.id) {
      return goalCreateExecutor(input, context);
    }
    return goalCreateExecutor({
      ...input,
      ownerSessionId: context.session.id,
    }, context);
  };
}

function createManagedDelegationWorkItemStartExecutor(
  startExecutor: RuntimeBuiltinToolExecutor,
  managedInvocationExecutor: RuntimeBuiltinToolExecutor,
  managedInvocationOptions: ManagedInvocationToolOptions,
): RuntimeBuiltinToolExecutor {
  return async (input, context) => {
    const initialResult = await startExecutor(input, context);
    const managedPause = parseManagedDelegationPause(initialResult);
    if (!managedPause) {
      return initialResult;
    }

    const preparedRequest = prepareManagedInvocationRequest(managedPause.request, managedInvocationOptions);
    const managedRequest = preparedRequest.request;
    const autoStartDecision = managedInvocationAutoStartDecision(managedRequest);
    if (autoStartDecision.decision === "skipped") {
      return managedDelegationAutoStartSkippedResult(
        initialResult,
        managedRequest,
        autoStartDecision.reason,
        preparedRequest.metadata,
      );
    }
    const managedContext = context
      ? {
        ...context,
        toolCall: {
          ...context.toolCall,
          id: `${context.toolCall.id}:managed-invocation`,
          name: MANAGED_AGENT_INVOKE_TOOL.name,
          input: managedRequest,
        },
      } satisfies RuntimeBuiltinToolExecutionContext
      : undefined;
    const managedResult = await managedInvocationExecutor(managedRequest, managedContext);
    const managedEnvelope = readRuntimeToolResultEnvelope(managedResult);
    if (!managedEnvelope || managedEnvelope.isError) {
      return managedDelegationPausedResult(initialResult, managedEnvelope, "Managed child invocation failed before work item execution could start.");
    }

    const managedInvocationId = readTextFromUnknown(managedEnvelope.metadata?.invocationId);
    if (!managedInvocationId) {
      return managedDelegationPausedResult(initialResult, managedEnvelope, "Managed child invocation completed without an invocation id.");
    }

    const resumedResult = await startExecutor({
      ...input,
      managedInvocationId,
    }, context);
    const resumedEnvelope = readRuntimeToolResultEnvelope(resumedResult);
    if (!resumedEnvelope) {
      return resumedResult;
    }
    return {
      ...resumedEnvelope,
      metadata: {
        ...(resumedEnvelope.metadata ?? {}),
        managedInvocationAutoStarted: true,
        managedInvocationId,
        ...(managedEnvelope.metadata ? { managedInvocation: managedEnvelope.metadata } : {}),
      },
    };
  };
}

function managedInvocationAutoStartDecision(
  managedRequest: Record<string, unknown>,
): { readonly decision: "allowed" } | { readonly decision: "skipped"; readonly reason: string } {
  const executionPhase = readRecord(managedRequest.executionPhase);
  const completionTool = readTextFromUnknown(executionPhase?.completionTool);
  if (executionPhase?.autoStartAllowed === false || completionTool === "work_item.update") {
    return {
      decision: "skipped",
      reason: "intermediate_phase_requires_explicit_parent_invocation",
    };
  }
  return { decision: "allowed" };
}

function managedDelegationAutoStartSkippedResult(
  initialResult: unknown,
  managedRequest: Record<string, unknown>,
  reason: string,
  requestMetadata: Record<string, unknown> | undefined = undefined,
): RuntimeToolResultEnvelope {
  const initialEnvelope = readRuntimeToolResultEnvelope(initialResult);
  const initialOutput = initialEnvelope ? parseJsonRecord(initialEnvelope.output) : undefined;
  const output = initialOutput
    ? {
        ...initialOutput,
        managedInvocationRequest: managedRequest,
      }
    : {
        status: "paused",
        reason: "Managed child invocation requires explicit parent invocation.",
        nextTool: MANAGED_AGENT_INVOKE_TOOL.name,
        managedInvocationRequest: managedRequest,
      };
  return {
    output: JSON.stringify(output, null, 2),
    isError: false,
    metadata: {
      ...(initialEnvelope?.metadata ?? {}),
      toolName: WORK_ITEM_EXECUTION_START_TOOL_NAME,
      operation: "managed_invocation_paused",
      managedInvocationAutoStarted: false,
      managedInvocationAutoStart: {
        decision: "skipped",
        reason,
      },
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
  const requestedProfile = (readTextFromUnknown(request.profile) ?? "foundation-readonly-plan") as ManagedAgentAdmissionProfile;
  const exactRoute = routeId
    ? options.routes.find((route) => route.routeId === routeId)
    : undefined;
  if (exactRoute) {
    const profile = resolveManagedInvocationRouteProfile(exactRoute.profiles, requestedProfile);
    return {
      ...request,
      routeId: exactRoute.routeId,
      profile,
      requestedAuthority: normalizeManagedInvocationRequestedAuthority(request.requestedAuthority, profile),
      providerRoute: {
        ...(providerRoute ?? {}),
        providerId: exactRoute.providerId,
        ...(readTextFromUnknown(providerRoute?.model) || !exactRoute.model
          ? {}
          : { model: exactRoute.model }),
      },
    };
  }
  const profile = requestedProfile;
  const matches = options.routes.filter((route) =>
    (!routeId || route.routeId === routeId)
    && route.profiles[profile] !== undefined
  );
  if (matches.length !== 1) {
    return request;
  }
  const route = matches[0]!;
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
  if (!route || routeSupportsRequiredTools(route, profile, requiredToolNames)) {
    return { request };
  }
  const compatibleRoutes = options.routes.filter((candidate) =>
    candidate.routeId !== routeId
    && routeSupportsRequiredTools(candidate, profile, requiredToolNames)
  );
  if (compatibleRoutes.length !== 1) {
    return { request };
  }
  const replacement = compatibleRoutes[0]!;
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
          !routeSupportsRequiredTools(route, profile, [toolName])
        ),
      },
    },
  };
}

function attachMatchingAgentProfile(
  request: Record<string, unknown>,
  options: ManagedInvocationToolOptions,
): Record<string, unknown> {
  if (readTextFromUnknown(request.agentProfile)) {
    return request;
  }
  const routeId = readTextFromUnknown(request.routeId);
  if (!routeId) {
    return request;
  }
  const matches = (options.agentCatalog ?? []).filter((agent) => agent.routeId === routeId);
  if (matches.length !== 1) {
    return request;
  }
  return {
    ...request,
    agentProfile: matches[0]!.name,
  };
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
): boolean {
  const routeProfile = route.profiles[profile];
  if (!routeProfile) {
    return false;
  }
  const allowedTools = new Set(routeProfile.allowedToolNames);
  return requiredToolNames.every((toolName) => allowedTools.has(toolName));
}

function resolveManagedInvocationRouteProfile(
  profiles: ManagedInvocationToolOptions["routes"][number]["profiles"],
  requestedProfile: ManagedAgentAdmissionProfile,
): ManagedAgentAdmissionProfile {
  if (profiles[requestedProfile] !== undefined) {
    return requestedProfile;
  }
  const availableProfiles = Object.keys(profiles) as ManagedAgentAdmissionProfile[];
  return availableProfiles.length === 1 ? availableProfiles[0]! : requestedProfile;
}

function normalizeManagedInvocationRequestedAuthority(
  requestedAuthority: unknown,
  profile: ManagedAgentAdmissionProfile,
): unknown {
  if (profile === "foundation-readonly-plan") {
    return "read_only";
  }
  return requestedAuthority === "read_only" || requestedAuthority === undefined
    ? "audited"
    : requestedAuthority;
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

function managedDelegationPausedResult(
  initialResult: unknown,
  managedResult: RuntimeToolResultEnvelope | undefined,
  reason: string,
): RuntimeToolResultEnvelope {
  const initialEnvelope = readRuntimeToolResultEnvelope(initialResult);
  const initialOutput = initialEnvelope ? parseJsonRecord(initialEnvelope.output) : undefined;
  const recovery = buildManagedDelegationRecovery(initialOutput);
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
  initialOutput: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const request = readRecord(initialOutput?.managedInvocationRequest);
  return buildManagedInvocationPhaseRecovery(request);
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
  options: { readonly requireSessionStores?: boolean } = {},
): AttachedRuntimeBuiltinToolSurface {
  const analysisStateStore = coreSurface.analysisStateStore;
  const authorityStateStore = coreSurface.authorityStateStore;
  const planStateStore = coreSurface.planStateStore;
  const specificationStateStore = coreSurface.specificationStateStore;
  if (options.requireSessionStores && (!analysisStateStore || !planStateStore || !specificationStateStore)) {
    throw new Error("Runtime builtin tool surface requires analysis, plan, and specification state stores.");
  }
  return {
    callBuiltinTools: buildBuiltinToolExecutors(coreSurface),
    toolDefinitions: coreSurface.toolDefinitions,
    capabilities: coreSurface.capabilities,
    toolAuthority: buildBuiltinToolAuthority(coreSurface.capabilities),
    toolCallMetadata: new Map(),
    analysisStateStore,
    authorityStateStore,
    planStateStore,
    specificationStateStore,
    listResources: () => coreSurface.resources.list().map(projectToolResourceDescriptor),
    listResourceTemplates: () => coreSurface.resources.listTemplates(),
    readResource: (uri: string) => coreSurface.resources.read(uri),
  };
}

export function buildAttachedRuntimePerCallToolConfig(input: {
  readonly tenantId: string;
  readonly activeProvider?: string;
  readonly activeModel?: string;
  readonly activeModelCapabilities?: DiscoveredDirectProviderModelCapabilities;
  readonly reasoningEffort?: PerCallToolConfig["reasoningEffort"];
  readonly builtinToolSurface?: AttachedRuntimeBuiltinToolSurface;
  readonly executionMode?: OperatorExecutionMode;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
}): PerCallToolConfig {
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
  const config: PerCallToolConfig = {
    tenantId: input.tenantId,
    ...(modelOverride ? { modelOverride } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    ...(input.authorityContext ? { authorityContext: input.authorityContext } : {}),
    ...(profile && input.activeModelCapabilities?.supportedReasoningEfforts
      ? {
          modelRoutingPolicy: {
            routeCapabilities: new Map([
              [`${profile.provider}/${profile.model}`, {
                supportedReasoningEfforts: input.activeModelCapabilities.supportedReasoningEfforts,
              }],
            ]),
          },
        }
      : {}),
  };

  if (profile?.executionMode !== "kiln-executable") {
    const failClosedConfig: PerCallToolConfig = {
      ...config,
      toolAllowlist: new Set<string>(),
      toolAuthority: new Map(),
    };
    return recordRuntimeAuthoritySnapshot(input.builtinToolSurface, projectEffectiveTurnAuthorityPerCallConfig({
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

  const builtinToolSurface = input.builtinToolSurface
    ?? (executionMode === "plan"
      ? createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" })
      : DEFAULT_BUILTIN_TOOL_SURFACE);
  if (executionMode === "plan") {
    const planSurface = builtinToolSurface.analysisStateStore
      && builtinToolSurface.planStateStore
      && builtinToolSurface.specificationStateStore
      ? builtinToolSurface
      : createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    return recordRuntimeAuthoritySnapshot(planSurface, projectEffectiveTurnAuthorityPerCallConfig({
      config: buildPlanModePerCallConfig(config, planSurface),
      executionMode,
      sourcePolicy: "plan_mode_projection",
      reason: "Plan mode narrows the runtime surface to planning and read-only tools.",
      sandboxProjection: "read_only",
      requestedAuthority,
    })!);
  }
  const executeConfig: PerCallToolConfig = {
    ...config,
    toolAllowlist: new Set<string>(builtinToolSurface.toolDefinitions.map((tool) => tool.name)),
    toolAuthority: builtinToolSurface.toolAuthority,
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

function recordRuntimeAuthoritySnapshot(
  surface: AttachedRuntimeBuiltinToolSurface | undefined,
  config: PerCallToolConfig,
): PerCallToolConfig {
  if (config.effectiveTurnAuthority) {
    surface?.authorityStateStore?.record({
      source: "runtime",
      authority: config.effectiveTurnAuthority,
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
  config: PerCallToolConfig,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface,
): PerCallToolConfig {
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
    return capability?.annotations?.readOnly === true
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
  for (const toolName of surface.toolNames) {
    executors.set(toolName, async (input, context) => {
      const execution = await surface.bridge.execute({
        name: toolName,
        input,
        ...(context?.sandbox !== undefined ? { sandbox: context.sandbox } : {}),
      });
      const result = execution.result;
      const resourceLinks = projectToolResultResourceLinks(result);
      const resourceLinkContent = (result.content ?? []).filter(isResourceLinkContent);
      return {
        output: resourceLinks.length > 0 ? formatLinkedOutput(resourceLinks) : result.output,
        isError: result.isError,
        metadata: result.metadata,
        ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
        ...(resourceLinkContent.length > 0 ? { content: resourceLinkContent } : {}),
      };
    });
  }
  return executors;
}

function formatLinkedOutput(
  resourceLinks: readonly { readonly uri: string; readonly title?: string }[],
): string {
  return [
    "Full tool output is available as resource links:",
    ...resourceLinks.map((link) => `- ${link.title ?? "tool output"}: ${link.uri}`),
  ].join("\n");
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
    const descriptor = authorityFromCapability(toolName, capability);
    if (descriptor) {
      toolAuthority.set(toolName, descriptor);
    }
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
  const rawScope = typeof input.scope === "string" ? input.scope.trim() : "session";
  const scope: OperatorThemeScope = rawScope === "persisted" ? "persisted" : "session";
  const reason = typeof input.reason === "string" && input.reason.trim().length > 0
    ? input.reason.trim()
    : undefined;
  const result = await controller.setTheme({ theme, scope, ...(reason ? { reason } : {}) });
  if (!result.ok) {
    return {
      output: result.error ?? `Theme '${theme}' was not applied.`,
      isError: true,
      metadata: { theme, scope, applied: false, error: result.error },
    };
  }
  return {
    output: `Applied operator theme '${result.appliedTheme ?? theme}' (${scope}).`,
    isError: false,
    metadata: { theme, scope, appliedTheme: result.appliedTheme ?? theme },
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
