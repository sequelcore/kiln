import {
  buildManagedAgentBackgroundJobOrchestrationRequest,
  buildManagedAgentDecompositionOrchestrationRequest,
  buildManagedAgentReviewSwarmOrchestrationRequest,
  decideManagedAgentCoordination,
  MANAGED_AGENT_ADMISSION_PROFILES,
  WORK_CLASSIFICATION_ARTIFACTS,
  WORK_CLASSIFICATION_DOMAINS,
  WORK_CLASSIFICATION_EFFECTS,
  WORK_CLASSIFICATION_INTENTS,
  WORK_CLASSIFICATION_MODES,
  defineManagedAgentInvocationRequest,
  defineWorkClassification,
  projectStructuredExecutionResult,
} from "@kilnai/core";
import { runManagedAgentOrchestrationLifecycle } from "./orchestration-lifecycle.js";
import { resolveManagedInvocationAgentProfile } from "./agent-profile-catalog.js";
import type {
  ActionEffectEnvelope,
  ArtifactResourceStore,
  Capability,
  ManagedAgentAdmissionDecision,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityApproval,
  ManagedAgentAuthorityProfile,
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentCredentialRoute,
  ManagedAgentMemoryScope,
  ManagedAgentInvocationContextMode,
  ManagedAgentInvocationContextSelection,
  ManagedAgentInvocationHandoffContract,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentResultField,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
  ManagedAgentRouteSource,
  ManagedAgentWorkingDirectory,
  ModelTaskSuitability,
  ModelTaskSuitabilityTask,
  WorkClassification,
  WorkClassificationInput,
  WorkRecommendedSkillDiagnostic,
  CanonicalSessionEvent,
  ToolDefinition,
} from "@kilnai/core";
import { evaluateManagedInvocationCallerCapability } from "./caller-capability-policy.js";
import type { PresentationIntent } from "@kilnai/gateway-contracts";
import { posix, resolve, win32 } from "node:path";
import type {
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
} from "../../session/runtime-session-orchestrator.types.js";
import type { RuntimeBudgetAdmissionPort } from "../../session/runtime-budget-admission.js";
import { RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON } from "../../session/runtime-session-orchestrator.types.js";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "./index.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationResult,
  ManagedAgentRuntimeInvocationSnapshot,
  ManagedAgentRuntimeInvocationTerminalNotification,
} from "./index.js";
import {
  appendManagedInvocationRuntimeFailureSessionEvent,
  appendManagedInvocationStartSessionEvents,
  appendManagedInvocationTerminalSessionEvent,
} from "./session-events.js";
import {
  buildManagedInvocationPhaseCompletion,
  buildManagedInvocationPhaseHandoffRecovery,
  buildManagedInvocationPhaseRecovery,
  managedInvocationFailureReasonFromStatus,
} from "./phase-recovery.js";
import {
  projectManagedInvocationAuthorityResources,
  projectManagedInvocationCapabilitySnapshotResources,
  projectManagedInvocationPublicResourceUri,
  projectManagedInvocationRecordResources,
  projectManagedInvocationResourceLeaseResources,
} from "./resource-projection.js";
import {
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_TOOL_NAME,
} from "./tool-names.js";
export {
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_TOOL_NAME,
} from "./tool-names.js";
const MANAGED_AGENT_ORCHESTRATION_PROFILES = MANAGED_AGENT_ADMISSION_PROFILES.filter(
  (profile): profile is Exclude<ManagedAgentAdmissionProfile, "rejected"> => profile !== "rejected",
);

export interface ManagedInvocationRouteProfile {
  readonly authorityProfileId: string;
  readonly permissionProfile: string;
  readonly allowedToolNames: readonly string[];
  readonly writeAllowed?: boolean;
  readonly networkAllowed?: boolean;
  readonly workingDirectory: ManagedAgentWorkingDirectory;
  readonly workingDirectoryLease?: ManagedInvocationWorkingDirectoryLease;
  readonly timeoutMs: number;
  readonly timeoutSource?: ManagedAgentAuthorityProfile["timeoutSource"];
  readonly credentialRoute: ManagedAgentCredentialRoute;
  readonly memoryScope: ManagedAgentMemoryScope;
  readonly readAuthority?: ManagedAgentAuthorityProfile["readAuthority"];
  readonly writeAuthority?: ManagedAgentAuthorityProfile["writeAuthority"];
}

export interface ManagedInvocationToolRoute {
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly providerId: string;
  readonly model?: string;
  readonly voiceProfile?: string;
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly surface?: string;
  readonly providerModelProof?: ManagedAgentCapabilitySnapshotInput["providerModelProof"];
  readonly taskSuitability?: readonly ModelTaskSuitability[];
  readonly profiles: Partial<Record<ManagedAgentAdmissionProfile, ManagedInvocationRouteProfile>>;
}

export interface ManagedInvocationUnavailableRoute {
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly providerId: string;
  readonly model?: string;
  readonly profiles: readonly ManagedAgentAdmissionProfile[];
  readonly reason: string;
}

export interface ManagedInvocationToolOptions {
  readonly routes: readonly ManagedInvocationToolRoute[];
  readonly unavailableRoutes?: readonly ManagedInvocationUnavailableRoute[];
  readonly agentCatalog?: readonly ManagedInvocationAgentCatalogEntry[];
  readonly skillCatalog?: readonly ManagedInvocationSkillCatalogEntry[];
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly artifactStore?: ArtifactResourceStore;
  readonly invocationService?: RuntimeManagedAgentInvocationService;
  readonly invocationServiceKey?: string;
  readonly sessionEventSink?: ManagedInvocationSessionEventSink;
  readonly contextResolver?: ManagedInvocationContextResolver;
  readonly maxParallelChildren?: number;
  readonly orchestrationBudgetAdmission?: RuntimeBudgetAdmissionPort;
}

export type ManagedInvocationToolOptionsWithService = ManagedInvocationToolOptions & {
  readonly invocationService: RuntimeManagedAgentInvocationService;
};

export interface ManagedInvocationToolAttachment {
  readonly options: ManagedInvocationToolOptions;
  readonly callerIdentity: ManagedAgentCallerAttachmentIdentity;
  readonly governedScopeAdmission?: ManagedInvocationGovernedScopeAdmission;
}

export interface ManagedInvocationGovernedScopeAdmissionInput {
  readonly parentSessionId: string;
  readonly goalRunId: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly workItemId?: string;
  readonly attemptId?: string;
}

export type ManagedInvocationGovernedScopeAdmissionResult =
  | { readonly admitted: true }
  | {
      readonly admitted: false;
      readonly code: string;
      readonly message: string;
      readonly suggestedNextTool?: string;
    };

export type ManagedInvocationGovernedScopeAdmission = (
  input: ManagedInvocationGovernedScopeAdmissionInput,
) => ManagedInvocationGovernedScopeAdmissionResult;

export interface ManagedInvocationAgentCatalogEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly nicknameCandidates?: readonly string[];
  readonly role: string;
  readonly goal: string;
  readonly tier: string;
  readonly authorityProfile?: ManagedAgentAdmissionProfile;
  readonly skills?: readonly string[];
  readonly taskAffinity?: readonly ModelTaskSuitabilityTask[];
  readonly routeId?: string;
  readonly providerRoute?: {
    readonly providerId: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
  };
  readonly voiceProfile?: string;
}

export interface ManagedInvocationWorkingDirectoryLease {
  readonly mode: "git-worktree";
  readonly sourcePath: string;
  readonly rootPath: string;
}

export interface ManagedInvocationSkillCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly origin?: string;
  readonly configured?: boolean;
  readonly builtIn?: boolean;
  readonly sourcePath?: string;
  readonly admission?: {
    readonly state: string;
    readonly reason: string;
  };
  readonly projections?: readonly {
    readonly target: string;
    readonly status: string;
    readonly path: string;
  }[];
  readonly omissionReason?: string;
  readonly tags?: readonly string[];
}

export interface ManagedInvocationSessionEventSink {
  publish(
    events: readonly CanonicalSessionEvent[],
    context: RuntimeBuiltinToolExecutionContext,
  ): void | Promise<void>;
}

export interface ManagedInvocationContextResolverInput {
  readonly agentProfile?: string;
  readonly skills: readonly string[];
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly task: string;
  readonly providerRoute?: {
    readonly providerId: string;
    readonly model?: string;
  };
  readonly taskSuitability?: readonly ModelTaskSuitability[];
  readonly workClassification?: WorkClassification;
}

export interface ManagedInvocationContextResolution {
  readonly promptPrefix?: string;
  readonly admittedAgentProfile?: string;
  readonly admittedSkills?: readonly string[];
  readonly admittedInstructionProfiles?: readonly string[];
  readonly deniedSkills?: readonly string[];
  readonly workClassification?: WorkClassification;
  readonly workRecommendedSkills?: readonly string[];
  readonly workRecommendedSkillDiagnostics?: readonly WorkRecommendedSkillDiagnostic[];
}

export type ManagedInvocationContextResolver = (
  input: ManagedInvocationContextResolverInput,
) => ManagedInvocationContextResolution | Promise<ManagedInvocationContextResolution>;

interface ManagedInvocationToolInput {
  readonly profile: ManagedAgentAdmissionProfile;
  readonly routeId?: string;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly task: string;
  readonly summary: string;
  readonly resourceUris?: readonly string[];
  readonly agentProfile?: string;
  readonly forbiddenInputFields?: readonly string[];
  readonly skills?: readonly string[];
  readonly workClassification?: WorkClassification;
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly goalRunId?: string;
  readonly workItemId?: string;
  readonly attemptId?: string;
  readonly roleIntent?: string;
  readonly expectedEvidence?: readonly string[];
  readonly requiredToolNames?: readonly string[];
  readonly requiredReadPaths?: readonly string[];
  readonly requiredResultFields?: readonly ManagedAgentResultField[];
  readonly doneCriteria?: readonly string[];
  readonly residualRiskRequired?: boolean;
  readonly outputVerbosity?: "concise" | "standard" | "detailed";
  readonly executionPhase?: Record<string, unknown>;
}

interface ManagedInvocationToolResult {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata: Record<string, unknown>;
}

export const MANAGED_AGENT_INVOKE_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_INVOKE_TOOL_NAME,
  description: "Request a governed managed child agent invocation through a configured Kiln runtime route. The runtime owns admission, authority, credentials, lifecycle evidence, and session events.",
  inputSchema: {
    type: "object",
    properties: {
      profile: {
        type: "string",
        enum: ["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes", "foundation-memory-write-proposals"],
        default: "foundation-readonly-plan",
        description: "Configured managed invocation authority profile to request.",
      },
      routeId: {
        type: "string",
        description: "Optional configured managed invocation route id.",
      },
      providerRoute: {
        type: "object",
        properties: {
          providerId: {
            type: "string",
            description: "Configured managed provider id.",
          },
          model: {
            type: "string",
            description: "Optional configured model selector. When supplied, it must match the selected managed route.",
          },
          reasoningEffort: {
            type: "string",
            description: "Optional provider reasoning effort.",
          },
        },
        required: ["providerId"],
        additionalProperties: false,
      },
      requestedAuthority: {
        type: "string",
        enum: ["auto", "read_only", "audited", "destructive"],
        default: "auto",
        description: "Requested child authority. Use read_only for inspection-only children. Destructive authority is rejected until an explicit approval flow is available.",
      },
      task: {
        type: "string",
        description: "Bounded child task prompt.",
      },
      summary: {
        type: "string",
        description: "Optional short invocation summary. Defaults to task.",
      },
      resourceUris: {
        type: "array",
        items: { type: "string" },
        description: "Optional governed resource URIs to make available to the child. Required when contextMode is resources.",
      },
      agentProfile: {
        type: "string",
        description: "Optional configured Kiln agent profile to request for the child. The runtime must resolve and admit it before execution.",
      },
      forbiddenInputFields: {
        type: "array",
        items: { type: "string" },
        description: "Optional route-owned input contract from work_item.execution.start. Pass through unchanged; do not populate any listed fields.",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        description: "Optional configured Kiln skills to request for the child. Only request skills from the configured agent profile or an explicitly known Kiln skill catalog; do not invent skill names.",
      },
      workClassification: {
        type: "object",
        properties: {
          intents: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_INTENTS] },
            description: "Optional governed work intents, such as write, edit, review, support, code, or design.",
          },
          artifacts: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_ARTIFACTS] },
            description: "Optional artifact families the child will produce or review.",
          },
          domains: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_DOMAINS] },
            description: "Optional domain context for the child work.",
          },
          effects: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_EFFECTS] },
            description: "Optional authority/effect class for the child work.",
          },
          modes: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_MODES] },
            description: "Optional interaction mode, such as answer, coauthor, transform, critique, delegate, automate, or monitor.",
          },
        },
        additionalProperties: false,
        description: "Optional explicit cross-domain work classification. It informs governed skill recommendation and diagnostics; it does not grant tool authority.",
      },
      contextMode: {
        type: "string",
        enum: ["isolated", "resources", "fork"],
        default: "isolated",
        description: "Child context mode. Use isolated by default. Use resources only when resourceUris is non-empty. fork requires explicit runtime support and policy admission.",
      },
      workItemId: {
        type: "string",
        description: "Optional governed work item id this child is executing or reviewing.",
      },
      goalRunId: {
        type: "string",
        description: "Optional governed goal run id this child is executing under.",
      },
      attemptId: {
        type: "string",
        description: "Optional governed work item execution attempt id for final-phase failure closeout.",
      },
      roleIntent: {
        type: "string",
        description: "Optional short statement of why this child role/route was selected for the work item.",
      },
      expectedEvidence: {
        type: "array",
        items: { type: "string" },
        description: "Optional evidence the child is expected to produce or explicitly mark as unavailable.",
      },
      requiredToolNames: {
        type: "array",
        items: { type: "string" },
        description: "Optional exact tool names the selected route must allow before execution starts. The runtime fails closed when the route lacks any required tool.",
      },
      requiredReadPaths: {
        type: "array",
        items: { type: "string" },
        description: "Optional local paths the selected read-only route must be able to inspect before execution starts. The runtime fails closed when the route read authority does not cover every path.",
      },
      requiredResultFields: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "summary",
            "resourceUris",
            "evidence",
            "verificationResults",
            "uncertainty",
            "limitations",
            "warnings",
            "approvalRequirements",
            "residualRisks",
          ],
        },
        description: "Optional canonical child result fields required in a completed handoff.",
      },
      doneCriteria: {
        type: "array",
        items: { type: "string" },
        description: "Optional concrete done criteria for this child invocation.",
      },
      residualRiskRequired: {
        type: "boolean",
        description: "True when the child handoff must include explicit residual risk.",
      },
      outputVerbosity: {
        type: "string",
        enum: ["concise", "standard", "detailed"],
        description: "Visible handoff detail level, independent from provider reasoning effort. Control evidence is always preserved.",
      },
      executionPhase: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Optional governed execution phase id, such as visual-reference-research.",
          },
          expectedEvidence: {
            type: "array",
            items: { type: "string" },
            description: "Evidence this child phase must produce before the parent can advance.",
          },
          verificationRequirementIds: {
            type: "array",
            items: { type: "string" },
            description: "Exact requirement ids that must each have one structured verification result. Final phases include unaccounted closeout gates.",
          },
          requiredToolNames: {
            type: "array",
            items: { type: "string" },
            description: "Tool names required for this child phase.",
          },
          taskAffinity: {
            type: "array",
            items: { type: "string" },
            description: "Configured task-suitability dimensions used only after capability filtering to select a unique route.",
          },
          remainingEvidenceAfterPhase: {
            type: "array",
            items: { type: "string" },
            description: "Evidence still expected after this phase completes.",
          },
          completionTool: {
            type: "string",
            enum: ["work_item.update", "work_item.execution.finish"],
            description: "Governance tool that must record this phase result.",
          },
          finalPhase: {
            type: "boolean",
            description: "True when this child phase is the final execution phase.",
          },
          autoStartAllowed: {
            type: "boolean",
            description: "False when the parent must explicitly invoke the child before continuing.",
          },
          instruction: {
            type: "string",
            description: "Phase-specific instruction for recording evidence and follow-up.",
          },
        },
        additionalProperties: false,
        description: "Optional governed execution phase contract returned by work_item.execution.start. Pass it through unchanged when invoking the managed child.",
      },
    },
    required: ["profile", "providerRoute", "task"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-approval"]),
};

export const MANAGED_AGENT_START_TOOL: ToolDefinition = {
  ...MANAGED_AGENT_INVOKE_TOOL,
  name: MANAGED_AGENT_START_TOOL_NAME,
  description: "Start a governed managed child agent invocation in the background through a configured Kiln runtime route. Returns after admission with an invocation id; use managed_agent.status, managed_agent.list, and managed_agent.join to observe or wait.",
};

export const MANAGED_AGENT_STATUS_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_STATUS_TOOL_NAME,
  description: "Read the current lifecycle status for a managed child invocation in the current runtime session.",
  inputSchema: {
    type: "object",
    properties: {
      invocationId: {
        type: "string",
        description: "Managed child invocation id returned by managed_agent.start.",
      },
    },
    required: ["invocationId"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-status"]),
};

export const MANAGED_AGENT_LIST_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_LIST_TOOL_NAME,
  description: "List managed child invocations owned by the current runtime session.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-status"]),
};

export const MANAGED_AGENT_JOIN_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_JOIN_TOOL_NAME,
  description: "Wait for a managed child invocation in the current runtime session and publish its terminal lifecycle evidence exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      invocationId: {
        type: "string",
        description: "Managed child invocation id returned by managed_agent.start.",
      },
    },
    required: ["invocationId"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-status"]),
};

export const MANAGED_AGENT_CANCEL_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_CANCEL_TOOL_NAME,
  description: "Cancel a running managed child invocation in the current runtime session, signal the child adapter, and publish terminal cancellation evidence exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      invocationId: {
        type: "string",
        description: "Managed child invocation id returned by managed_agent.start.",
      },
      reason: {
        type: "string",
        description: "Operator-facing reason for cancellation.",
      },
    },
    required: ["invocationId"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-control"]),
};

export const MANAGED_AGENT_ORCHESTRATE_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  description: "Select and execute a governed managed-agent coordination topology from an explicit work graph. Runtime capacity bounds concurrency; the caller does not choose a provider ranking or worker count.",
  inputSchema: {
    type: "object",
    properties: {
      profile: { type: "string", enum: MANAGED_AGENT_ORCHESTRATION_PROFILES },
      taskRisk: { type: "string", enum: ["low", "medium", "high", "unknown"] },
      requiresIndependentReview: { type: "boolean" },
      workItems: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            roleIntent: { type: "string", minLength: 1 },
            task: { type: "string", minLength: 1 },
            agentProfile: { type: "string", minLength: 1 },
            routeId: { type: "string", minLength: 1 },
            dependencies: { type: "array", items: { type: "string", minLength: 1 } },
          },
          required: ["id", "roleIntent", "task"],
          additionalProperties: false,
        },
      },
    },
    required: ["profile", "taskRisk", "requiresIndependentReview", "workItems"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "orchestration", "operator-approval"]),
};

const MANAGED_AGENT_DESTRUCTIVE_ENVELOPE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace", "network"],
  reversibility: "irreversible",
  dataEgress: "unknown",
  identityUse: "authenticated",
  consequences: ["local-state", "external-state"],
  idempotency: "non-idempotent",
};

const MANAGED_AGENT_OBSERVE_ENVELOPE: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const MANAGED_AGENT_CONTROL_ENVELOPE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "conditionally-idempotent",
};

export const MANAGED_AGENT_INVOKE_CAPABILITY: Capability = {
  name: MANAGED_AGENT_INVOKE_TOOL.name,
  description: MANAGED_AGENT_INVOKE_TOOL.description,
  schema: MANAGED_AGENT_INVOKE_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-approval"],
  effectEnvelope: MANAGED_AGENT_DESTRUCTIVE_ENVELOPE,
};

export const MANAGED_AGENT_START_CAPABILITY: Capability = {
  name: MANAGED_AGENT_START_TOOL.name,
  description: MANAGED_AGENT_START_TOOL.description,
  schema: MANAGED_AGENT_START_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-approval"],
  effectEnvelope: MANAGED_AGENT_DESTRUCTIVE_ENVELOPE,
};

export const MANAGED_AGENT_STATUS_CAPABILITY: Capability = {
  name: MANAGED_AGENT_STATUS_TOOL.name,
  description: MANAGED_AGENT_STATUS_TOOL.description,
  schema: MANAGED_AGENT_STATUS_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-status"],
  effectEnvelope: MANAGED_AGENT_OBSERVE_ENVELOPE,
};

export const MANAGED_AGENT_LIST_CAPABILITY: Capability = {
  name: MANAGED_AGENT_LIST_TOOL.name,
  description: MANAGED_AGENT_LIST_TOOL.description,
  schema: MANAGED_AGENT_LIST_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-status"],
  effectEnvelope: MANAGED_AGENT_OBSERVE_ENVELOPE,
};

export const MANAGED_AGENT_JOIN_CAPABILITY: Capability = {
  name: MANAGED_AGENT_JOIN_TOOL.name,
  description: MANAGED_AGENT_JOIN_TOOL.description,
  schema: MANAGED_AGENT_JOIN_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-status"],
  effectEnvelope: MANAGED_AGENT_OBSERVE_ENVELOPE,
};

export const MANAGED_AGENT_CANCEL_CAPABILITY: Capability = {
  name: MANAGED_AGENT_CANCEL_TOOL.name,
  description: MANAGED_AGENT_CANCEL_TOOL.description,
  schema: MANAGED_AGENT_CANCEL_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-control"],
  effectEnvelope: MANAGED_AGENT_CONTROL_ENVELOPE,
};

export const MANAGED_AGENT_ORCHESTRATE_CAPABILITY: Capability = {
  name: MANAGED_AGENT_ORCHESTRATE_TOOL.name,
  description: MANAGED_AGENT_ORCHESTRATE_TOOL.description,
  schema: MANAGED_AGENT_ORCHESTRATE_TOOL.inputSchema,
  tags: ["managed-invocation", "orchestration", "operator-approval"],
  effectEnvelope: MANAGED_AGENT_DESTRUCTIVE_ENVELOPE,
};

export function createManagedAgentInvokeToolDefinition(
  options: ManagedInvocationToolOptions,
): ToolDefinition {
  const routeIds = unique([
    ...options.routes.map((route) => route.routeId),
    ...(options.unavailableRoutes ?? []).map((route) => route.routeId),
  ]);
  const providerIds = unique([
    ...options.routes.map((route) => route.providerId),
    ...(options.unavailableRoutes ?? []).map((route) => route.providerId),
  ]);
  const schema = cloneToolSchema(MANAGED_AGENT_INVOKE_TOOL.inputSchema);
  const properties = readSchemaProperties(schema);
  const routeId = readSchemaProperty(properties.routeId);
  if (routeId && routeIds.length > 0) {
    routeId.enum = routeIds;
    routeId.description = "Configured managed invocation route id. Prefer this when selecting a child route.";
  }
  const providerRoute = readSchemaProperty(properties.providerRoute);
  const providerRouteProperties = readSchemaProperties(providerRoute);
  const providerId = readSchemaProperty(providerRouteProperties.providerId);
  if (providerId && providerIds.length > 0) {
    providerId.enum = providerIds;
    providerId.description = "Configured managed provider id. It must correspond to the selected route.";
  }
  const agentProfile = readSchemaProperty(properties.agentProfile);
  const agentProfileNames = managedInvocationAgentProfileNames(options);
  if (agentProfile && agentProfileNames.length > 0) {
    agentProfile.enum = agentProfileNames;
    agentProfile.description = "Optional configured Kiln agent profile to request for the child. Use only one of these admitted names or aliases; omit for a generic governed child.";
  }
  const skills = readSchemaProperty(properties.skills);
  const skillNames = managedInvocationSkillNames(options);
  if (skills) {
    const items = readSchemaProperty(skills.items);
    if (skillNames.length > 0 && items) {
      items.enum = skillNames;
      skills.description = "Optional configured Kiln skills to request for the child. Use only these admitted skill names.";
    } else {
      skills.maxItems = 0;
      skills.description = "No Kiln skills are configured for managed child invocation. Omit skills.";
    }
  }
  return {
    ...MANAGED_AGENT_INVOKE_TOOL,
    description: [
      MANAGED_AGENT_INVOKE_TOOL.description,
      "",
      buildManagedRouteCatalogDescription(options),
      "",
      buildManagedAgentSelectionDescription(options),
      "",
      "For comparison tasks, invoke one managed child per selected route, then compare only successful handoffs. Report unavailable, failed, cancelled, or timed-out child invocations separately as missing evidence; do not treat them as opinions.",
      "For delegated work, choose an admitted agentProfile from the configured agent catalog when a profile clearly matches the child task. If no profile matches, omit agentProfile and invoke a generic governed child with the narrowest read-only route. Do not invent agentProfile names.",
      "When a selected agentProfile lists routeId or providerRoute hints, follow those hints. A route, provider, or model that contradicts the selected agentProfile hint fails closed.",
      "Only request skills that are listed on a configured agent profile or otherwise known from the Kiln skill catalog. Do not invent skill names; unknown skills fail closed.",
      "When the child is executing a governed work item, pass workItemId, expectedEvidence, requiredResultFields, doneCriteria, roleIntent, and residualRiskRequired so the handoff is auditable across surfaces.",
      "Use contextMode=isolated unless you are also passing governed resourceUris. Do not use contextMode=resources without resourceUris.",
      "Do not put resource_read in requiredToolNames just because contextMode=resources is used; the parent runtime hydrates admitted resourceUris before the child starts, and resource_read is only a child tool when the selected authority profile explicitly allows it.",
      "Use routeId when the user asks for a specific route or when more than one route shares a provider and no selected agentProfile route hint applies. Omit providerRoute.model unless the user explicitly selected an exact configured model.",
      "For broad repository review, long reasoning, or multi-file analysis, choose a route with a sufficient timeout budget or split the work into smaller children.",
    ].join("\n"),
    inputSchema: schema,
  };
}

export function createManagedAgentStartToolDefinition(
  options: ManagedInvocationToolOptions,
): ToolDefinition {
  const invokeDefinition = createManagedAgentInvokeToolDefinition(options);
  return {
    ...invokeDefinition,
    name: MANAGED_AGENT_START_TOOL_NAME,
    description: [
      MANAGED_AGENT_START_TOOL.description,
      "",
      invokeDefinition.description,
    ].join("\n"),
  };
}

export function createManagedInvocationToolExecutor(
  attachment: ManagedInvocationToolAttachment,
  service = resolveManagedInvocationService(attachment.options),
  scopeAdmission: "required" | "already-admitted" = "required",
): RuntimeBuiltinToolExecutor {
  return async (input, context) => executeManagedInvocationTool(input, context, attachment, service, scopeAdmission);
}

export function createManagedAgentOrchestrateToolDefinition(
  options: ManagedInvocationToolOptions,
): ToolDefinition {
  const schema = cloneToolSchema(MANAGED_AGENT_ORCHESTRATE_TOOL.inputSchema);
  const properties = readSchemaProperties(schema);
  const workItems = readSchemaProperty(properties.workItems);
  const itemProperties = readSchemaProperties(readSchemaProperty(workItems?.items));
  const agentProfile = readSchemaProperty(itemProperties.agentProfile);
  const agentProfileNames = managedInvocationAgentProfileNames(options);
  if (agentProfile && agentProfileNames.length > 0) {
    agentProfile.enum = agentProfileNames;
    agentProfile.description = "Configured Kiln agent profile for this team member. Its governed route hint is authoritative.";
  }
  const routeId = readSchemaProperty(itemProperties.routeId);
  const routeIds = unique([
    ...options.routes.map((route) => route.routeId),
    ...(options.unavailableRoutes ?? []).map((route) => route.routeId),
  ]);
  if (routeId && routeIds.length > 0) {
    routeId.enum = routeIds;
    routeId.description = "Explicit governed route for this team member. It must agree with the selected agent profile.";
  }
  return {
    ...MANAGED_AGENT_ORCHESTRATE_TOOL,
    description: [
      MANAGED_AGENT_ORCHESTRATE_TOOL.description,
      "Assign each work item an admitted agentProfile whenever a configured specialist matches. Runtime resolves and validates that profile's route independently for each team member.",
      "Use dependencies to pass completed bounded handoffs and resource URIs to downstream team members. A failed dependency blocks its dependents.",
      "Independent review requires distinct provider/model identities; duplicate aliases of one model do not count as independent evidence.",
      buildManagedAgentSelectionDescription(options),
    ].join("\n\n"),
    inputSchema: schema,
  };
}

export function createManagedInvocationLifecycleToolExecutors(
  attachment: ManagedInvocationToolAttachment,
  service = resolveManagedInvocationService(attachment.options),
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> {
  const options = attachment.options;
  return new Map([
    [MANAGED_AGENT_INVOKE_TOOL_NAME, createManagedInvocationToolExecutor(attachment, service)],
    [MANAGED_AGENT_START_TOOL_NAME, async (input, context) => executeManagedInvocationStartTool(input, context, attachment, service)],
    [MANAGED_AGENT_STATUS_TOOL_NAME, async (input, context) => executeManagedInvocationStatusTool(input, context, service)],
    [MANAGED_AGENT_LIST_TOOL_NAME, async (_input, context) => executeManagedInvocationListTool(context, service)],
    [MANAGED_AGENT_JOIN_TOOL_NAME, async (input, context) => executeManagedInvocationJoinTool(input, context, options, service)],
    [MANAGED_AGENT_CANCEL_TOOL_NAME, async (input, context) => executeManagedInvocationCancelTool(input, context, options, service)],
    [MANAGED_AGENT_ORCHESTRATE_TOOL_NAME, async (input, context) => executeManagedAgentOrchestrationTool(input, context, {
      ...options,
      invocationService: service,
    })],
  ]);
}

export function createManagedInvocationToolAttachment(
  options: ManagedInvocationToolOptions,
  callerIdentity: ManagedAgentCallerAttachmentIdentity,
): ManagedInvocationToolAttachment {
  return { options, callerIdentity };
}

export function withManagedInvocationService(
  options: ManagedInvocationToolOptions,
): ManagedInvocationToolOptionsWithService {
  const invocationService = resolveManagedInvocationService(options);
  return options.invocationService === invocationService
    ? options as ManagedInvocationToolOptionsWithService
    : { ...options, invocationService };
}

export function resolveManagedInvocationService(
  options: ManagedInvocationToolOptions,
): RuntimeManagedAgentInvocationService {
  return options.invocationService ?? createManagedInvocationService(options);
}

function createManagedInvocationService(
  options: ManagedInvocationToolOptions,
): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: managedInvocationCredentialRouteIds(options.routes),
    }),
  });
}

async function publishManagedInvocationSessionEvents(
  options: ManagedInvocationToolOptions,
  context: RuntimeBuiltinToolExecutionContext,
  events: readonly CanonicalSessionEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await options.sessionEventSink?.publish(events, context);
}

async function appendAndPublishManagedInvocationStartSessionEvents(input: {
  readonly options: ManagedInvocationToolOptions;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: ManagedAgentAdmissionDecision;
}): Promise<readonly CanonicalSessionEvent[]> {
  const events = appendManagedInvocationStartSessionEvents({
    session: input.context.session,
    request: input.request,
    decision: input.decision,
  });
  await publishManagedInvocationSessionEvents(input.options, input.context, events);
  return events;
}

async function appendAndPublishManagedInvocationTerminalSessionEvent(input: {
  readonly options: ManagedInvocationToolOptions;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly request: ManagedAgentInvocationRequest;
  readonly record: ManagedAgentInvocationRecord;
  readonly durationMs?: number;
}): Promise<readonly CanonicalSessionEvent[]> {
  const record = projectManagedInvocationRecordResources(input.record, { artifactStore: input.options.artifactStore });
  const events = appendManagedInvocationTerminalSessionEvent({
    session: input.context.session,
    request: input.request,
    record,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  });
  await publishManagedInvocationSessionEvents(input.options, input.context, events);
  return events;
}

function managedInvocationTerminalSessionEventIds(
  context: RuntimeBuiltinToolExecutionContext,
  invocationId: string,
): readonly string[] {
  return context.session.sessionEvents
    .filter((event) => isManagedInvocationTerminalSessionEvent(event, invocationId))
    .map((event) => event.eventId);
}

function terminalSessionEventIdsForResult(input: {
  readonly events: readonly CanonicalSessionEvent[];
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly invocationId: string;
}): readonly string[] {
  return input.events.length > 0
    ? input.events.map((event) => event.eventId)
    : managedInvocationTerminalSessionEventIds(input.context, input.invocationId);
}

function isManagedInvocationTerminalSessionEvent(event: CanonicalSessionEvent, invocationId: string): boolean {
  return (event.kind === "agent_invocation_completed" ||
    event.kind === "agent_invocation_failed" ||
    event.kind === "agent_invocation_cancelled") &&
    "invocationId" in event &&
    event.invocationId === invocationId;
}

function managedInvocationCredentialRouteIds(
  routes: readonly ManagedInvocationToolRoute[],
): readonly string[] {
  return unique(routes.flatMap((route) =>
    Object.values(route.profiles).flatMap((profile) => {
      if (profile?.credentialRoute?.mode !== "runtime-selected") {
        return [];
      }
      return [normalizeManagedInvocationCredentialRouteId(profile.credentialRoute.routeId)];
    })
  ));
}

function normalizeManagedInvocationCredentialRoute(
  route: ManagedAgentCredentialRoute,
): ManagedAgentCredentialRoute {
  if (route.mode !== "runtime-selected") {
    return route;
  }
  return {
    ...route,
    routeId: normalizeManagedInvocationCredentialRouteId(route.routeId),
  };
}

function normalizeManagedInvocationCredentialRouteId(routeId: string): string {
  return routeId.trim();
}

export function createManagedInvocationToolCallMetadataResolver(
  options: ManagedInvocationToolOptions,
): (input: Record<string, unknown>) => Record<string, unknown> | undefined {
  return (rawInput) => {
    const canonicalizedRawInput = canonicalizeManagedInvocationRawInput(rawInput, options.routes);
    const parsed = parseInput(canonicalizedRawInput.input);
    if (!parsed.ok) {
      return undefined;
    }
    const agentProfile = resolveManagedInvocationAgentProfile(options, parsed.input.agentProfile);
    const agentRouteValidation = validateAgentRouteHint(parsed.input, agentProfile);
    if (!agentRouteValidation.ok) {
      return undefined;
    }
    const routeResolution = resolveRoute(options.routes, parsed.input, agentProfile);
    if (routeResolution.status !== "found") {
      return undefined;
    }
    const route = routeResolution.route;
    const profileDefaults = route.profiles[parsed.input.profile];
    if (!profileDefaults) {
      return undefined;
    }
    const handoffContract = buildHandoffContract(parsed.input);
    return {
      kind: "managed-invocation",
      profile: parsed.input.profile,
      routeId: route.routeId,
      providerRoute: {
        providerId: route.providerId,
        surface: route.surface ?? route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
        ...(parsed.input.providerRoute.model ?? route.model ? { model: parsed.input.providerRoute.model ?? route.model } : {}),
        ...(parsed.input.providerRoute.reasoningEffort ? { reasoningEffort: parsed.input.providerRoute.reasoningEffort } : {}),
      },
      adapterKind: route.adapter.descriptor.adapterKind,
      executionMode: route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
      requestedAuthority: resolveManagedInvocationRequestedAuthority(parsed.input.requestedAuthority),
      authorityProfileId: profileDefaults.authorityProfileId,
      task: parsed.input.task,
      summary: parsed.input.summary,
      ...(handoffContract ? { handoffContract } : {}),
    };
  };
}

export function attachManagedInvocationSessionEventSink(
  attachment: ManagedInvocationToolAttachment | undefined,
  sessionEventSink: ManagedInvocationSessionEventSink,
): ManagedInvocationToolAttachment | undefined {
  if (!attachment) {
    return undefined;
  }
  const { options } = attachment;
  return {
    get callerIdentity() {
      return attachment.callerIdentity;
    },
    get options() {
      return {
        ...options,
        sessionEventSink: {
          publish: async (
            events: readonly CanonicalSessionEvent[],
            context: RuntimeBuiltinToolExecutionContext,
          ) => {
            const sinks = [options.sessionEventSink, sessionEventSink].filter((sink): sink is ManagedInvocationSessionEventSink => (
              sink !== undefined
            ));
            await Promise.allSettled(sinks.map((sink) => sink.publish(events, context)));
          },
        },
      };
    },
  };
}

interface PreparedManagedInvocationRequest {
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly parsed: ManagedInvocationToolInput;
  readonly canonicalizedRawInput: Record<string, unknown>;
  readonly route: ManagedInvocationToolRoute;
  readonly request: ReturnType<typeof defineManagedAgentInvocationRequest>;
  readonly capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput;
  readonly canonicalizedForbiddenInputFields?: readonly string[];
}

function canonicalizeManagedInvocationRawInput(
  rawInput: Record<string, unknown>,
  routes: readonly ManagedInvocationToolRoute[],
): {
  readonly input: Record<string, unknown>;
  readonly canonicalizedForbiddenInputFields: readonly string[];
} {
  const forbiddenInputFields = readTextArray(rawInput.forbiddenInputFields) ?? [];
  const routeOwnsAgentSelection = forbiddenInputFields.includes("agentProfile");
  if (!routeOwnsAgentSelection) {
    return { input: rawInput, canonicalizedForbiddenInputFields: [] };
  }

  const canonicalizedForbiddenInputFields: string[] = [];
  const providerRoute = readRecord(rawInput.providerRoute);
  const routeId = readText(rawInput.routeId);
  const providerId = readText(providerRoute?.providerId);
  const route = routeId && providerId
    ? routes.find((candidate) => candidate.routeId === routeId && candidate.providerId === providerId)
    : undefined;
  const nextProviderRoute = providerRoute && route
    ? routeOwnedProviderRoute(providerRoute, route.model)
    : providerRoute;
  if (readText(rawInput.agentProfile)) {
    canonicalizedForbiddenInputFields.push("agentProfile");
  }
  const withoutAgentProfile = Object.fromEntries(
    Object.entries(rawInput).filter(([key]) => key !== "agentProfile"),
  );
  return {
    input: {
      ...withoutAgentProfile,
      ...(nextProviderRoute ? { providerRoute: nextProviderRoute } : {}),
    },
    canonicalizedForbiddenInputFields: unique(canonicalizedForbiddenInputFields),
  };
}

function routeOwnedProviderRoute(
  providerRoute: Record<string, unknown>,
  routeModel: string | undefined,
): Record<string, unknown> {
  const providerRouteWithoutModel = Object.fromEntries(
    Object.entries(providerRoute).filter(([key]) => key !== "model"),
  );
  return {
    ...providerRouteWithoutModel,
    ...(routeModel ? { model: routeModel } : {}),
  };
}

async function prepareManagedInvocationRequest(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  attachment: ManagedInvocationToolAttachment,
  toolName: string,
  scopeAdmission: "required" | "already-admitted" = "required",
): Promise<
  | { readonly ok: true; readonly prepared: PreparedManagedInvocationRequest }
  | { readonly ok: false; readonly result: ManagedInvocationToolResult }
> {
  const { options, callerIdentity } = attachment;
  if (!context) {
    return { ok: false, result: errorResult(`${toolName} requires runtime session context.`, {}, toolName) };
  }

  const canonicalizedRawInput = canonicalizeManagedInvocationRawInput(rawInput, options.routes);
  const parsed = parseInput(canonicalizedRawInput.input, toolName);
  if (!parsed.ok) {
    return { ok: false, result: errorResult(parsed.error, {}, toolName) };
  }
  const requestedAuthority = resolveManagedInvocationRequestedAuthority(
    parsed.input.requestedAuthority,
    context.effectiveTurnAuthority?.requestedAuthority,
  );

  if (scopeAdmission === "required" && parsed.input.goalRunId) {
    const admission = attachment.governedScopeAdmission?.({
      parentSessionId: context.session.id,
      goalRunId: parsed.input.goalRunId,
      profile: parsed.input.profile,
      requestedAuthority,
      ...(parsed.input.workItemId ? { workItemId: parsed.input.workItemId } : {}),
      ...(parsed.input.attemptId ? { attemptId: parsed.input.attemptId } : {}),
    });
    if (!admission) {
      return {
        ok: false,
        result: errorResult(
          "Managed invocation governed scope cannot be verified on this runtime surface.",
          {
            errorCode: "governed_scope_admission_unavailable",
            status: "denied",
          },
          toolName,
        ),
      };
    }
    if (!admission.admitted) {
      return {
        ok: false,
        result: errorResult(admission.message, {
          errorCode: admission.code,
          status: "denied",
          ...(admission.suggestedNextTool ? { suggestedNextTool: admission.suggestedNextTool } : {}),
        }, toolName),
      };
    }
  }

  const agentProfile = resolveManagedInvocationAgentProfile(options, parsed.input.agentProfile);
  const agentRouteValidation = validateAgentRouteHint(parsed.input, agentProfile, toolName);
  if (!agentRouteValidation.ok) {
    const recovery = buildRouteProfileConflictRecovery(parsed.input, agentRouteValidation, context, toolName);
    return {
      ok: false,
      result: errorResult(recovery.output, recovery.metadata, toolName),
    };
  }
  const routeResolution = resolveRoute(options.routes, parsed.input, agentProfile);
  if (routeResolution.status === "ambiguous") {
    return { ok: false, result: errorResult(routeResolution.reason, {}, toolName) };
  }
  if (routeResolution.status === "missing") {
    const unavailableRoute = resolveUnavailableRoute(options.unavailableRoutes ?? [], parsed.input);
    if (unavailableRoute) {
      return {
        ok: false,
        result: errorResult(
          `Managed invocation route '${unavailableRoute.routeId}' is unavailable for provider '${parsed.input.providerRoute.providerId}' and profile '${parsed.input.profile}': ${unavailableRoute.reason}`,
          {
            routeId: unavailableRoute.routeId,
            routeSource: unavailableRoute.routeSource,
            profile: parsed.input.profile,
            providerRoute: {
              providerId: unavailableRoute.providerId,
              ...(unavailableRoute.model ? { model: unavailableRoute.model } : {}),
            },
            status: "unavailable",
            presentationIntent: buildManagedInvocationPresentationIntent({
              sourceToolName: toolName,
              routeId: unavailableRoute.routeId,
              routeSource: unavailableRoute.routeSource,
              profile: parsed.input.profile,
              providerId: unavailableRoute.providerId,
              model: unavailableRoute.model,
              status: "unavailable",
              substantiveEvidence: false,
              failureReason: unavailableRoute.reason,
            }),
          },
          toolName,
        ),
      };
    }
    return {
      ok: false,
      result: errorResult(`No managed invocation route is configured for provider '${parsed.input.providerRoute.providerId}' and profile '${parsed.input.profile}'.`, {}, toolName),
    };
  }
  const route = routeResolution.route;
  const invocationCapabilityEvidence = evaluateManagedInvocationCallerCapability({
    callerIdentity,
    providerId: route.providerId,
    ...(route.model ? { model: route.model } : {}),
    adapterEvidence: {
      adapterDescriptorId: route.adapter.descriptor.adapterDescriptorId,
      adapterId: "kiln-managed-invocation",
    },
  });
  if (invocationCapabilityEvidence.decision === "denied") {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation denied: ${invocationCapabilityEvidence.reason}`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.input.profile,
          providerRoute: {
            providerId: route.providerId,
            ...(route.model ? { model: route.model } : {}),
          },
          status: "denied",
          callerIdentity,
          invocationCapabilityEvidence,
        },
        toolName,
      ),
    };
  }

  const profileDefaults = route.profiles[parsed.input.profile];
  if (!profileDefaults) {
    return {
      ok: false,
      result: errorResult(`Managed invocation route '${route.routeId}' does not allow profile '${parsed.input.profile}'.`, {}, toolName),
    };
  }

  const missingRequiredTools = missingManagedInvocationRequiredTools(
    parsed.input.requiredToolNames ?? [],
    profileDefaults.allowedToolNames,
  );
  if (missingRequiredTools.length > 0) {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation route '${route.routeId}' cannot execute this phase because it lacks required tools: ${missingRequiredTools.join(", ")}.`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.input.profile,
          status: "unavailable",
          missingRequiredTools,
          requiredToolNames: parsed.input.requiredToolNames ?? [],
          allowedToolNames: profileDefaults.allowedToolNames,
          presentationIntent: buildManagedInvocationPresentationIntent({
            sourceToolName: toolName,
            routeId: route.routeId,
            routeSource: route.routeSource,
            profile: parsed.input.profile,
            providerId: route.providerId,
            model: route.model,
            contextMode: parsed.input.contextMode,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: `Missing required route tools: ${missingRequiredTools.join(", ")}`,
          }),
        },
        toolName,
      ),
    };
  }

  const missingRequiredCapabilities = missingManagedInvocationRequiredCapabilities(
    parsed.input.requiredToolNames ?? [],
    profileDefaults,
  );
  if (missingRequiredCapabilities.length > 0) {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation route '${route.routeId}' cannot execute this phase because it lacks required capabilities: ${missingRequiredCapabilities.join(", ")}.`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.input.profile,
          status: "unavailable",
          missingRequiredCapabilities,
          requiredToolNames: parsed.input.requiredToolNames ?? [],
          presentationIntent: buildManagedInvocationPresentationIntent({
            sourceToolName: toolName,
            routeId: route.routeId,
            routeSource: route.routeSource,
            profile: parsed.input.profile,
            providerId: route.providerId,
            model: route.model,
            contextMode: parsed.input.contextMode,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: `Missing required route capabilities: ${missingRequiredCapabilities.join(", ")}`,
          }),
        },
        toolName,
      ),
    };
  }

  const missingRequiredReadPaths = missingManagedInvocationRequiredReadPaths(
    parsed.input.requiredReadPaths ?? [],
    profileDefaults,
  );
  if (missingRequiredReadPaths.length > 0) {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation route '${route.routeId}' cannot execute this phase because it cannot read required paths: ${missingRequiredReadPaths.join(", ")}.`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.input.profile,
          status: "unavailable",
          missingRequiredReadPaths,
          requiredReadPaths: parsed.input.requiredReadPaths ?? [],
          allowedReadPaths: effectiveManagedInvocationReadRoots(profileDefaults),
          deniedReadPaths: profileDefaults.readAuthority?.workspace.deniedPaths ?? [],
          presentationIntent: buildManagedInvocationPresentationIntent({
            sourceToolName: toolName,
            routeId: route.routeId,
            routeSource: route.routeSource,
            profile: parsed.input.profile,
            providerId: route.providerId,
            model: route.model,
            contextMode: parsed.input.contextMode,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: `Missing required read authority: ${missingRequiredReadPaths.join(", ")}`,
          }),
        },
        toolName,
      ),
    };
  }

  const authorityAdmission = validateManagedInvocationRequestedAuthority(requestedAuthority, parsed.input.profile, toolName);
  if (!authorityAdmission.ok) {
    return {
      ok: false,
      result: errorResult(authorityAdmission.error, {
        profile: parsed.input.profile,
        requestedAuthority,
        routeId: route.routeId,
        routeSource: route.routeSource,
      }, toolName),
    };
  }

  const contextResolution = await resolveInvocationContext(parsed.input, options, route);
  if (!contextResolution.ok) {
    const contextMetadata = buildManagedInvocationContextMetadata(parsed.input, contextResolution.resolution);
    return {
      ok: false,
      result: errorResult(contextResolution.error, {
        routeId: route.routeId,
        routeSource: route.routeSource,
        profile: parsed.input.profile,
        providerRoute: {
          providerId: route.providerId,
          ...(route.model ? { model: route.model } : {}),
          ...(route.surface ? { surface: route.surface } : {}),
        },
        status: contextResolution.status,
        context: contextMetadata,
        presentationIntent: buildManagedInvocationPresentationIntent({
          sourceToolName: toolName,
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.input.profile,
          providerId: route.providerId,
          model: route.model,
          contextMode: parsed.input.contextMode,
          status: contextResolution.status,
          substantiveEvidence: false,
          failureReason: contextResolution.error,
        }),
      }, toolName),
    };
  }
  const prompt = contextResolution.resolution.promptPrefix
    ? `${contextResolution.resolution.promptPrefix}\n\nTask:\n${parsed.input.task}`
    : parsed.input.task;

  const parentTurnId = resolveManagedInvocationParentTurnId(context);
  const invocationId = buildInvocationId(
    context.session.id,
    resolveManagedInvocationParentTurnOrdinal(parentTurnId, context.session.userTurnCount),
    context.toolCall.id,
  );
  const resolvedAuthority = resolveManagedInvocationRouteAuthority(profileDefaults, invocationId);
  const handoffContract = buildHandoffContract(parsed.input);
  const contextMetadata = buildManagedInvocationContextMetadata(parsed.input, contextResolution.resolution);
  const authorityApproval = await requestManagedInvocationAuthorityApproval({
    requestedAuthority,
    routeId: route.routeId,
    profile: parsed.input.profile,
    context,
    toolName,
  });
  if (!authorityApproval.ok) {
    return {
      ok: false,
      result: errorResult(authorityApproval.error, {
        profile: parsed.input.profile,
        requestedAuthority,
        routeId: route.routeId,
      }, toolName),
    };
  }

  const executionScope = parsed.input.workItemId
    ? {
        kind: "work_item" as const,
        goalRunId: parsed.input.goalRunId!,
        workItemId: parsed.input.workItemId,
        ...(parsed.input.attemptId ? { attemptId: parsed.input.attemptId } : {}),
        managedInvocationId: invocationId,
      }
    : parsed.input.goalRunId
      ? { kind: "goal" as const, goalRunId: parsed.input.goalRunId, managedInvocationId: invocationId }
      : undefined;
  const request = defineManagedAgentInvocationRequest({
    invocationId,
    agentId: `${route.routeId}:${parsed.input.profile}`,
    parentSessionId: context.session.id,
    parentTurnId,
    profile: parsed.input.profile,
    requestedBy: options.requestedBy ?? "assistant",
    requestSource: options.requestSource ?? "runtime-tool",
    executionIntent: toolName === MANAGED_AGENT_START_TOOL_NAME
      ? { attendance: "unattended", lifecycle: "background" }
      : { attendance: "attended", lifecycle: "foreground" },
    requestedAuthority,
    ...(authorityApproval.authorityApproval ? { authorityApproval: authorityApproval.authorityApproval } : {}),
    providerRoute: {
      providerId: route.providerId,
      surface: route.surface ?? route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
      ...(parsed.input.providerRoute.model ?? route.model ? { model: parsed.input.providerRoute.model ?? route.model } : {}),
      ...(parsed.input.providerRoute.reasoningEffort ? { reasoningEffort: parsed.input.providerRoute.reasoningEffort } : {}),
    },
    adapterKind: route.adapter.descriptor.adapterKind,
    executionMode: route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
    ...(executionScope ? { executionScope } : {}),
    authority: {
      authorityProfileId: profileDefaults.authorityProfileId,
      permissionProfile: profileDefaults.permissionProfile,
      toolAuthority: {
        allowedToolNames: profileDefaults.allowedToolNames,
        writeAllowed: profileDefaults.writeAllowed === true,
        networkAllowed: profileDefaults.networkAllowed === true,
      },
      workingDirectory: resolvedAuthority.workingDirectory,
      timeoutMs: profileDefaults.timeoutMs,
      ...(profileDefaults.timeoutSource ? { timeoutSource: profileDefaults.timeoutSource } : {}),
      credentialRoute: normalizeManagedInvocationCredentialRoute(profileDefaults.credentialRoute),
      memoryScope: profileDefaults.memoryScope,
      ...(profileDefaults.readAuthority ? { readAuthority: profileDefaults.readAuthority } : {}),
      ...(resolvedAuthority.writeAuthority ? { writeAuthority: resolvedAuthority.writeAuthority } : {}),
    },
    input: {
      summary: parsed.input.summary,
      prompt,
      ...(parsed.input.resourceUris ? { resourceUris: parsed.input.resourceUris } : {}),
      context: contextMetadata,
      ...(handoffContract ? { handoff: handoffContract } : {}),
    },
  });

  return {
    ok: true,
    prepared: {
      context,
      parsed: parsed.input,
      canonicalizedRawInput: canonicalizedRawInput.input,
      route,
      request,
      capabilitySnapshotInput: {
        routeId: route.routeId,
        routeSource: route.routeSource,
        callerIdentity,
        invocationCapabilityEvidence,
        routeHealth: {
          status: "healthy",
          reason: managedInvocationRouteHealthReason(profileDefaults, route.routeSource),
        },
        providerModelProof: {
          ...(route.providerModelProof ?? {
            status: "live-proven",
            source: "managed-invocation-route-health",
            requiresToolCalls: route.adapter.descriptor.adapterKind === "direct",
          }),
        },
        resourcePlane: {
          available: true,
          resourceUris: parsed.input.resourceUris ?? [],
          reason: parsed.input.resourceUris && parsed.input.resourceUris.length > 0
            ? "Governed resource URIs admitted by runtime context selection."
            : "No governed resources requested.",
        },
        childIdentity: {
          agentId: `${route.routeId}:${parsed.input.profile}`,
          ...(parsed.input.agentProfile ? { requestedAgentProfile: parsed.input.agentProfile } : {}),
          ...(contextResolution.resolution.admittedAgentProfile ? { admittedAgentProfile: contextResolution.resolution.admittedAgentProfile } : {}),
          ...(managedAgentDisplayName(options, contextResolution.resolution.admittedAgentProfile ?? parsed.input.agentProfile)
            ? { displayName: managedAgentDisplayName(options, contextResolution.resolution.admittedAgentProfile ?? parsed.input.agentProfile) }
            : {}),
          ...(route.voiceProfile ? { voiceProfile: route.voiceProfile } : {}),
        },
      },
      ...(canonicalizedRawInput.canonicalizedForbiddenInputFields.length > 0
        ? { canonicalizedForbiddenInputFields: canonicalizedRawInput.canonicalizedForbiddenInputFields }
        : {}),
    },
  };
}

function resolveManagedInvocationRouteAuthority(
  profile: ManagedInvocationRouteProfile,
  invocationId: string,
): Pick<ManagedAgentAuthorityProfile, "workingDirectory" | "writeAuthority"> {
  const workingDirectory = resolveManagedInvocationWorkingDirectory(profile, invocationId);
  return {
    workingDirectory,
    ...(profile.writeAuthority
      ? { writeAuthority: resolveManagedInvocationWriteAuthority(profile, workingDirectory) }
      : {}),
  };
}

function resolveManagedInvocationWorkingDirectory(
  profile: ManagedInvocationRouteProfile,
  invocationId: string,
): ManagedAgentWorkingDirectory {
  if (!profile.workingDirectoryLease || profile.workingDirectory.mode !== "isolated-worktree") {
    return profile.workingDirectory;
  }
  return {
    path: joinManagedInvocationLeasePath(profile.workingDirectoryLease.rootPath, sanitizeId(invocationId)),
    mode: "isolated-worktree",
  };
}

function resolveManagedInvocationWriteAuthority(
  profile: ManagedInvocationRouteProfile,
  workingDirectory: ManagedAgentWorkingDirectory,
): ManagedAgentAuthorityProfile["writeAuthority"] {
  const authority = profile.writeAuthority;
  if (!authority || !profile.workingDirectoryLease || workingDirectory.mode !== "isolated-worktree") {
    return authority;
  }
  return {
    ...authority,
    scope: {
      ...authority.scope,
      workspace: {
        ...authority.scope.workspace,
        allowedPaths: rebaseManagedInvocationLeasePaths(
          authority.scope.workspace.allowedPaths,
          profile.workingDirectoryLease.sourcePath,
          workingDirectory.path,
        ),
        deniedPaths: rebaseManagedInvocationLeasePaths(
          authority.scope.workspace.deniedPaths,
          profile.workingDirectoryLease.sourcePath,
          workingDirectory.path,
        ),
      },
    },
  };
}

function rebaseManagedInvocationLeasePaths(
  paths: readonly string[],
  sourceRootPath: string,
  targetRootPath: string,
): readonly string[] {
  return paths.map((path) => rebaseManagedInvocationLeasePath(path, sourceRootPath, targetRootPath));
}

function rebaseManagedInvocationLeasePath(
  path: string,
  sourceRootPath: string,
  targetRootPath: string,
): string {
  const normalizedPath = normalizeManagedInvocationPath(path);
  const normalizedSource = normalizeManagedInvocationPath(sourceRootPath);
  const normalizedTarget = normalizeManagedInvocationPath(targetRootPath);
  if (normalizedPath === normalizedSource) {
    return normalizedTarget;
  }
  const prefix = `${normalizedSource}/`;
  if (!normalizedPath.startsWith(prefix)) {
    return path;
  }
  return `${normalizedTarget}/${normalizedPath.slice(prefix.length)}`;
}

function normalizeManagedInvocationPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function joinManagedInvocationLeasePath(rootPath: string, childId: string): string {
  if (win32.isAbsolute(rootPath) || rootPath.includes("\\")) {
    return win32.join(rootPath, childId);
  }
  if (posix.isAbsolute(rootPath)) {
    return posix.join(rootPath, childId);
  }
  return resolve(rootPath, childId);
}

async function executeManagedInvocationTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  attachment: ManagedInvocationToolAttachment,
  service: RuntimeManagedAgentInvocationService,
  scopeAdmission: "required" | "already-admitted" = "required",
): Promise<ManagedInvocationToolResult> {
  const { options } = attachment;
  const preparedResult = await prepareManagedInvocationRequest(
    rawInput,
    context,
    attachment,
    MANAGED_AGENT_INVOKE_TOOL_NAME,
    scopeAdmission,
  );
  if (!preparedResult.ok) {
    return preparedResult.result;
  }
  const { prepared } = preparedResult;

  const startedAt = Date.now();
  const startResult = await service.start(
    prepared.request,
    prepared.route.adapter,
    prepared.capabilitySnapshotInput,
    {
      ...(prepared.context.abortSignal ? { abortSignal: prepared.context.abortSignal } : {}),
    },
  );
  const startEvents = await appendAndPublishManagedInvocationStartSessionEvents({
    options,
    context: prepared.context,
    request: prepared.request,
    decision: startResult.decision,
  });
  if (startResult.status === "denied") {
    return {
      output: `Managed invocation denied: ${startResult.decision.reason}`,
      isError: true,
      metadata: {
        toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
        kind: "managed-invocation",
        invocationId: prepared.request.invocationId,
        routeId: prepared.route.routeId,
        routeSource: prepared.route.routeSource,
        parentSessionId: prepared.request.parentSessionId,
        parentTurnId: prepared.request.parentTurnId,
        status: "denied",
        profile: prepared.request.profile,
        providerRoute: prepared.request.providerRoute,
        ...(prepared.route.voiceProfile ? { voiceProfile: prepared.route.voiceProfile } : {}),
        adapterKind: prepared.request.adapterKind,
        executionMode: prepared.request.executionMode,
        requestedAuthority: prepared.request.requestedAuthority,
        authorityProfileId: prepared.request.authority.authorityProfileId,
        context: prepared.request.input.context,
        ...(prepared.request.input.handoff ? { handoffContract: prepared.request.input.handoff } : {}),
        missingCapabilities: startResult.decision.missingCapabilities,
        ...(startResult.decision.resourceLease
          ? {
              resourceLease: projectManagedInvocationResourceLeaseResources(
                startResult.decision.resourceLease,
                projectManagedInvocationPublicResourceUri,
              ),
            }
          : {}),
        sessionEventIds: startEvents.map((event) => event.eventId),
        presentationIntent: buildManagedInvocationPresentationIntent({
          sourceToolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
          routeId: prepared.route.routeId,
          routeSource: prepared.route.routeSource,
          profile: prepared.request.profile,
          providerId: prepared.request.providerRoute.providerId,
          model: prepared.request.providerRoute.model,
          contextMode: prepared.parsed.contextMode,
          status: "denied",
          substantiveEvidence: false,
          failureReason: startResult.decision.reason,
        }),
      },
    };
  }
  const invocationResult = await service.join(startResult.snapshot.invocationId);
  if (invocationResult.status !== "completed") {
    throw new Error("Admitted managed invocation returned a denied terminal result.");
  }
  const durationMs = Date.now() - startedAt;
  const terminalEvents = await appendAndPublishManagedInvocationTerminalSessionEvent({
    options,
    context: prepared.context,
    request: prepared.request,
    record: invocationResult.record,
    durationMs,
  });
  const result = {
    ...invocationResult,
    record: projectManagedInvocationRecordResources(invocationResult.record, { artifactStore: options.artifactStore }),
  };
  const events = [...startEvents, ...terminalEvents];

  const terminalSnapshot = service.status(prepared.request.invocationId);
  return terminalManagedInvocationResult({
    toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
    rawInput: prepared.canonicalizedRawInput,
    routeId: prepared.route.routeId,
    ...(prepared.route.voiceProfile ? { voiceProfile: prepared.route.voiceProfile } : {}),
    contextMode: prepared.parsed.contextMode,
    request: prepared.request,
    record: result.record,
    progressEvents: terminalSnapshot?.progressEvents,
    ...(prepared.canonicalizedForbiddenInputFields
      ? { canonicalizedForbiddenInputFields: prepared.canonicalizedForbiddenInputFields }
      : {}),
    sessionEventIds: events.map((event) => event.eventId),
  });
}

async function executeManagedInvocationStartTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  attachment: ManagedInvocationToolAttachment,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const { options } = attachment;
  const preparedResult = await prepareManagedInvocationRequest(rawInput, context, attachment, MANAGED_AGENT_START_TOOL_NAME);
  if (!preparedResult.ok) {
    return preparedResult.result;
  }
  const { prepared } = preparedResult;
  let terminalPublicationEnabled = true;
  let markStartSessionEventsReady = (): void => {};
  const startSessionEventsReady = new Promise<void>((resolve) => {
    markStartSessionEventsReady = resolve;
  });
  const publishBackgroundTerminal = (
    notification: ManagedAgentRuntimeInvocationTerminalNotification,
  ): void => {
    void startSessionEventsReady
      .then(async () => {
        if (!terminalPublicationEnabled) {
          return;
        }
        await appendAndPublishManagedInvocationTerminalSessionEvent({
          options,
          context: prepared.context,
          request: notification.request,
          record: notification.record,
          ...(notification.durationMs !== undefined ? { durationMs: notification.durationMs } : {}),
        });
      })
      .catch(() => undefined);
  };
  let startResult: Awaited<ReturnType<RuntimeManagedAgentInvocationService["start"]>>;
  try {
    startResult = await service.start(
      prepared.request,
      prepared.route.adapter,
      prepared.capabilitySnapshotInput,
      {
        ...(prepared.context.abortSignal ? { abortSignal: prepared.context.abortSignal } : {}),
        terminalObserver: publishBackgroundTerminal,
      },
    );
  } catch (error) {
    const terminalizedSnapshot = service.status(prepared.request.invocationId);
    if (terminalizedSnapshot?.record !== undefined) {
      const record = projectManagedInvocationRecordResources(terminalizedSnapshot.record, {
        artifactStore: options.artifactStore,
      });
      let events: readonly CanonicalSessionEvent[] = [];
      try {
        const startEvents = await appendAndPublishManagedInvocationStartSessionEvents({
          options,
          context: prepared.context,
          request: terminalizedSnapshot.request,
          decision: terminalizedSnapshot.decision,
        });
        const terminalEvents = await appendAndPublishManagedInvocationTerminalSessionEvent({
          options,
          context: prepared.context,
          request: terminalizedSnapshot.request,
          record: terminalizedSnapshot.record,
          ...(terminalizedSnapshot.durationMs !== undefined ? { durationMs: terminalizedSnapshot.durationMs } : {}),
        });
        events = [...startEvents, ...terminalEvents];
      } finally {
        markStartSessionEventsReady();
      }
      return terminalManagedInvocationResult({
        toolName: MANAGED_AGENT_START_TOOL_NAME,
        rawInput,
        routeId: terminalizedSnapshot.decision.capabilitySnapshot.routeId,
        voiceProfile: terminalizedSnapshot.decision.capabilitySnapshot.childIdentity.voiceProfile,
        contextMode: terminalizedSnapshot.decision.capabilitySnapshot.contextMode,
        request: terminalizedSnapshot.request,
        record,
        progressEvents: terminalizedSnapshot.progressEvents,
        ...(prepared.canonicalizedForbiddenInputFields
          ? { canonicalizedForbiddenInputFields: prepared.canonicalizedForbiddenInputFields }
          : {}),
        sessionEventIds: terminalSessionEventIdsForResult({
          events,
          context: prepared.context,
          invocationId: prepared.request.invocationId,
        }),
      });
    }
    terminalPublicationEnabled = false;
    markStartSessionEventsReady();
    throw error;
  }
  let events: readonly CanonicalSessionEvent[] = [];
  try {
    events = await appendAndPublishManagedInvocationStartSessionEvents({
      options,
      context: prepared.context,
      request: prepared.request,
      decision: startResult.decision,
    });
  } finally {
    markStartSessionEventsReady();
  }

  if (startResult.status === "denied") {
    return {
      output: `Managed invocation denied: ${startResult.decision.reason}`,
      isError: true,
      metadata: {
        toolName: MANAGED_AGENT_START_TOOL_NAME,
        kind: "managed-invocation",
        invocationId: prepared.request.invocationId,
        routeId: prepared.route.routeId,
        routeSource: prepared.route.routeSource,
        parentSessionId: prepared.request.parentSessionId,
        parentTurnId: prepared.request.parentTurnId,
        status: "denied",
        lifecycleState: "failed",
        profile: prepared.request.profile,
        providerRoute: prepared.request.providerRoute,
        adapterKind: prepared.request.adapterKind,
        executionMode: prepared.request.executionMode,
        requestedAuthority: prepared.request.requestedAuthority,
        authorityProfileId: prepared.request.authority.authorityProfileId,
        context: prepared.request.input.context,
        ...(prepared.request.input.handoff ? { handoffContract: prepared.request.input.handoff } : {}),
        missingCapabilities: startResult.decision.missingCapabilities,
        ...(startResult.decision.resourceLease
          ? {
              resourceLease: projectManagedInvocationResourceLeaseResources(
                startResult.decision.resourceLease,
                projectManagedInvocationPublicResourceUri,
              ),
            }
          : {}),
        sessionEventIds: events.map((event) => event.eventId),
        presentationIntent: buildManagedInvocationPresentationIntent({
          sourceToolName: MANAGED_AGENT_START_TOOL_NAME,
          routeId: prepared.route.routeId,
          routeSource: prepared.route.routeSource,
          profile: prepared.request.profile,
          providerId: prepared.request.providerRoute.providerId,
          model: prepared.request.providerRoute.model,
          contextMode: prepared.request.input.context?.mode,
          status: "denied",
          substantiveEvidence: false,
          failureReason: formatManagedInvocationAdmissionDenied(startResult.decision),
        }),
      },
    };
  }

  const capabilitySnapshot = projectManagedInvocationCapabilitySnapshotResources(
    startResult.snapshot.decision.capabilitySnapshot,
    projectManagedInvocationPublicResourceUri,
  );
  const authoritySnapshot = projectManagedInvocationAuthoritySnapshot(startResult.snapshot.request.authority);
  const timeoutEvidence = projectManagedInvocationTimeoutEvidence(
    startResult.snapshot.decision.capabilitySnapshot.authorityProfile,
  );
  return {
    output: JSON.stringify({
      status: "started",
      lifecycleState: startResult.snapshot.lifecycleState,
      invocationId: startResult.snapshot.invocationId,
      routeId: prepared.route.routeId,
      routeSource: prepared.route.routeSource,
      parentSessionId: startResult.snapshot.parentSessionId,
      parentTurnId: startResult.snapshot.parentTurnId,
      profile: startResult.snapshot.profile,
      ...timeoutEvidence,
      authoritySnapshot,
    }, null, 2),
    isError: false,
    metadata: {
      toolName: MANAGED_AGENT_START_TOOL_NAME,
      kind: "managed-invocation",
      invocationId: startResult.snapshot.invocationId,
      routeId: prepared.route.routeId,
      routeSource: prepared.route.routeSource,
      parentSessionId: startResult.snapshot.parentSessionId,
      parentTurnId: startResult.snapshot.parentTurnId,
      status: "started",
      lifecycleState: startResult.snapshot.lifecycleState,
      ...timeoutEvidence,
      profile: startResult.snapshot.profile,
      providerRoute: startResult.snapshot.providerRoute,
      ...(prepared.route.voiceProfile ? { voiceProfile: prepared.route.voiceProfile } : {}),
      adapterKind: startResult.snapshot.adapterKind,
      executionMode: startResult.snapshot.executionMode,
      requestedAuthority: prepared.request.requestedAuthority,
      authorityProfileId: startResult.snapshot.authorityProfileId,
      authoritySnapshot,
      capabilitySnapshot,
      context: prepared.request.input.context,
      ...(prepared.request.input.handoff ? { handoffContract: prepared.request.input.handoff } : {}),
      sessionEventIds: events.map((event) => event.eventId),
    },
  };
}

interface ManagedOrchestrationWorkItemInput {
  readonly id: string;
  readonly roleIntent: string;
  readonly task: string;
  readonly agentProfile?: string;
  readonly routeId?: string;
  readonly dependencies: readonly string[];
}

interface ResolvedManagedOrchestrationWorkItem extends ManagedOrchestrationWorkItemInput {
  readonly routeId: string;
}

async function executeManagedAgentOrchestrationTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  options: ManagedInvocationToolOptionsWithService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  if (!session.ok) return session.result;
  const profile = readText(rawInput.profile) as ManagedAgentAdmissionProfile | undefined;
  if (!profile || profile === "rejected" || !MANAGED_AGENT_ORCHESTRATION_PROFILES.includes(profile)) {
    return errorResult("managed_agent.orchestrate requires a supported profile.", {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const taskRisk = readText(rawInput.taskRisk);
  if (taskRisk !== "low" && taskRisk !== "medium" && taskRisk !== "high" && taskRisk !== "unknown") {
    return errorResult("managed_agent.orchestrate requires taskRisk.", {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const parsedWorkItems = readManagedOrchestrationWorkItems(rawInput.workItems);
  if (!parsedWorkItems.ok) {
    return errorResult(parsedWorkItems.message, {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const orderedWorkItems = orderManagedOrchestrationWorkItems(parsedWorkItems.workItems);
  if (!orderedWorkItems.ok) {
    return errorResult(orderedWorkItems.message, {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const availableRoutes = eligibleManagedOrchestrationRoutes(options, profile);
  const maxParallelWorkers = Math.max(1, options.maxParallelChildren ?? 1);
  const budgetAdmission = await admitManagedOrchestrationBudget({
    budgetAdmission: options.orchestrationBudgetAdmission,
    sessionId: session.context.session.id,
    turnId: session.context.turnId,
    routes: availableRoutes,
  });
  const decision = decideManagedAgentCoordination({
    governanceRecommendation: "orchestrate",
    workItemCount: orderedWorkItems.workItems.length,
    dependencyCount: orderedWorkItems.workItems.reduce((count, item) => count + item.dependencies.length, 0),
    requiresIndependentReview: rawInput.requiresIndependentReview === true,
    taskRisk,
    managedRouteCount: availableRoutes.length,
    maxParallelWorkers,
    routeHealth: availableRoutes.length > 0 ? "available" : "unavailable",
    budget: budgetAdmission.available ? "available" : "unavailable",
    workspace: availableRoutes.length > 0 ? "available" : "unavailable",
  });
  if (decision.status === "denied") {
    return errorResult([
      ...decision.reasons,
      ...(!budgetAdmission.available ? [budgetAdmission.reason] : []),
    ].join("; "), {
      operation: "managed_orchestration_denied",
      coordinationDecision: decision,
      ...(!budgetAdmission.available ? { budgetAdmissionReason: budgetAdmission.reason } : {}),
    }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  if (decision.topology === "direct" || !decision.orchestrationMode) {
    return errorResult("managed_agent.orchestrate cannot execute a direct topology.", {
      operation: "managed_orchestration_direct",
      coordinationDecision: decision,
    }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const resolvedWorkItems = resolveManagedOrchestrationWorkItems(orderedWorkItems.workItems, profile, options);
  if (!resolvedWorkItems.ok) {
    return errorResult(resolvedWorkItems.message, { operation: "managed_orchestration_denied" }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const routesById = new Map(options.routes.map((route) => [route.routeId, route]));
  const eligibleRoutes = unique(resolvedWorkItems.workItems.map((item) => item.routeId))
    .map((routeId) => routesById.get(routeId)!);
  const workingDirectoryModes = unique(eligibleRoutes.map((route) => route.profiles[profile]!.workingDirectory.mode));
  if (workingDirectoryModes.length !== 1) {
    return errorResult(
      "managed_agent.orchestrate team members must currently share one governed working-directory mode.",
      { operation: "managed_orchestration_denied" },
      MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
    );
  }
  const workingDirectoryMode = workingDirectoryModes[0] as ManagedAgentWorkingDirectory["mode"];
  const orchestrationId = `managed-orchestration:${session.context.session.id}:${session.context.toolCall.id}`;
  const base = {
    orchestrationId,
    parentSessionId: session.context.session.id,
    parentTurnId: session.context.turnId ?? session.context.toolCall.id,
    requestedBy: options.requestedBy ?? "runtime",
    requestSource: options.requestSource ?? MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
    task: resolvedWorkItems.workItems.map((item) => item.task).join("\n"),
    workingDirectoryMode,
  };
  const childPlans = resolvedWorkItems.workItems.map((item) => ({
    key: item.id,
    roleIntent: item.roleIntent,
    task: item.task,
    ...(item.agentProfile ? { agentProfile: item.agentProfile } : {}),
    routeId: item.routeId,
    dependsOn: item.dependencies,
  }));
  const orchestrationRequest = decision.orchestrationMode === "background-job"
    ? buildManagedAgentBackgroundJobOrchestrationRequest({
      ...base,
      key: resolvedWorkItems.workItems[0]!.id,
      roleIntent: resolvedWorkItems.workItems[0]!.roleIntent,
      task: resolvedWorkItems.workItems[0]!.task,
      ...(resolvedWorkItems.workItems[0]!.agentProfile
        ? { agentProfile: resolvedWorkItems.workItems[0]!.agentProfile }
        : {}),
      routeId: resolvedWorkItems.workItems[0]!.routeId,
    })
    : decision.orchestrationMode === "review-swarm"
      ? buildManagedAgentReviewSwarmOrchestrationRequest({
        ...base,
        childPlans,
        maxConcurrentChildren: decision.maxConcurrentChildren,
      })
      : buildManagedAgentDecompositionOrchestrationRequest({
        ...base,
        childPlans,
        maxConcurrentChildren: decision.maxConcurrentChildren,
      });
  try {
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest,
      managedInvocation: options,
      profile,
      requestedAuthority: managedOrchestrationRequestedAuthority(profile),
      lifecycleObserver: {
        onAdmissionResolved: async ({ request, decision: admissionDecision }) => {
          await appendAndPublishManagedInvocationStartSessionEvents({
            options,
            context: session.context,
            request,
            decision: admissionDecision,
          });
        },
        onTerminal: async ({ request, record, durationMs }) => {
          await appendAndPublishManagedInvocationTerminalSessionEvent({
            options,
            context: session.context,
            request,
            record,
            ...(durationMs !== undefined ? { durationMs } : {}),
          });
        },
      },
    });
    return {
      output: JSON.stringify({
        status: result.orchestrationResult.status,
        coordinationDecision: decision,
        orchestrationResult: result.orchestrationResult,
      }, null, 2),
      isError: result.orchestrationResult.status === "failed",
      metadata: {
        toolName: MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
        operation: "managed_orchestration_completed",
        orchestrationId,
        coordinationDecision: decision,
        presentationIntent: {
          kind: "timeline",
          title: "Managed orchestration",
          summary: `${decision.topology} · ${result.orchestrationResult.status}`,
          source: MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
          confidence: "high",
          items: result.orchestrationResult.childResults.map((child, index) => ({
            id: child.childId,
            order: child.ordinal,
            label: resolvedWorkItems.workItems[index]?.roleIntent ?? child.childId,
            status: child.success ? "success" : "error",
            summary: child.success
              ? resolvedWorkItems.workItems[index]?.task
              : child.error ?? resolvedWorkItems.workItems[index]?.task,
          })),
        } satisfies PresentationIntent,
      },
    };
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error), {
      operation: "managed_orchestration_failed",
      orchestrationId,
      coordinationDecision: decision,
    }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
}

function managedOrchestrationRequestedAuthority(
  profile: ManagedAgentAdmissionProfile,
): ManagedAgentRequestedAuthority {
  return profile === "foundation-readonly-plan"
    || profile === "diagnostic-only"
    || profile === "comparison-only"
    ? "read_only"
    : "audited";
}

async function admitManagedOrchestrationBudget(input: {
  readonly budgetAdmission?: RuntimeBudgetAdmissionPort;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly routes: readonly ManagedInvocationToolRoute[];
}): Promise<{ readonly available: true } | { readonly available: false; readonly reason: string }> {
  if (!input.budgetAdmission) return { available: true };
  try {
    const decision = await input.budgetAdmission.admit({
      subject: "managed-orchestration",
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      routeCandidates: input.routes.map((route) => ({
        routeId: route.routeId,
        providerId: route.providerId,
        ...(route.model ? { model: route.model } : {}),
      })),
    });
    return decision.status === "admitted"
      ? { available: true }
      : { available: false, reason: decision.message ?? decision.reason };
  } catch (error) {
    return {
      available: false,
      reason: `Managed orchestration budget admission failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readManagedOrchestrationWorkItems(value: unknown):
  | { readonly ok: true; readonly workItems: readonly ManagedOrchestrationWorkItemInput[] }
  | { readonly ok: false; readonly message: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: "managed_agent.orchestrate requires at least one work item." };
  }
  const workItems: ManagedOrchestrationWorkItemInput[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, message: "managed_agent.orchestrate work items must be objects." };
    }
    const record = candidate as Record<string, unknown>;
    const id = readText(record.id);
    const roleIntent = readText(record.roleIntent);
    const task = readText(record.task);
    const agentProfile = readText(record.agentProfile);
    const routeId = readText(record.routeId);
    if (!id || !roleIntent || !task || ids.has(id)) {
      return { ok: false, message: "managed_agent.orchestrate work items require unique ids, roleIntent, and task." };
    }
    ids.add(id);
    const dependencies = Array.isArray(record.dependencies)
      ? record.dependencies.map(readText).filter((dependency): dependency is string => dependency !== undefined)
      : [];
    if (dependencies.length !== (Array.isArray(record.dependencies) ? record.dependencies.length : 0)) {
      return { ok: false, message: `managed_agent.orchestrate work item '${id}' has invalid dependencies.` };
    }
    workItems.push({
      id,
      roleIntent,
      task,
      ...(agentProfile ? { agentProfile } : {}),
      ...(routeId ? { routeId } : {}),
      dependencies: unique(dependencies),
    });
  }
  const unknownDependency = workItems.flatMap((item) => item.dependencies).find((id) => !ids.has(id));
  if (unknownDependency) {
    return { ok: false, message: `managed_agent.orchestrate dependency '${unknownDependency}' does not reference a work item.` };
  }
  return { ok: true, workItems };
}

function resolveManagedOrchestrationWorkItems(
  workItems: readonly ManagedOrchestrationWorkItemInput[],
  profile: ManagedAgentAdmissionProfile,
  options: ManagedInvocationToolOptions,
):
  | { readonly ok: true; readonly workItems: readonly ResolvedManagedOrchestrationWorkItem[] }
  | { readonly ok: false; readonly message: string } {
  const eligibleRoutes = eligibleManagedOrchestrationRoutes(options, profile);
  const eligibleById = new Map(eligibleRoutes.map((route) => [route.routeId, route]));
  const resolved: ResolvedManagedOrchestrationWorkItem[] = [];
  for (const item of workItems) {
    const agent = resolveManagedInvocationAgentProfile(options, item.agentProfile);
    if (item.agentProfile && !agent) {
      return { ok: false, message: `managed_agent.orchestrate work item '${item.id}' references unknown agentProfile '${item.agentProfile}'.` };
    }
    if (item.routeId && agent?.routeId && item.routeId !== agent.routeId) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' routeId '${item.routeId}' contradicts agentProfile '${agent.name}' route hint '${agent.routeId}'.`,
      };
    }
    if (agent?.authorityProfile && agent.authorityProfile !== profile) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' agentProfile '${agent.name}' requires authority profile '${agent.authorityProfile}', not '${profile}'.`,
      };
    }
    const routeId = item.routeId ?? agent?.routeId ?? (eligibleRoutes.length === 1 ? eligibleRoutes[0]!.routeId : undefined);
    if (!routeId) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' requires an admitted agentProfile or explicit routeId because route selection is ambiguous.`,
      };
    }
    if (!eligibleById.has(routeId)) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' route '${routeId}' does not expose the requested governed profile.`,
      };
    }
    resolved.push({
      ...item,
      ...(agent ? { agentProfile: agent.name } : {}),
      routeId,
    });
  }
  return { ok: true, workItems: resolved };
}

function eligibleManagedOrchestrationRoutes(
  options: ManagedInvocationToolOptions,
  profile: ManagedAgentAdmissionProfile,
): readonly ManagedInvocationToolRoute[] {
  return options.routes.filter((route) => {
    const routeProfile = route.profiles[profile];
    return routeProfile !== undefined
      && routeProfile.workingDirectory.mode !== "workspace-write"
      && (routeProfile.workingDirectory.mode !== "isolated-worktree" || routeProfile.workingDirectoryLease !== undefined)
      && route.adapter.descriptor.lifecycle.exposesStart
      && route.adapter.descriptor.lifecycle.exposesTerminal;
  });
}

function orderManagedOrchestrationWorkItems(workItems: readonly ManagedOrchestrationWorkItemInput[]):
  | { readonly ok: true; readonly workItems: readonly ManagedOrchestrationWorkItemInput[] }
  | { readonly ok: false; readonly message: string } {
  const remaining = new Map(workItems.map((item) => [item.id, item]));
  const completed = new Set<string>();
  const ordered: ManagedOrchestrationWorkItemInput[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((item) => item.dependencies.every((id) => completed.has(id)));
    if (ready.length === 0) {
      return { ok: false, message: "managed_agent.orchestrate work item dependencies contain a cycle." };
    }
    for (const item of ready) {
      ordered.push(item);
      completed.add(item.id);
      remaining.delete(item.id);
    }
  }
  return { ok: true, workItems: ordered };
}

async function executeManagedInvocationStatusTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_STATUS_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocationId = readInvocationId(rawInput, MANAGED_AGENT_STATUS_TOOL_NAME);
  if (!invocationId.ok) {
    return invocationId.result;
  }
  const snapshot = service.status(invocationId.value);
  const visibility = visibleManagedInvocationSnapshot(snapshot, session.context.session.id, MANAGED_AGENT_STATUS_TOOL_NAME);
  if (!visibility.ok) {
    return visibility.result;
  }
  return managedInvocationSnapshotResult(MANAGED_AGENT_STATUS_TOOL_NAME, visibility.snapshot);
}

async function executeManagedInvocationListTool(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_LIST_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocations = service.list().filter((snapshot) => snapshot.parentSessionId === session.context.session.id);
  return {
    output: JSON.stringify({
      status: "listed",
      count: invocations.length,
      invocations: invocations.map(projectManagedInvocationSnapshot),
    }, null, 2),
    isError: false,
    metadata: {
      toolName: MANAGED_AGENT_LIST_TOOL_NAME,
      kind: "managed-invocation",
      status: "listed",
      count: invocations.length,
      invocations: invocations.map(projectManagedInvocationSnapshot),
    },
  };
}

async function executeManagedInvocationJoinTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  options: ManagedInvocationToolOptions,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_JOIN_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocationId = readInvocationId(rawInput, MANAGED_AGENT_JOIN_TOOL_NAME);
  if (!invocationId.ok) {
    return invocationId.result;
  }
  const snapshot = service.status(invocationId.value);
  const visibility = visibleManagedInvocationSnapshot(snapshot, session.context.session.id, MANAGED_AGENT_JOIN_TOOL_NAME);
  if (!visibility.ok) {
    return visibility.result;
  }
  const startedAt = Date.now();
  let invocationResult: ManagedAgentRuntimeInvocationResult;
  try {
    invocationResult = await service.join(invocationId.value);
  } catch (error) {
    const failedSnapshot = service.status(invocationId.value);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const events = failedSnapshot
      ? appendManagedInvocationRuntimeFailureSessionEvent({
          session: session.context.session,
          request: failedSnapshot.request,
          decision: failedSnapshot.decision,
          errorMessage,
        })
      : [];
    await publishManagedInvocationSessionEvents(options, session.context, events);
    return errorResult(
      `Managed invocation join failed: ${errorMessage}`,
      {
        invocationId: invocationId.value,
        status: failedSnapshot?.lifecycleState ?? "failed",
        lifecycleState: failedSnapshot?.lifecycleState ?? "failed",
        ...(failedSnapshot ? { routeId: failedSnapshot.decision.capabilitySnapshot.routeId } : {}),
        ...(failedSnapshot ? { routeSource: failedSnapshot.decision.capabilitySnapshot.routeSource } : {}),
        ...(failedSnapshot ? { parentSessionId: failedSnapshot.parentSessionId, parentTurnId: failedSnapshot.parentTurnId } : {}),
        error: failedSnapshot?.error,
        sessionEventIds: failedSnapshot
          ? terminalSessionEventIdsForResult({ events, context: session.context, invocationId: invocationId.value })
          : [],
      },
      MANAGED_AGENT_JOIN_TOOL_NAME,
    );
  }
  if (invocationResult.status === "denied") {
    return errorResult(
      `Managed invocation denied: ${invocationResult.decision.reason}`,
      {
        invocationId: invocationId.value,
        routeId: invocationResult.decision.routeId,
        routeSource: invocationResult.decision.routeSource,
        status: "denied",
        lifecycleState: "failed",
        missingCapabilities: invocationResult.decision.missingCapabilities,
        ...(invocationResult.decision.resourceLease
          ? {
              resourceLease: projectManagedInvocationResourceLeaseResources(
                invocationResult.decision.resourceLease,
                projectManagedInvocationPublicResourceUri,
              ),
            }
          : {}),
      },
      MANAGED_AGENT_JOIN_TOOL_NAME,
    );
  }
  const routeId = invocationResult.record.capabilitySnapshot.routeId;
  const record = projectManagedInvocationRecordResources(invocationResult.record, { artifactStore: options.artifactStore });
  const terminalSnapshot = service.status(invocationId.value);
  const durationMs = terminalSnapshot?.durationMs ?? Date.now() - startedAt;
  const events = appendManagedInvocationTerminalSessionEvent({
    session: session.context.session,
    request: visibility.snapshot.request,
    record,
    durationMs,
  });
  await publishManagedInvocationSessionEvents(options, session.context, events);
  return terminalManagedInvocationResult({
    toolName: MANAGED_AGENT_JOIN_TOOL_NAME,
    rawInput,
    routeId,
    voiceProfile: visibility.snapshot.decision.capabilitySnapshot.childIdentity.voiceProfile,
    contextMode: visibility.snapshot.decision.capabilitySnapshot.contextMode,
    request: visibility.snapshot.request,
    record,
    progressEvents: terminalSnapshot?.progressEvents,
    sessionEventIds: terminalSessionEventIdsForResult({ events, context: session.context, invocationId: invocationId.value }),
  });
}

async function executeManagedInvocationCancelTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  options: ManagedInvocationToolOptions,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_CANCEL_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocationId = readInvocationId(rawInput, MANAGED_AGENT_CANCEL_TOOL_NAME);
  if (!invocationId.ok) {
    return invocationId.result;
  }
  const snapshot = service.status(invocationId.value);
  const visibility = visibleManagedInvocationSnapshot(snapshot, session.context.session.id, MANAGED_AGENT_CANCEL_TOOL_NAME);
  if (!visibility.ok) {
    return visibility.result;
  }
  const reason = readText(rawInput.reason) ?? "Managed invocation cancelled.";
  let terminalResult: Awaited<ReturnType<RuntimeManagedAgentInvocationService["join"]>>;
  try {
    await service.cancel(invocationId.value, reason);
    terminalResult = await service.join(invocationId.value);
  } catch (error) {
    const failedSnapshot = service.status(invocationId.value) ?? visibility.snapshot;
    return errorResult(
      `Managed invocation cancel failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        ...managedInvocationSnapshotErrorMetadata(failedSnapshot),
        status: failedSnapshot.lifecycleState,
        lifecycleState: failedSnapshot.lifecycleState,
      },
      MANAGED_AGENT_CANCEL_TOOL_NAME,
    );
  }
  if (terminalResult.status !== "completed") {
    return errorResult(
      "Managed invocation cancel failed: terminal record was not available after cancellation",
      {
        ...managedInvocationSnapshotErrorMetadata(visibility.snapshot),
        status: terminalResult.status,
        lifecycleState: visibility.snapshot.lifecycleState,
      },
      MANAGED_AGENT_CANCEL_TOOL_NAME,
    );
  }
  const record = projectManagedInvocationRecordResources(terminalResult.record, { artifactStore: options.artifactStore });
  const cancelledSnapshot = service.status(invocationId.value);
  const events = appendManagedInvocationTerminalSessionEvent({
    session: session.context.session,
    request: visibility.snapshot.request,
    record,
    durationMs: cancelledSnapshot?.durationMs,
  });
  await publishManagedInvocationSessionEvents(options, session.context, events);
  return terminalManagedInvocationResult({
    toolName: MANAGED_AGENT_CANCEL_TOOL_NAME,
    rawInput,
    routeId: record.capabilitySnapshot.routeId,
    voiceProfile: visibility.snapshot.decision.capabilitySnapshot.childIdentity.voiceProfile,
    contextMode: visibility.snapshot.decision.capabilitySnapshot.contextMode,
    request: visibility.snapshot.request,
    record,
    expectedTerminalLifecycleState: "cancelled",
    progressEvents: cancelledSnapshot?.progressEvents,
    sessionEventIds: terminalSessionEventIdsForResult({ events, context: session.context, invocationId: invocationId.value }),
  });
}

function requireManagedInvocationSessionContext(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  toolName: string,
): { readonly ok: true; readonly context: RuntimeBuiltinToolExecutionContext } | { readonly ok: false; readonly result: ManagedInvocationToolResult } {
  if (!context) {
    return { ok: false, result: errorResult(`${toolName} requires runtime session context.`, {}, toolName) };
  }
  return { ok: true, context };
}

function readInvocationId(
  rawInput: Record<string, unknown>,
  toolName: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly result: ManagedInvocationToolResult } {
  const invocationId = readText(rawInput.invocationId);
  if (!invocationId) {
    return { ok: false, result: errorResult(`${toolName} requires invocationId.`, {}, toolName) };
  }
  return { ok: true, value: invocationId };
}

function visibleManagedInvocationSnapshot(
  snapshot: ManagedAgentRuntimeInvocationSnapshot | undefined,
  sessionId: string,
  toolName: string,
): { readonly ok: true; readonly snapshot: ManagedAgentRuntimeInvocationSnapshot } | { readonly ok: false; readonly result: ManagedInvocationToolResult } {
  if (!snapshot || snapshot.parentSessionId !== sessionId) {
    return {
      ok: false,
      result: errorResult("Managed invocation is not registered for this runtime session.", {
        status: "not_found",
      }, toolName),
    };
  }
  return { ok: true, snapshot };
}

function managedInvocationSnapshotResult(
  toolName: string,
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
): ManagedInvocationToolResult {
  const projected = projectManagedInvocationSnapshot(snapshot);
  return {
    output: JSON.stringify(projected, null, 2),
    isError: false,
    metadata: {
      toolName,
      kind: "managed-invocation",
      status: projected.lifecycleState,
      lifecycleState: projected.lifecycleState,
      ...projected,
    },
  };
}

function projectManagedInvocationSnapshot(snapshot: ManagedAgentRuntimeInvocationSnapshot): Record<string, unknown> {
  const capabilitySnapshot = snapshot.decision.capabilitySnapshot;
  const authoritySnapshot = projectManagedInvocationAuthoritySnapshot(snapshot.request.authority);
  return {
    invocationId: snapshot.invocationId,
    agentId: snapshot.agentId,
    parentSessionId: snapshot.parentSessionId,
    parentTurnId: snapshot.parentTurnId,
    routeId: capabilitySnapshot.routeId,
    routeSource: capabilitySnapshot.routeSource,
    ...projectManagedInvocationTimeoutEvidence(capabilitySnapshot.authorityProfile),
    ...projectManagedInvocationChildLineage(snapshot.record),
    profile: snapshot.profile,
    providerRoute: snapshot.providerRoute,
    adapterKind: snapshot.adapterKind,
    executionMode: snapshot.executionMode,
    authorityProfileId: snapshot.authorityProfileId,
    authoritySnapshot,
    lifecycleState: snapshot.lifecycleState,
    startedAt: snapshot.startedAt,
    ...(snapshot.finishedAt ? { finishedAt: snapshot.finishedAt } : {}),
    ...(snapshot.durationMs !== undefined ? { durationMs: snapshot.durationMs } : {}),
    ...(snapshot.progressEvents && snapshot.progressEvents.length > 0
      ? {
          progressEventCount: snapshot.progressEvents.length,
          recentProgressEvents: projectManagedInvocationRecentProgressEvents(snapshot.progressEvents),
        }
      : {}),
    terminalEvidenceAvailable: snapshot.record !== undefined || snapshot.error !== undefined,
  };
}

function managedInvocationSnapshotErrorMetadata(
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
): Record<string, unknown> {
  const capabilitySnapshot = snapshot.decision.capabilitySnapshot;
  return {
    invocationId: snapshot.invocationId,
    agentId: snapshot.agentId,
    parentSessionId: snapshot.parentSessionId,
    parentTurnId: snapshot.parentTurnId,
    routeId: capabilitySnapshot.routeId,
    routeSource: capabilitySnapshot.routeSource,
    ...projectManagedInvocationTimeoutEvidence(capabilitySnapshot.authorityProfile),
    ...projectManagedInvocationChildLineage(snapshot.record),
    profile: snapshot.profile,
    providerRoute: snapshot.providerRoute,
    adapterKind: snapshot.adapterKind,
    executionMode: snapshot.executionMode,
    authorityProfileId: snapshot.authorityProfileId,
  };
}

function terminalManagedInvocationResult(input: {
  readonly toolName: string;
  readonly rawInput: Record<string, unknown>;
  readonly routeId: string;
  readonly voiceProfile?: string;
  readonly contextMode?: ManagedAgentInvocationContextMode;
  readonly request: ReturnType<typeof defineManagedAgentInvocationRequest>;
  readonly record: ManagedAgentInvocationRecord;
  readonly expectedTerminalLifecycleState?: ManagedAgentInvocationRecord["lifecycleState"];
  readonly progressEvents?: ManagedAgentRuntimeInvocationSnapshot["progressEvents"];
  readonly canonicalizedForbiddenInputFields?: readonly string[];
  readonly sessionEventIds: readonly string[];
}): ManagedInvocationToolResult {
  const summary = input.record.resultHandoff?.summary ?? `Managed invocation ${input.record.lifecycleState}.`;
  const acceptedTerminalLifecycleState = input.toolName === MANAGED_AGENT_JOIN_TOOL_NAME
    || input.record.lifecycleState === "completed"
    || input.record.lifecycleState === input.expectedTerminalLifecycleState;
  const terminalError = !acceptedTerminalLifecycleState;
  const recovery = terminalError
    ? buildManagedInvocationPhaseRecovery(
        input.rawInput,
        managedInvocationFailureReasonFromStatus(input.record.lifecycleState),
        input.record.resultHandoff,
      )
    : undefined;
  const shouldValidateSubstantiveHandoff = !terminalError && input.record.lifecycleState === "completed";
  const handoffRecovery = !shouldValidateSubstantiveHandoff
    ? undefined
    : buildManagedInvocationPhaseHandoffRecovery(input.rawInput, input.record.resultHandoff);
  const phaseCompletion = !shouldValidateSubstantiveHandoff
    ? undefined
    : buildManagedInvocationPhaseCompletion(input.rawInput, input.record.resultHandoff, input.record.invocationId);
  const handoffError = handoffRecovery !== undefined;
  const projectedStatus = handoffError ? "handoff_not_substantive" : input.record.lifecycleState;
  const resourceLease = input.record.resourceLease ?? input.record.capabilitySnapshot.resourceLease;
  const routeSource = input.record.capabilitySnapshot.routeSource;
  const timeoutEvidence = projectManagedInvocationTimeoutEvidence(input.record.capabilitySnapshot.authorityProfile);
  const authoritySnapshot = projectManagedInvocationAuthoritySnapshot(input.record.authority);
  const childLineage = projectManagedInvocationChildLineage(input.record);
  const progressEventCount = input.progressEvents?.length ?? 0;
  const recentProgressEvents = projectManagedInvocationRecentProgressEvents(input.progressEvents);
  const resourceLinks = projectManagedInvocationResultResourceLinks(input.record);
  const structuredEvidence = input.record.resultHandoff !== undefined
    || input.record.transcript !== undefined
    || resourceLease !== undefined
    || (input.record.diagnostics !== undefined && input.record.diagnostics.length > 0)
    || recentProgressEvents.length > 0;
  const outputVerbosity = input.request.input.handoff?.outputVerbosity ?? "standard";
  const projectedResultHandoff = input.record.resultHandoff
    ? {
        ...input.record.resultHandoff,
        ...(input.record.resultHandoff.structuredResult
          ? { structuredResult: projectStructuredExecutionResult(input.record.resultHandoff.structuredResult, outputVerbosity) }
          : {}),
      }
    : undefined;
  return {
    output: recovery || handoffRecovery || phaseCompletion || structuredEvidence
      ? JSON.stringify({
          status: projectedStatus,
          summary,
          invocationId: input.record.invocationId,
          routeId: input.routeId,
          routeSource,
          parentSessionId: input.record.parentSessionId,
          parentTurnId: input.record.parentTurnId,
          ...childLineage,
          ...timeoutEvidence,
          authoritySnapshot,
          ...(projectedResultHandoff ? { resultHandoff: projectedResultHandoff } : {}),
          ...(input.record.transcript ? { transcript: input.record.transcript } : {}),
          ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
          ...(resourceLease ? { resourceLease } : {}),
          ...(input.record.diagnostics ? { diagnostics: input.record.diagnostics } : {}),
          ...(recentProgressEvents.length > 0 ? { progressEventCount, recentProgressEvents } : {}),
          ...(recovery ? { recovery } : {}),
          ...(handoffRecovery ? { recovery: handoffRecovery } : {}),
          ...(phaseCompletion ? { phaseCompletion } : {}),
        }, null, 2)
      : summary,
    isError: terminalError || handoffError,
    metadata: {
      toolName: input.toolName,
      kind: "managed-invocation",
      invocationId: input.record.invocationId,
      routeId: input.routeId,
      routeSource,
      parentSessionId: input.record.parentSessionId,
      parentTurnId: input.record.parentTurnId,
      ...childLineage,
      ...timeoutEvidence,
      status: projectedStatus,
      lifecycleState: input.record.lifecycleState,
      profile: input.record.profile,
      providerRoute: input.record.providerRoute,
      ...(input.voiceProfile ? { voiceProfile: input.voiceProfile } : {}),
      adapterKind: input.record.adapterKind,
      executionMode: input.record.executionMode,
      requestedAuthority: input.request.requestedAuthority,
      authorityProfileId: input.record.authority.authorityProfileId,
      authoritySnapshot,
      capabilitySnapshot: input.record.capabilitySnapshot,
      context: input.request.input.context,
      ...(input.canonicalizedForbiddenInputFields
        ? { canonicalizedForbiddenInputFields: input.canonicalizedForbiddenInputFields }
        : {}),
      ...(input.request.input.handoff ? { handoffContract: input.request.input.handoff } : {}),
      resultHandoff: projectedResultHandoff,
      transcript: input.record.transcript,
      ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
      ...(recentProgressEvents.length > 0 ? { progressEventCount, recentProgressEvents } : {}),
      ...(resourceLease ? { resourceLease } : {}),
      ...(input.record.diagnostics ? { diagnostics: input.record.diagnostics } : {}),
      ...(recovery ? { managedInvocationRecovery: recovery } : {}),
      ...(handoffRecovery ? { managedInvocationRecovery: handoffRecovery } : {}),
      ...(phaseCompletion ? { managedInvocationPhaseCompletion: phaseCompletion } : {}),
      sessionEventIds: input.sessionEventIds,
      presentationIntent: buildManagedInvocationPresentationIntent({
        sourceToolName: input.toolName,
        routeId: input.routeId,
        routeSource,
        profile: input.record.profile,
        providerId: input.record.providerRoute.providerId,
        model: input.record.providerRoute.model,
        contextMode: input.contextMode,
        status: projectedStatus,
        substantiveEvidence: hasSubstantiveManagedInvocationEvidence(input.record) && !handoffError,
        failureReason: terminalError || handoffError ? summary : undefined,
      }),
    },
  };
}

function projectManagedInvocationResultResourceLinks(
  record: ManagedAgentInvocationRecord,
): readonly {
  readonly uri: string;
  readonly title?: string;
  readonly relation?: string;
}[] {
  const links = new Map<string, { readonly uri: string; readonly title?: string; readonly relation?: string }>();
  const addLink = (uri: string | undefined, title: string, relation: string) => {
    if (!uri || uri.trim().length === 0 || links.has(uri)) {
      return;
    }
    links.set(uri, { uri, title, relation });
  };
  addLink(record.transcript?.uri, "Managed invocation transcript", "events");
  for (const [index, uri] of (record.resultHandoff?.resourceUris ?? []).entries()) {
    addLink(uri, `Managed invocation result ${index + 1}`, "summary");
  }
  for (const [index, uri] of (record.resultHandoff?.memoryWriteProposalUris ?? []).entries()) {
    addLink(uri, `Managed invocation memory proposal ${index + 1}`, "source");
  }
  return [...links.values()];
}

function projectManagedInvocationTimeoutEvidence(authority: ManagedAgentAuthorityProfile): Record<string, unknown> {
  return {
    timeoutMs: authority.timeoutMs,
    ...(authority.timeoutSource ? { timeoutSource: authority.timeoutSource } : {}),
  };
}

function projectManagedInvocationAuthoritySnapshot(authority: ManagedAgentAuthorityProfile): ManagedAgentAuthorityProfile {
  return projectManagedInvocationAuthorityResources(authority, projectManagedInvocationPublicResourceUri);
}

function projectManagedInvocationChildLineage(record: ManagedAgentInvocationRecord | undefined): Record<string, unknown> {
  return {
    ...(record?.childSessionId ? { childSessionId: record.childSessionId } : {}),
    ...(record?.childTurnId ? { childTurnId: record.childTurnId } : {}),
  };
}

function buildManagedInvocationPresentationIntent(input: {
  readonly sourceToolName: string;
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly providerId: string;
  readonly model?: string;
  readonly contextMode?: ManagedAgentInvocationContextMode;
  readonly status: string;
  readonly substantiveEvidence: boolean;
  readonly failureReason?: string;
}): PresentationIntent {
  return {
    kind: "comparison_table",
    title: "Managed child invocation",
    summary: `${input.routeId} ${input.status}`,
    source: input.sourceToolName,
    confidence: input.substantiveEvidence ? "high" : "medium",
    columns: [
      { key: "routeId", label: "Route", valueKind: "text" },
      { key: "routeSource", label: "Source", valueKind: "text" },
      { key: "provider", label: "Provider", valueKind: "text" },
      { key: "model", label: "Model", valueKind: "text" },
      { key: "profile", label: "Profile", valueKind: "text" },
      { key: "contextMode", label: "Context", valueKind: "text" },
      { key: "status", label: "Status", valueKind: "status" },
      { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
      { key: "failureReason", label: "Failure", valueKind: "text" },
    ],
    rows: [{
      routeId: input.routeId,
      routeSource: input.routeSource,
      provider: input.providerId,
      model: input.model ?? "",
      profile: input.profile,
      contextMode: input.contextMode ?? "",
      status: input.status,
      substantiveEvidence: input.substantiveEvidence,
      failureReason: boundedPresentationText(input.failureReason ?? ""),
    }],
  };
}

const MANAGED_INVOCATION_RECENT_PROGRESS_LIMIT = 8;

function projectManagedInvocationRecentProgressEvents(
  progressEvents: ManagedAgentRuntimeInvocationSnapshot["progressEvents"] | undefined,
): readonly Record<string, unknown>[] {
  return (progressEvents ?? []).slice(-MANAGED_INVOCATION_RECENT_PROGRESS_LIMIT).map((event) => ({
    eventId: event.eventId,
    kind: event.kind,
    recordedAt: event.recordedAt,
    summary: boundedProgressText(event.summary),
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.success !== undefined ? { success: event.success } : {}),
    ...(event.isError !== undefined ? { isError: event.isError } : {}),
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
  }));
}

function boundedProgressText(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function boundedPresentationText(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function formatManagedInvocationAdmissionDenied(
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>,
): string {
  const suffix = decision.missingCapabilities.length > 0
    ? ` missingCapabilities=${decision.missingCapabilities.join(",")}`
    : "";
  return `${decision.reason}${suffix}`;
}

function hasSubstantiveManagedInvocationEvidence(record: ManagedAgentInvocationRecord): boolean {
  if (record.lifecycleState !== "completed") {
    return false;
  }
  const summary = record.resultHandoff?.summary.trim();
  if (!summary || isNonSubstantiveManagedInvocationSummary(summary)) {
    return false;
  }
  return (record.resultHandoff?.resourceUris.length ?? 0) > 0;
}

function isNonSubstantiveManagedInvocationSummary(summary: string): boolean {
  return summary === "Direct provider managed invocation completed."
    || summary.startsWith("Direct provider managed invocation finished without final handoff text.")
    || summary.includes(RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON)
    || summary.startsWith("Managed invocation state transition is still pending after the tool-round budget was exhausted.");
}

function missingManagedInvocationRequiredTools(
  requiredToolNames: readonly string[],
  allowedToolNames: readonly string[],
): readonly string[] {
  const allowed = new Set(allowedToolNames);
  return unique(requiredToolNames).filter((toolName) => !allowed.has(toolName));
}

function missingManagedInvocationRequiredCapabilities(
  requiredToolNames: readonly string[],
  profileDefaults: ManagedInvocationRouteProfile,
): readonly string[] {
  const missing: string[] = [];
  if (unique(requiredToolNames).some(requiresNetworkCapability) && profileDefaults.networkAllowed !== true) {
    missing.push("network");
  }
  if (requiredToolNames.includes("browser_observe") && !profileDefaults.allowedToolNames.includes("browser_observe")) {
    missing.push("browserObservation");
  }
  return missing;
}

function missingManagedInvocationRequiredReadPaths(
  requiredReadPaths: readonly string[],
  profileDefaults: ManagedInvocationRouteProfile,
): readonly string[] {
  return unique(requiredReadPaths)
    .filter((requiredPath) => !managedInvocationCanReadPath(requiredPath, profileDefaults));
}

function managedInvocationCanReadPath(
  requiredPath: string,
  profileDefaults: ManagedInvocationRouteProfile,
): boolean {
  const normalizedRequired = normalizeManagedInvocationReadPath(
    requiredPath,
    profileDefaults.workingDirectory.path,
  );
  if (!normalizedRequired) {
    return false;
  }
  const deniedPaths = profileDefaults.readAuthority?.workspace.deniedPaths ?? [];
  if (deniedPaths.some((deniedPath) => pathEqualsOrContains(normalizeManagedInvocationReadPath(deniedPath), normalizedRequired))) {
    return false;
  }
  return effectiveManagedInvocationReadRoots(profileDefaults)
    .some((allowedPath) => pathEqualsOrContains(normalizeManagedInvocationReadPath(allowedPath), normalizedRequired));
}

function effectiveManagedInvocationReadRoots(
  profileDefaults: ManagedInvocationRouteProfile,
): readonly string[] {
  return unique([
    profileDefaults.workingDirectory.path,
    ...(profileDefaults.readAuthority?.workspace.allowedPaths ?? []),
  ]);
}

function pathEqualsOrContains(rootPath: string | undefined, candidatePath: string): boolean {
  if (!rootPath) {
    return false;
  }
  return rootPath === candidatePath || candidatePath.startsWith(`${rootPath}/`);
}

function normalizeManagedInvocationReadPath(pathValue: string, relativeRoot?: string): string | undefined {
  const normalized = pathValue.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized.length === 0) {
    return undefined;
  }
  if (managedInvocationPathIsAbsolute(normalized) || !relativeRoot) {
    return posix.normalize(normalized);
  }
  const root = relativeRoot.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return root.length > 0
    ? posix.normalize(`${root}/${normalized}`)
    : posix.normalize(normalized);
}

function managedInvocationPathIsAbsolute(pathValue: string): boolean {
  return pathValue.startsWith("/") || /^[A-Za-z]:\//.test(pathValue);
}

function requiresNetworkCapability(toolName: string): boolean {
  return toolName.startsWith("web_") || toolName.startsWith("browser_");
}

function resolveRoute(
  routes: readonly ManagedInvocationToolRoute[],
  input: ManagedInvocationToolInput,
  agentProfile?: ManagedInvocationAgentCatalogEntry,
): {
  readonly status: "found";
  readonly route: ManagedInvocationToolRoute;
} | {
  readonly status: "missing";
} | {
  readonly status: "ambiguous";
  readonly reason: string;
} {
  const hintedRouteId = input.routeId ?? agentProfile?.routeId;
  const hintedModel = input.providerRoute.model
    ?? (agentProfile?.providerRoute?.providerId === input.providerRoute.providerId
      ? agentProfile.providerRoute.model
      : undefined);
  if (hintedRouteId) {
    const exactMatches = routes.filter((route) =>
      route.providerId === input.providerRoute.providerId
      && route.routeId === hintedRouteId
      && (!hintedModel || route.model === hintedModel)
    );
    if (exactMatches.length === 1) {
      return { status: "found", route: exactMatches[0]! };
    }
    if (exactMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: `Managed invocation route selection is ambiguous for route '${hintedRouteId}' and provider '${input.providerRoute.providerId}'. Matching routes: ${exactMatches.map((route) => route.routeId).join(", ")}.`,
      };
    }
  }
  const matches = routes.filter((route) =>
    route.providerId === input.providerRoute.providerId
    && (!hintedRouteId || route.routeId === hintedRouteId)
    && (!hintedModel || route.model === hintedModel)
    && route.profiles[input.profile] !== undefined
  );
  if (matches.length === 1) {
    return { status: "found", route: matches[0]! };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      reason: `Managed invocation route selection is ambiguous for provider '${input.providerRoute.providerId}' and profile '${input.profile}'. Specify routeId. Matching routes: ${matches.map((route) => route.routeId).join(", ")}.`,
    };
  }
  return { status: "missing" };
}

function validateAgentRouteHint(
  input: ManagedInvocationToolInput,
  agentProfile: ManagedInvocationAgentCatalogEntry | undefined,
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (!agentProfile) {
    return { ok: true };
  }
  const label = input.agentProfile ?? agentProfile.name;
  if (agentProfile.routeId && input.routeId && agentProfile.routeId !== input.routeId) {
    return {
      ok: false,
      error: `${toolName} routeId '${input.routeId}' contradicts configured agentProfile '${label}' route hint '${agentProfile.routeId}'.`,
    };
  }
  const hintedProvider = agentProfile.providerRoute?.providerId;
  if (hintedProvider && hintedProvider !== input.providerRoute.providerId) {
    return {
      ok: false,
      error: `${toolName} provider '${input.providerRoute.providerId}' contradicts configured agentProfile '${label}' provider hint '${hintedProvider}'.`,
    };
  }
  const hintedModel = agentProfile.providerRoute?.model;
  if (hintedModel && input.providerRoute.model && hintedModel !== input.providerRoute.model) {
    return {
      ok: false,
      error: `${toolName} model '${input.providerRoute.model}' contradicts configured agentProfile '${label}' model hint '${hintedModel}'.`,
    };
  }
  return { ok: true };
}

function buildRouteProfileConflictRecovery(
  input: ManagedInvocationToolInput,
  validation: { readonly ok: false; readonly error: string },
  context: RuntimeBuiltinToolExecutionContext,
  toolName: string,
): {
  readonly output: string;
  readonly metadata: Record<string, unknown>;
} {
  const forbiddenInputFields = unique([...(input.forbiddenInputFields ?? []), "agentProfile"]);
  const parentTurnId = resolveManagedInvocationParentTurnId(context);
  const invocationId = buildRouteProfileConflictInvocationId(context);
  const payload = {
    status: "route_profile_conflict",
    lifecycleState: "route_profile_conflict",
    error: validation.error,
    managedInvocationId: invocationId,
    invocationId,
    parentSessionId: context.session.id,
    parentTurnId,
    nextTool: toolName,
    retryInputTemplate: buildManagedInvocationRetryInputTemplate(input, forbiddenInputFields),
    forbiddenInputFields,
    correction: "Retry managed_agent.invoke with retryInputTemplate exactly; do not add agentProfile when a route-owned request forbids it.",
  };
  return {
    output: JSON.stringify(payload, null, 2),
    metadata: payload,
  };
}

function buildRouteProfileConflictInvocationId(context: RuntimeBuiltinToolExecutionContext): string {
  return `${sanitizeId(context.session.id)}:${sanitizeId(context.toolCall.id)}:route-profile-conflict`;
}

function buildManagedInvocationRetryInputTemplate(
  input: ManagedInvocationToolInput,
  forbiddenInputFields: readonly string[],
): Record<string, unknown> {
  return {
    profile: input.profile,
    ...(input.routeId ? { routeId: input.routeId } : {}),
    providerRoute: {
      providerId: input.providerRoute.providerId,
      ...(input.providerRoute.model ? { model: input.providerRoute.model } : {}),
      ...(input.providerRoute.reasoningEffort ? { reasoningEffort: input.providerRoute.reasoningEffort } : {}),
    },
    ...(input.requestedAuthority ? { requestedAuthority: input.requestedAuthority } : {}),
    task: input.task,
    summary: input.summary,
    ...(input.resourceUris ? { resourceUris: input.resourceUris } : {}),
    forbiddenInputFields,
    ...(input.skills ? { skills: input.skills } : {}),
    contextMode: input.contextMode,
    ...(input.goalRunId ? { goalRunId: input.goalRunId } : {}),
    ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.roleIntent ? { roleIntent: input.roleIntent } : {}),
    ...(input.expectedEvidence ? { expectedEvidence: input.expectedEvidence } : {}),
    ...(input.requiredToolNames ? { requiredToolNames: input.requiredToolNames } : {}),
    ...(input.requiredResultFields ? { requiredResultFields: input.requiredResultFields } : {}),
    ...(input.doneCriteria ? { doneCriteria: input.doneCriteria } : {}),
    ...(input.residualRiskRequired !== undefined ? { residualRiskRequired: input.residualRiskRequired } : {}),
    ...(input.executionPhase ? { executionPhase: input.executionPhase } : {}),
  };
}

function buildManagedRouteCatalogDescription(options: ManagedInvocationToolOptions): string {
  const healthy = options.routes.length > 0
    ? options.routes
        .map((route) => {
          const suitability = formatTaskSuitability(route.taskSuitability, managedInvocationSkillNames(options));
          const timeoutSummary = formatRouteTimeoutSummary(route.profiles);
          return `- ${route.routeId}: routeSource=${route.routeSource}, providerRoute.providerId=${route.providerId}${route.model ? `, model=${route.model}` : ""}, surface=${route.surface ?? route.adapter.descriptor.supportedExecutionModes[0] ?? "configured"}, profiles=${Object.keys(route.profiles).join(",")}${timeoutSummary ? `, ${timeoutSummary}` : ""}${suitability ? `, taskSuitability=${suitability}` : ""}`;
        })
        .join("\n")
    : "- none";
  const unavailable = options.unavailableRoutes && options.unavailableRoutes.length > 0
    ? options.unavailableRoutes
        .map((route) => `- ${route.routeId}: routeSource=${route.routeSource}, providerRoute.providerId=${route.providerId}${route.model ? `, model=${route.model}` : ""}, profiles=${route.profiles.join(",")}, reason=${route.reason}`)
        .join("\n")
    : "- none";
  return [
    "Configured healthy managed invocation routes:",
    healthy,
    "Configured unavailable managed invocation routes:",
    unavailable,
  ].join("\n");
}

function formatRouteTimeoutSummary(
  profiles: ManagedInvocationToolRoute["profiles"],
): string | undefined {
  const entries = Object.entries(profiles)
    .map(([profile, value]) => ({
      profile,
      timeoutMs: value?.timeoutMs,
      ...(value?.timeoutSource ? { timeoutSource: value.timeoutSource } : {}),
    }))
    .filter((entry): entry is {
      readonly profile: string;
      readonly timeoutMs: number;
      readonly timeoutSource?: ManagedAgentAuthorityProfile["timeoutSource"];
    } =>
      typeof entry.timeoutMs === "number" && Number.isFinite(entry.timeoutMs)
    );
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1) {
    return formatRouteTimeoutEntry(entries[0]!);
  }
  return `timeouts=${entries.map((entry) => `${entry.profile}:${formatRouteTimeoutEntry(entry)}`).join("|")}`;
}

function formatRouteTimeoutEntry(entry: {
  readonly timeoutMs: number;
  readonly timeoutSource?: ManagedAgentAuthorityProfile["timeoutSource"];
}): string {
  return entry.timeoutSource
    ? `timeoutMs=${entry.timeoutMs} source=${entry.timeoutSource}`
    : `timeoutMs=${entry.timeoutMs}`;
}


function managedInvocationRouteHealthReason(profile: ManagedInvocationRouteProfile, routeSource: ManagedAgentRouteSource): string {
  return profile.timeoutSource
    ? `Configured managed invocation route selected by runtime tool; routeSource=${routeSource}; effective timeoutMs=${profile.timeoutMs} source=${profile.timeoutSource}.`
    : `Configured managed invocation route selected by runtime tool; routeSource=${routeSource}; effective timeoutMs=${profile.timeoutMs}.`;
}

function formatTaskSuitability(
  suitability: readonly ModelTaskSuitability[] | undefined,
  configuredSkills: readonly string[],
): string | undefined {
  if (!suitability || suitability.length === 0) {
    return undefined;
  }
  const configuredSkillSet = new Set(configuredSkills);
  return suitability
    .map((entry) => {
      const evidence = entry.evidence && entry.evidence.length > 0
        ? `:evidence=${unique(entry.evidence.map((item) => item.source)).join("+")}`
        : "";
      const recommendedSkills = (entry.recommendedSkills ?? []).filter((skill) => configuredSkillSet.has(skill));
      const skills = recommendedSkills.length > 0 ? `:skills=${recommendedSkills.join("+")}` : "";
      return `${entry.task}:${entry.level}:${entry.source}${evidence}${skills}`;
    })
    .join(";");
}

function buildManagedAgentSelectionDescription(options: ManagedInvocationToolOptions): string {
  const catalog = options.agentCatalog ?? [];
  const agents = catalog.length > 0
    ? catalog.map((agent) => {
        const aliases = [
          ...(agent.displayName ? [agent.displayName] : []),
          ...(agent.nicknameCandidates ?? []),
        ];
        const routeHint = agent.routeId
          ? `, routeId=${agent.routeId}`
          : agent.providerRoute
            ? `, providerRoute.providerId=${agent.providerRoute.providerId}${agent.providerRoute.model ? `, model=${agent.providerRoute.model}` : ""}`
            : "";
        const skills = agent.skills && agent.skills.length > 0 ? `, skills=${agent.skills.join(",")}` : "";
        return `- ${agent.name}${aliases.length > 0 ? ` (${aliases.join("/")})` : ""}: role=${agent.role}, goal=${agent.goal}, tier=${agent.tier}${skills}${routeHint}`;
      }).join("\n")
    : "- none";
  return [
    "Configured admitted agent profiles:",
    agents,
    `Configured admitted skills: ${formatBoundedList(managedInvocationSkillNames(options), 24)}`,
    buildManagedSkillCatalogDescription(options),
    buildManagedTaskAffinityDescription(options),
    "Selection policy:",
    "- Use scout/context profiles before broad or ambiguous implementation.",
    "- Follow routeId/providerRoute hints shown on the selected agent profile.",
    "- Use tdd/test profiles before behavior-changing work.",
    "- Use coding profiles for bounded implementation subtasks.",
    "- Use reviewer/validator profiles for quality gates, architecture checks, and risk review.",
    "- Use researcher profiles for external or evidence-dependent questions.",
    "- Omit agentProfile for one-off generic read-only child tasks that do not match a configured profile.",
  ].join("\n");
}

function buildManagedSkillCatalogDescription(options: ManagedInvocationToolOptions): string {
  const skillCatalog = options.skillCatalog ?? [];
  if (skillCatalog.length === 0) {
    return "Configured skill catalog: none";
  }
  const configured = skillCatalog.filter((skill) =>
    skill.configured !== false && skill.admission?.state !== "unavailable"
  );
  const diagnostics = skillCatalog.filter((skill) =>
    skill.configured === false || skill.admission?.state === "unavailable"
  );
  const rows = configured.slice(0, 24).map((skill) => {
    const tags = skill.tags && skill.tags.length > 0 ? `, tags=${skill.tags.join(",")}` : "";
    const origin = skill.origin ? `, origin=${skill.origin}` : "";
    const admission = skill.admission ? `, admission=${skill.admission.state}` : "";
    const projection = skill.projections && skill.projections.length > 0
      ? `, projections=${skill.projections.map((entry) => `${entry.target}:${entry.status}`).join(",")}`
      : "";
    const omitted = skill.omissionReason ? `, omission=${skill.omissionReason}` : "";
    return `- ${skill.name}: ${skill.description}${origin}${admission}${projection}${omitted}${tags}`;
  });
  const omittedConfigured = configured.length - rows.length;
  if (omittedConfigured > 0) {
    rows.push(`- ${omittedConfigured} additional configured skill(s) omitted from this bounded catalog summary.`);
  }
  if (diagnostics.length > 0) {
    const byReason = new Map<string, number>();
    for (const skill of diagnostics) {
      const reason = skill.omissionReason ?? skill.admission?.state ?? "diagnostic";
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    rows.push(
      `- Diagnostic-only native skill entries: ${diagnostics.length} (${[...byReason.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ")}).`,
    );
  }
  return ["Configured skill catalog summary:", ...rows].join("\n");
}

function buildManagedTaskAffinityDescription(options: ManagedInvocationToolOptions): string {
  const routeRows = managedRouteTaskAffinityRows(options.routes);
  const agentRows = managedAgentTaskAffinityRows(options.agentCatalog ?? []);
  return [
    "Task-affinity hints:",
    routeRows.length > 0 ? `Routes: ${routeRows.join("; ")}` : "Routes: no task suitability evidence",
    agentRows.length > 0 ? `Agent profiles: ${agentRows.join("; ")}` : "Agent profiles: no configured agent profiles",
    "Skills: request a skill only when its name appears in the configured Kiln skill catalog or on the selected agent profile. Harness-local native skills marked unmanaged-native are diagnostics only and are not admissible.",
  ].join("\n");
}

function managedInvocationAgentProfileNames(options: ManagedInvocationToolOptions): readonly string[] {
  return unique((options.agentCatalog ?? []).flatMap((agent) => [
    agent.name,
    ...(agent.displayName ? [agent.displayName] : []),
    ...(agent.nicknameCandidates ?? []),
  ]));
}

function managedInvocationSkillNames(options: ManagedInvocationToolOptions): readonly string[] {
  return unique([
    ...(options.skillCatalog ?? [])
      .filter((skill) => skill.configured !== false && skill.admission?.state !== "unavailable")
      .map((skill) => skill.name),
    ...(options.agentCatalog ?? []).flatMap((agent) => agent.skills ?? []),
  ]);
}

function managedRouteTaskAffinityRows(routes: readonly ManagedInvocationToolRoute[]): readonly string[] {
  return routes.flatMap((route) => {
    const suitability = route.taskSuitability ?? [];
    const preferredOrCapable = suitability.filter((entry) => entry.level === "preferred" || entry.level === "capable");
    if (preferredOrCapable.length === 0) {
      return [];
    }
    return [`${route.routeId} -> ${preferredOrCapable.map((entry) => `${entry.task}:${entry.level}`).join(",")}`];
  });
}

function managedAgentTaskAffinityRows(agents: readonly ManagedInvocationAgentCatalogEntry[]): readonly string[] {
  return agents.flatMap((agent) => {
    const tasks = agent.taskAffinity ?? [];
    return tasks.length > 0 ? [`${agent.name} -> ${tasks.join(",")}`] : [];
  });
}

function managedAgentDisplayName(
  options: ManagedInvocationToolOptions,
  profile: string | undefined,
): string | undefined {
  if (!profile) {
    return undefined;
  }
  const entry = (options.agentCatalog ?? []).find((agent) =>
    agent.name === profile
    || agent.displayName === profile
    || (agent.nicknameCandidates ?? []).includes(profile)
  );
  return entry?.displayName ?? entry?.name;
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function formatBoundedList(values: readonly string[], limit: number): string {
  if (values.length === 0) {
    return "none";
  }
  const visible = values.slice(0, limit).join(", ");
  const omitted = values.length - limit;
  return omitted > 0 ? `${visible}, ... (${omitted} more)` : visible;
}

function cloneToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function readSchemaProperties(value: unknown): Record<string, unknown> {
  const record = readRecord(value);
  const properties = readRecord(record?.properties);
  return properties ?? {};
}

function readSchemaProperty(value: unknown): Record<string, unknown> | undefined {
  return readRecord(value);
}

function resolveUnavailableRoute(
  routes: readonly ManagedInvocationUnavailableRoute[],
  input: ManagedInvocationToolInput,
): ManagedInvocationUnavailableRoute | undefined {
  return routes.find((route) =>
    route.providerId === input.providerRoute.providerId
    && (!input.routeId || route.routeId === input.routeId)
    && (!input.providerRoute.model || route.model === input.providerRoute.model)
    && route.profiles.includes(input.profile)
  );
}

function parseInput(
  input: Record<string, unknown>,
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): { readonly ok: true; readonly input: ManagedInvocationToolInput } | { readonly ok: false; readonly error: string } {
  const profile = input.profile === undefined ? "foundation-readonly-plan" : input.profile;
  if (
    profile !== "foundation-readonly-plan"
    && profile !== "foundation-propose-writes"
    && profile !== "foundation-apply-approved-writes"
    && profile !== "foundation-memory-write-proposals"
  ) {
    return { ok: false, error: `${toolName} profile is not supported.` };
  }
  const providerRoute = readRecord(input.providerRoute);
  const providerId = readText(providerRoute?.providerId);
  if (!providerId) {
    return { ok: false, error: `${toolName} requires providerRoute.providerId.` };
  }
  const task = readText(input.task);
  if (!task) {
    return { ok: false, error: `${toolName} requires task.` };
  }
  const resourceUris = Array.isArray(input.resourceUris)
    ? input.resourceUris.map(readText).filter((uri): uri is string => uri !== undefined)
    : undefined;
  const skills = Array.isArray(input.skills)
    ? unique(input.skills.map(readText).filter((skill): skill is string => skill !== undefined))
    : undefined;
  const expectedEvidence = readTextArray(input.expectedEvidence);
  const requiredToolNames = readTextArray(input.requiredToolNames);
  const requiredReadPaths = readTextArray(input.requiredReadPaths);
  const requiredResultFields = parseManagedResultFields(input.requiredResultFields);
  if (!requiredResultFields.ok) {
    return { ok: false, error: `${toolName} ${requiredResultFields.error}` };
  }
  const doneCriteria = readTextArray(input.doneCriteria);
  const outputVerbosity = parseAssistantOutputVerbosity(input.outputVerbosity);
  if (input.outputVerbosity !== undefined && !outputVerbosity) {
    return { ok: false, error: `${toolName} outputVerbosity is not supported.` };
  }
  const forbiddenInputFields = readTextArray(input.forbiddenInputFields);
  const workClassification = parseWorkClassification(input.workClassification, toolName);
  if (!workClassification.ok) {
    return { ok: false, error: workClassification.error };
  }
  const requestedAuthority = parseManagedInvocationRequestedAuthority(input.requestedAuthority);
  if (!requestedAuthority.ok) {
    return { ok: false, error: `${toolName} requestedAuthority is not supported.` };
  }
  const contextMode = parseContextMode(input.contextMode);
  if (!contextMode) {
    return { ok: false, error: `${toolName} contextMode is not supported.` };
  }
  if (contextMode === "resources" && (!resourceUris || resourceUris.length === 0)) {
    return { ok: false, error: `${toolName} contextMode resources requires at least one resourceUris entry. Use contextMode isolated when no governed resources are supplied.` };
  }
  const goalRunId = readText(input.goalRunId);
  const workItemId = readText(input.workItemId);
  const attemptId = readText(input.attemptId);
  if ((workItemId || attemptId) && !goalRunId) {
    return { ok: false, error: `${toolName} goalRunId is required when workItemId or attemptId is supplied.` };
  }
  if (attemptId && !workItemId) {
    return { ok: false, error: `${toolName} workItemId is required when attemptId is supplied.` };
  }
  return {
    ok: true,
    input: {
      profile,
      routeId: readText(input.routeId),
      providerRoute: {
        providerId,
        surface: "configured",
        ...(readText(providerRoute?.model) ? { model: readText(providerRoute?.model) } : {}),
        ...(readText(providerRoute?.reasoningEffort) ? { reasoningEffort: readText(providerRoute?.reasoningEffort) } : {}),
      },
      ...(requestedAuthority.value ? { requestedAuthority: requestedAuthority.value } : {}),
      task,
      summary: readText(input.summary) ?? task,
      ...(resourceUris && resourceUris.length > 0 ? { resourceUris } : {}),
      ...(readText(input.agentProfile) ? { agentProfile: readText(input.agentProfile) } : {}),
      ...(forbiddenInputFields && forbiddenInputFields.length > 0 ? { forbiddenInputFields } : {}),
      ...(skills && skills.length > 0 ? { skills } : {}),
      ...(workClassification.value ? { workClassification: workClassification.value } : {}),
      contextMode,
      ...(goalRunId ? { goalRunId } : {}),
      ...(workItemId ? { workItemId } : {}),
      ...(attemptId ? { attemptId } : {}),
      ...(readText(input.roleIntent) ? { roleIntent: readText(input.roleIntent) } : {}),
      ...(expectedEvidence && expectedEvidence.length > 0 ? { expectedEvidence } : {}),
      ...(requiredToolNames && requiredToolNames.length > 0 ? { requiredToolNames } : {}),
      ...(requiredReadPaths && requiredReadPaths.length > 0 ? { requiredReadPaths } : {}),
      ...(requiredResultFields.value && requiredResultFields.value.length > 0
        ? { requiredResultFields: requiredResultFields.value }
        : {}),
      ...(doneCriteria && doneCriteria.length > 0 ? { doneCriteria } : {}),
      ...(typeof input.residualRiskRequired === "boolean" ? { residualRiskRequired: input.residualRiskRequired } : {}),
      ...(outputVerbosity ? { outputVerbosity } : {}),
      ...(readRecord(input.executionPhase) ? { executionPhase: readRecord(input.executionPhase)! } : {}),
    },
  };
}

async function resolveInvocationContext(
  input: ManagedInvocationToolInput,
  options: ManagedInvocationToolOptions,
  route: ManagedInvocationToolRoute | undefined,
): Promise<
  | { readonly ok: true; readonly resolution: ManagedInvocationContextResolution }
  | {
    readonly ok: false;
    readonly error: string;
    readonly status: "denied" | "failed";
    readonly resolution?: ManagedInvocationContextResolution;
  }
> {
  const needsResolver = Boolean(options.contextResolver || input.agentProfile || input.skills?.length || input.workClassification || input.contextMode === "fork");
  if (!needsResolver) {
    return { ok: true, resolution: {} };
  }
  if (!options.contextResolver) {
    return {
      ok: false,
      error: "Managed invocation context resolver is not configured for requested agentProfile, skills, workClassification, or fork context.",
      status: "failed",
    };
  }
  try {
    const resolution = await options.contextResolver({
      agentProfile: input.agentProfile,
      skills: input.skills ?? [],
      contextMode: input.contextMode,
      task: input.task,
      providerRoute: {
        providerId: route?.providerId ?? input.providerRoute.providerId,
        ...(input.providerRoute.model ?? route?.model ? { model: input.providerRoute.model ?? route?.model } : {}),
      },
      ...(route?.taskSuitability ? { taskSuitability: route.taskSuitability } : {}),
      ...(input.workClassification ? { workClassification: input.workClassification } : {}),
    });
    if (resolution.deniedSkills && resolution.deniedSkills.length > 0) {
      return {
        ok: false,
        error: `Managed invocation denied skill(s): ${resolution.deniedSkills.join(", ")}`,
        status: "denied",
        resolution,
      };
    }
    return { ok: true, resolution };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    };
  }
}

function buildManagedInvocationContextMetadata(
  input: ManagedInvocationToolInput,
  resolution: ManagedInvocationContextResolution | undefined,
): ManagedAgentInvocationContextSelection {
  return {
    mode: input.contextMode,
    ...(input.agentProfile ? { agentProfile: input.agentProfile } : {}),
    ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
    ...(input.workClassification ? { workClassification: input.workClassification } : {}),
    ...(resolution?.admittedAgentProfile ? { admittedAgentProfile: resolution.admittedAgentProfile } : {}),
    ...(resolution?.admittedSkills ? { admittedSkills: resolution.admittedSkills } : {}),
    ...(resolution?.admittedInstructionProfiles ? { admittedInstructionProfiles: resolution.admittedInstructionProfiles } : {}),
    ...(resolution?.deniedSkills ? { deniedSkills: resolution.deniedSkills } : {}),
    ...(resolution?.workClassification ? { resolvedWorkClassification: resolution.workClassification } : {}),
    ...(resolution?.workRecommendedSkills ? { workRecommendedSkills: resolution.workRecommendedSkills } : {}),
    ...(resolution?.workRecommendedSkillDiagnostics ? { workRecommendedSkillDiagnostics: resolution.workRecommendedSkillDiagnostics } : {}),
  };
}

function parseContextMode(input: unknown): ManagedAgentInvocationContextMode | undefined {
  if (input === undefined) {
    return "isolated";
  }
  if (input === "isolated" || input === "resources" || input === "fork") {
    return input;
  }
  return undefined;
}

function parseWorkClassification(
  input: unknown,
  toolName: string,
): { readonly ok: true; readonly value?: WorkClassification } | { readonly ok: false; readonly error: string } {
  if (input === undefined) {
    return { ok: true };
  }
  const record = readRecord(input);
  if (!record) {
    return { ok: false, error: `${toolName} workClassification must be an object.` };
  }
  const supportedFields = new Set(["intents", "artifacts", "domains", "effects", "modes"]);
  const unsupportedField = Object.keys(record).find((field) => !supportedFields.has(field));
  if (unsupportedField) {
    return { ok: false, error: `${toolName} Unsupported work classification field: ${unsupportedField}.` };
  }
  const intents = parseWorkClassificationFacet(record, "intents", toolName);
  if (!intents.ok) return intents;
  const artifacts = parseWorkClassificationFacet(record, "artifacts", toolName);
  if (!artifacts.ok) return artifacts;
  const domains = parseWorkClassificationFacet(record, "domains", toolName);
  if (!domains.ok) return domains;
  const effects = parseWorkClassificationFacet(record, "effects", toolName);
  if (!effects.ok) return effects;
  const modes = parseWorkClassificationFacet(record, "modes", toolName);
  if (!modes.ok) return modes;
  const classificationInput: WorkClassificationInput = {
    ...(intents.value ? { intents: intents.value } : {}),
    ...(artifacts.value ? { artifacts: artifacts.value } : {}),
    ...(domains.value ? { domains: domains.value } : {}),
    ...(effects.value ? { effects: effects.value } : {}),
    ...(modes.value ? { modes: modes.value } : {}),
  };
  try {
    const value = defineWorkClassification(classificationInput);
    return Object.keys(value).length > 0 ? { ok: true, value } : { ok: true };
  } catch (error) {
    return { ok: false, error: `${toolName} ${error instanceof Error ? error.message : String(error)}.` };
  }
}

function parseWorkClassificationFacet(
  record: Record<string, unknown>,
  field: "intents" | "artifacts" | "domains" | "effects" | "modes",
  toolName: string,
): { readonly ok: true; readonly value?: readonly string[] } | { readonly ok: false; readonly error: string } {
  if (!(field in record)) {
    return { ok: true };
  }
  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { ok: false, error: `${toolName} workClassification.${field} must be an array of strings.` };
  }
  return { ok: true, value };
}

function parseManagedInvocationRequestedAuthority(
  input: unknown,
): { readonly ok: true; readonly value?: ManagedAgentRequestedAuthority } | { readonly ok: false } {
  if (input === undefined) {
    return { ok: true };
  }
  if (input === "auto" || input === "read_only" || input === "audited" || input === "destructive") {
    return { ok: true, value: input };
  }
  return { ok: false };
}

function resolveManagedInvocationRequestedAuthority(
  input?: ManagedAgentRequestedAuthority,
  parentRequestedAuthority?: "planning" | "auto" | "read_only" | "audited" | "destructive",
): ManagedAgentRequestedAuthority {
  const requested = input ?? "auto";
  const inherited = normalizeParentRequestedAuthority(parentRequestedAuthority);
  if (!inherited || inherited === "auto") {
    return requested;
  }
  if (requested === "auto") {
    return inherited;
  }
  return managedAuthorityRank(requested) <= managedAuthorityRank(inherited)
    ? requested
    : inherited;
}

function normalizeParentRequestedAuthority(
  parentRequestedAuthority?: "planning" | "auto" | "read_only" | "audited" | "destructive",
): ManagedAgentRequestedAuthority | undefined {
  if (parentRequestedAuthority === "planning") {
    return "read_only";
  }
  return parentRequestedAuthority;
}

function managedAuthorityRank(authority: ManagedAgentRequestedAuthority): number {
  switch (authority) {
    case "read_only":
      return 1;
    case "audited":
      return 2;
    case "auto":
      return 3;
    case "destructive":
      return 4;
  }
}

function validateManagedInvocationRequestedAuthority(
  requestedAuthority: ManagedAgentRequestedAuthority,
  profile: ManagedAgentAdmissionProfile,
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (requestedAuthority === "read_only" && profile !== "foundation-readonly-plan") {
    return {
      ok: false,
      error: `${toolName} read_only requested authority cannot select managed profile '${profile}'.`,
    };
  }
  if (
    profile === "foundation-readonly-plan"
    && (requestedAuthority === "audited" || requestedAuthority === "destructive")
  ) {
    return {
      ok: false,
      error: `${toolName} ${requestedAuthority} requested authority cannot select read-only managed profile '${profile}'.`,
    };
  }
  return { ok: true };
}

async function requestManagedInvocationAuthorityApproval(input: {
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly routeId: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly toolName?: string;
}): Promise<
  | { readonly ok: true; readonly authorityApproval?: ManagedAgentAuthorityApproval }
  | { readonly ok: false; readonly error: string }
> {
  const toolName = input.toolName ?? MANAGED_AGENT_INVOKE_TOOL_NAME;
  if (input.requestedAuthority !== "destructive") {
    return { ok: true };
  }
  if (!input.context.requestApproval) {
    return {
      ok: false,
      error: `${toolName} destructive requested authority requires an approval flow before child invocation.`,
    };
  }

  const description = `${toolName} requests destructive authority for route '${input.routeId}' and profile '${input.profile}'.`;
  const approval = await input.context.requestApproval(description);
  if (!approval.approved) {
    return {
      ok: false,
      error: `${toolName} destructive requested authority denied: ${approval.reason ?? "approval denied"}`,
    };
  }
  return {
    ok: true,
    authorityApproval: {
      approved: true,
      ...(approval.reason ? { reason: approval.reason } : {}),
    },
  };
}

function buildHandoffContract(input: ManagedInvocationToolInput): ManagedAgentInvocationHandoffContract | undefined {
  const contract: ManagedAgentInvocationHandoffContract = {
    ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    ...(input.roleIntent ? { roleIntent: input.roleIntent } : {}),
    ...(input.expectedEvidence && input.expectedEvidence.length > 0 ? { expectedEvidence: input.expectedEvidence } : {}),
    ...(input.requiredResultFields && input.requiredResultFields.length > 0 ? { requiredResultFields: input.requiredResultFields } : {}),
    ...(input.doneCriteria && input.doneCriteria.length > 0 ? { doneCriteria: input.doneCriteria } : {}),
    ...(input.residualRiskRequired !== undefined ? { residualRiskRequired: input.residualRiskRequired } : {}),
    ...(input.outputVerbosity !== undefined ? { outputVerbosity: input.outputVerbosity } : {}),
  };
  return Object.keys(contract).length > 0 ? contract : undefined;
}

function errorResult(
  output: string,
  metadata: Record<string, unknown> = {},
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): ManagedInvocationToolResult {
  return {
    output,
    isError: true,
    metadata: {
      toolName,
      kind: "managed-invocation",
      status: "failed",
      ...metadata,
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAssistantOutputVerbosity(value: unknown): "concise" | "standard" | "detailed" | undefined {
  return value === "concise" || value === "standard" || value === "detailed" ? value : undefined;
}

function readTextArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = unique(value.map(readText).filter((item): item is string => item !== undefined));
  return values.length > 0 ? values : undefined;
}

const MANAGED_RESULT_FIELDS = new Set<ManagedAgentResultField>([
  "summary",
  "resourceUris",
  "evidence",
  "verificationResults",
  "uncertainty",
  "limitations",
  "warnings",
  "approvalRequirements",
  "residualRisks",
]);

function parseManagedResultFields(value: unknown):
  | { readonly ok: true; readonly value?: readonly ManagedAgentResultField[] }
  | { readonly ok: false; readonly error: string } {
  const fields = readTextArray(value);
  if (!fields) return { ok: true };
  const unsupported = fields.filter((field) => !MANAGED_RESULT_FIELDS.has(field as ManagedAgentResultField));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `requiredResultFields contains unsupported canonical fields: ${unsupported.join(", ")}.`,
    };
  }
  return {
    ok: true,
    value: fields as readonly ManagedAgentResultField[],
  };
}

function resolveManagedInvocationParentTurnId(context: RuntimeBuiltinToolExecutionContext): string {
  return context.turnId ?? `${context.session.id}:turn:${Math.max(context.session.userTurnCount, 1)}`;
}

function resolveManagedInvocationParentTurnOrdinal(parentTurnId: string, fallbackTurnCount: number): number {
  const match = parentTurnId.match(/:turn:(\d+)$/u);
  if (!match) {
    return Math.max(fallbackTurnCount, 1);
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : Math.max(fallbackTurnCount, 1);
}

function buildInvocationId(sessionId: string, turnCount: number, toolCallId: string): string {
  return `managed-${sanitizeId(sessionId)}-${Math.max(turnCount, 1)}-${sanitizeId(toolCallId)}`;
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized.slice(0, 96) : "invocation";
}
