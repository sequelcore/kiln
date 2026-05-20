import type {
  ArtifactResourceStore,
  Capability,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityApproval,
  ManagedAgentAuthorityProfile,
  ManagedAgentCredentialRoute,
  ManagedAgentMemoryScope,
  ManagedAgentInvocationContextMode,
  ManagedAgentInvocationHandoffContract,
  ManagedAgentInvocationRecord,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
  ManagedAgentWorkingDirectory,
  ModelTaskSuitability,
  ModelTaskSuitabilityTask,
  CanonicalSessionEvent,
  ToolDefinition,
} from "@kilnai/core";
import { defineManagedAgentInvocationRequest } from "@kilnai/core";
import type { PresentationIntent } from "@kilnai/gateway-contracts";
import type {
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
} from "../../session/runtime-session-orchestrator.types.js";
import { RuntimeManagedAgentInvocationService } from "./index.js";
import type { ManagedAgentRuntimeAdapter } from "./index.js";
import { appendManagedInvocationSessionEvents } from "./session-events.js";
import {
  buildManagedInvocationPhaseCompletion,
  buildManagedInvocationPhaseRecovery,
} from "./phase-recovery.js";

export const MANAGED_AGENT_INVOKE_TOOL_NAME = "managed_agent.invoke";

export interface ManagedInvocationRouteProfile {
  readonly authorityProfileId: string;
  readonly permissionProfile: string;
  readonly allowedToolNames: readonly string[];
  readonly writeAllowed?: boolean;
  readonly networkAllowed?: boolean;
  readonly workingDirectory: ManagedAgentWorkingDirectory;
  readonly timeoutMs: number;
  readonly credentialRoute: ManagedAgentCredentialRoute;
  readonly memoryScope: ManagedAgentMemoryScope;
  readonly writeAuthority?: ManagedAgentAuthorityProfile["writeAuthority"];
}

export interface ManagedInvocationToolRoute {
  readonly routeId: string;
  readonly providerId: string;
  readonly model?: string;
  readonly voiceProfile?: string;
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly surface?: string;
  readonly taskSuitability?: readonly ModelTaskSuitability[];
  readonly profiles: Partial<Record<ManagedAgentAdmissionProfile, ManagedInvocationRouteProfile>>;
}

export interface ManagedInvocationUnavailableRoute {
  readonly routeId: string;
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
  readonly sessionEventSink?: ManagedInvocationSessionEventSink;
  readonly contextResolver?: ManagedInvocationContextResolver;
}

export interface ManagedInvocationAgentCatalogEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly nicknameCandidates?: readonly string[];
  readonly role: string;
  readonly goal: string;
  readonly tier: string;
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

export interface ManagedInvocationSkillCatalogEntry {
  readonly name: string;
  readonly description: string;
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
}

export interface ManagedInvocationContextResolution {
  readonly promptPrefix?: string;
  readonly admittedAgentProfile?: string;
  readonly admittedSkills?: readonly string[];
  readonly admittedInstructionProfiles?: readonly string[];
  readonly deniedSkills?: readonly string[];
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
  readonly skills?: readonly string[];
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly workItemId?: string;
  readonly roleIntent?: string;
  readonly expectedEvidence?: readonly string[];
  readonly requiredToolNames?: readonly string[];
  readonly requiredResultFields?: readonly string[];
  readonly doneCriteria?: readonly string[];
  readonly residualRiskRequired?: boolean;
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
      skills: {
        type: "array",
        items: { type: "string" },
        description: "Optional configured Kiln skills to request for the child. Only request skills from the configured agent profile or an explicitly known Kiln skill catalog; do not invent skill names.",
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
      requiredResultFields: {
        type: "array",
        items: { type: "string" },
        description: "Optional child result fields expected in the handoff, such as summary, evidence, checks, files, or residualRisk.",
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
          requiredToolNames: {
            type: "array",
            items: { type: "string" },
            description: "Tool names required for this child phase.",
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

export const MANAGED_AGENT_INVOKE_CAPABILITY: Capability = {
  name: MANAGED_AGENT_INVOKE_TOOL.name,
  description: MANAGED_AGENT_INVOKE_TOOL.description,
  schema: MANAGED_AGENT_INVOKE_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-approval"],
  annotations: { destructive: true },
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
      "Use routeId when the user asks for a specific route or when more than one route shares a provider and no selected agentProfile route hint applies. Omit providerRoute.model unless the user explicitly selected an exact configured model.",
    ].join("\n"),
    inputSchema: schema,
  };
}

export function createManagedInvocationToolExecutor(
  options: ManagedInvocationToolOptions,
): RuntimeBuiltinToolExecutor {
  const service = new RuntimeManagedAgentInvocationService();
  return async (input, context) => executeManagedInvocationTool(input, context, options, service);
}

export function createManagedInvocationToolCallMetadataResolver(
  options: ManagedInvocationToolOptions,
): (input: Record<string, unknown>) => Record<string, unknown> | undefined {
  return (rawInput) => {
    const parsed = parseInput(rawInput);
    if (!parsed.ok) {
      return undefined;
    }
    const agentProfile = resolveManagedAgentProfileEntry(options, parsed.input.agentProfile);
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
  options: ManagedInvocationToolOptions | undefined,
  sessionEventSink: ManagedInvocationSessionEventSink,
): ManagedInvocationToolOptions | undefined {
  if (!options) {
    return undefined;
  }
  const existingSink = options.sessionEventSink;
  return {
    ...options,
    sessionEventSink: {
      publish: async (events, context) => {
        await existingSink?.publish(events, context);
        await sessionEventSink.publish(events, context);
      },
    },
  };
}

async function executeManagedInvocationTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  options: ManagedInvocationToolOptions,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  if (!context) {
    return errorResult("managed_agent.invoke requires runtime session context.");
  }

  const parsed = parseInput(rawInput);
  if (!parsed.ok) {
    return errorResult(parsed.error);
  }

  const agentProfile = resolveManagedAgentProfileEntry(options, parsed.input.agentProfile);
  const agentRouteValidation = validateAgentRouteHint(parsed.input, agentProfile);
  if (!agentRouteValidation.ok) {
    return errorResult(agentRouteValidation.error, {
      profile: parsed.input.profile,
      agentProfile: parsed.input.agentProfile,
      routeId: parsed.input.routeId,
    });
  }
  const routeResolution = resolveRoute(options.routes, parsed.input, agentProfile);
  if (routeResolution.status === "ambiguous") {
    return errorResult(routeResolution.reason);
  }
  if (routeResolution.status === "missing") {
    const unavailableRoute = resolveUnavailableRoute(options.unavailableRoutes ?? [], parsed.input);
    if (unavailableRoute) {
      return errorResult(
        `Managed invocation route '${unavailableRoute.routeId}' is unavailable for provider '${parsed.input.providerRoute.providerId}' and profile '${parsed.input.profile}': ${unavailableRoute.reason}`,
        {
          routeId: unavailableRoute.routeId,
          profile: parsed.input.profile,
          providerRoute: {
            providerId: unavailableRoute.providerId,
            ...(unavailableRoute.model ? { model: unavailableRoute.model } : {}),
          },
          presentationIntent: buildManagedInvocationPresentationIntent({
            routeId: unavailableRoute.routeId,
            profile: parsed.input.profile,
            providerId: unavailableRoute.providerId,
            model: unavailableRoute.model,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: unavailableRoute.reason,
          }),
        },
      );
    }
    return errorResult(`No managed invocation route is configured for provider '${parsed.input.providerRoute.providerId}' and profile '${parsed.input.profile}'.`);
  }
  const route = routeResolution.route;

  const profileDefaults = route.profiles[parsed.input.profile];
  if (!profileDefaults) {
    return errorResult(`Managed invocation route '${route.routeId}' does not allow profile '${parsed.input.profile}'.`);
  }
  const missingRequiredTools = missingManagedInvocationRequiredTools(
    parsed.input.requiredToolNames ?? [],
    profileDefaults.allowedToolNames,
  );
  if (missingRequiredTools.length > 0) {
    return errorResult(
      `Managed invocation route '${route.routeId}' cannot execute this phase because it lacks required tools: ${missingRequiredTools.join(", ")}.`,
      {
        routeId: route.routeId,
        profile: parsed.input.profile,
        missingRequiredTools,
        requiredToolNames: parsed.input.requiredToolNames ?? [],
        allowedToolNames: profileDefaults.allowedToolNames,
        presentationIntent: buildManagedInvocationPresentationIntent({
          routeId: route.routeId,
          profile: parsed.input.profile,
          providerId: route.providerId,
          model: route.model,
          contextMode: parsed.input.contextMode,
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: `Missing required route tools: ${missingRequiredTools.join(", ")}`,
        }),
      },
    );
  }
  const missingRequiredCapabilities = missingManagedInvocationRequiredCapabilities(
    parsed.input.requiredToolNames ?? [],
    profileDefaults,
  );
  if (missingRequiredCapabilities.length > 0) {
    return errorResult(
      `Managed invocation route '${route.routeId}' cannot execute this phase because it lacks required capabilities: ${missingRequiredCapabilities.join(", ")}.`,
      {
        routeId: route.routeId,
        profile: parsed.input.profile,
        missingRequiredCapabilities,
        requiredToolNames: parsed.input.requiredToolNames ?? [],
        presentationIntent: buildManagedInvocationPresentationIntent({
          routeId: route.routeId,
          profile: parsed.input.profile,
          providerId: route.providerId,
          model: route.model,
          contextMode: parsed.input.contextMode,
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: `Missing required route capabilities: ${missingRequiredCapabilities.join(", ")}`,
        }),
      },
    );
  }
  const requestedAuthority = resolveManagedInvocationRequestedAuthority(
    parsed.input.requestedAuthority,
    context.effectiveTurnAuthority?.requestedAuthority,
  );
  const authorityAdmission = validateManagedInvocationRequestedAuthority(requestedAuthority, parsed.input.profile);
  if (!authorityAdmission.ok) {
    return errorResult(authorityAdmission.error, {
      profile: parsed.input.profile,
      requestedAuthority,
      routeId: route.routeId,
    });
  }

  const contextResolution = await resolveInvocationContext(parsed.input, options, route);
  if (!contextResolution.ok) {
    return errorResult(contextResolution.error);
  }
  const prompt = contextResolution.resolution.promptPrefix
    ? `${contextResolution.resolution.promptPrefix}\n\nTask:\n${parsed.input.task}`
    : parsed.input.task;

  const invocationId = buildInvocationId(context.session.id, context.session.userTurnCount, context.toolCall.id);
  const handoffContract = buildHandoffContract(parsed.input);
  const authorityApproval = await requestManagedInvocationAuthorityApproval({
    requestedAuthority,
    routeId: route.routeId,
    profile: parsed.input.profile,
    context,
  });
  if (!authorityApproval.ok) {
    return errorResult(authorityApproval.error, {
      profile: parsed.input.profile,
      requestedAuthority,
      routeId: route.routeId,
    });
  }
  const request = defineManagedAgentInvocationRequest({
    invocationId,
    agentId: `${route.routeId}:${parsed.input.profile}`,
    parentSessionId: context.session.id,
    parentTurnId: `${context.session.id}:turn:${Math.max(context.session.userTurnCount, 1)}`,
    profile: parsed.input.profile,
    requestedBy: options.requestedBy ?? "assistant",
    requestSource: options.requestSource ?? "runtime-tool",
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
    authority: {
      authorityProfileId: profileDefaults.authorityProfileId,
      permissionProfile: profileDefaults.permissionProfile,
      toolAuthority: {
        allowedToolNames: profileDefaults.allowedToolNames,
        writeAllowed: profileDefaults.writeAllowed === true,
        networkAllowed: profileDefaults.networkAllowed === true,
      },
      workingDirectory: profileDefaults.workingDirectory,
      timeoutMs: profileDefaults.timeoutMs,
      credentialRoute: profileDefaults.credentialRoute,
      memoryScope: profileDefaults.memoryScope,
      ...(profileDefaults.writeAuthority ? { writeAuthority: profileDefaults.writeAuthority } : {}),
    },
    input: {
      summary: parsed.input.summary,
      prompt,
      ...(parsed.input.resourceUris ? { resourceUris: parsed.input.resourceUris } : {}),
      context: {
        mode: parsed.input.contextMode,
        ...(parsed.input.agentProfile ? { agentProfile: parsed.input.agentProfile } : {}),
        ...(parsed.input.skills ? { skills: parsed.input.skills } : {}),
        ...(contextResolution.resolution.admittedAgentProfile ? { admittedAgentProfile: contextResolution.resolution.admittedAgentProfile } : {}),
        ...(contextResolution.resolution.admittedSkills ? { admittedSkills: contextResolution.resolution.admittedSkills } : {}),
        ...(contextResolution.resolution.admittedInstructionProfiles ? { admittedInstructionProfiles: contextResolution.resolution.admittedInstructionProfiles } : {}),
        ...(contextResolution.resolution.deniedSkills ? { deniedSkills: contextResolution.resolution.deniedSkills } : {}),
      },
      ...(handoffContract ? { handoff: handoffContract } : {}),
    },
  });

  const startedAt = Date.now();
  const invocationResult = await service.invoke(request, route.adapter, {
    routeId: route.routeId,
    routeHealth: {
      status: "healthy",
      reason: "Configured managed invocation route selected by runtime tool.",
    },
    providerModelProof: {
      status: "live-proven",
      source: "managed-invocation-route-health",
      requiresToolCalls: route.adapter.descriptor.adapterKind === "direct",
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
  });
  const durationMs = Date.now() - startedAt;
  const result = invocationResult.status === "completed"
    ? {
        ...invocationResult,
        record: persistManagedInvocationResources(invocationResult.record, options.artifactStore),
      }
    : invocationResult;
  const events = appendManagedInvocationSessionEvents({
    session: context.session,
    request,
    decision: result.decision,
    ...(result.status === "completed" ? { record: result.record, durationMs } : {}),
  });
  await options.sessionEventSink?.publish(events, context);

  if (result.status === "denied") {
    return {
      output: `Managed invocation denied: ${result.decision.reason}`,
      isError: true,
      metadata: {
        toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
        kind: "managed-invocation",
        invocationId,
        routeId: route.routeId,
        status: "denied",
        profile: request.profile,
        providerRoute: request.providerRoute,
        ...(route.voiceProfile ? { voiceProfile: route.voiceProfile } : {}),
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        requestedAuthority: request.requestedAuthority,
        authorityProfileId: request.authority.authorityProfileId,
        context: request.input.context,
        ...(request.input.handoff ? { handoffContract: request.input.handoff } : {}),
        missingCapabilities: result.decision.missingCapabilities,
        sessionEventIds: events.map((event) => event.eventId),
        presentationIntent: buildManagedInvocationPresentationIntent({
          routeId: route.routeId,
          profile: request.profile,
          providerId: request.providerRoute.providerId,
          model: request.providerRoute.model,
          contextMode: parsed.input.contextMode,
          status: "denied",
          substantiveEvidence: false,
          failureReason: result.decision.reason,
        }),
      },
    };
  }

  const summary = result.record.resultHandoff?.summary ?? `Managed invocation ${result.record.lifecycleState}.`;
  const terminalError = result.record.lifecycleState !== "completed";
  const recovery = terminalError
    ? buildManagedInvocationPhaseRecovery(rawInput)
    : undefined;
  const phaseCompletion = terminalError
    ? undefined
    : buildManagedInvocationPhaseCompletion(rawInput, result.record.resultHandoff);
  return {
    output: recovery || phaseCompletion
      ? JSON.stringify({
          status: result.record.lifecycleState,
          summary,
          ...(result.record.resultHandoff ? { resultHandoff: result.record.resultHandoff } : {}),
          ...(result.record.transcript ? { transcript: result.record.transcript } : {}),
          ...(recovery ? { recovery } : {}),
          ...(phaseCompletion ? { phaseCompletion } : {}),
        }, null, 2)
      : summary,
    isError: terminalError,
    metadata: {
      toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
      kind: "managed-invocation",
      invocationId,
      routeId: route.routeId,
      status: result.record.lifecycleState,
      profile: result.record.profile,
      providerRoute: result.record.providerRoute,
      ...(route.voiceProfile ? { voiceProfile: route.voiceProfile } : {}),
      adapterKind: result.record.adapterKind,
      executionMode: result.record.executionMode,
      requestedAuthority: request.requestedAuthority,
      authorityProfileId: result.record.authority.authorityProfileId,
      capabilitySnapshot: result.record.capabilitySnapshot,
      context: request.input.context,
      ...(request.input.handoff ? { handoffContract: request.input.handoff } : {}),
      childSessionId: result.record.childSessionId,
      childTurnId: result.record.childTurnId,
      resultHandoff: result.record.resultHandoff,
      transcript: result.record.transcript,
      ...(result.record.diagnostics ? { diagnostics: result.record.diagnostics } : {}),
      ...(recovery ? { managedInvocationRecovery: recovery } : {}),
      ...(phaseCompletion ? { managedInvocationPhaseCompletion: phaseCompletion } : {}),
      sessionEventIds: events.map((event) => event.eventId),
      presentationIntent: buildManagedInvocationPresentationIntent({
        routeId: route.routeId,
        profile: result.record.profile,
        providerId: result.record.providerRoute.providerId,
        model: result.record.providerRoute.model,
        contextMode: parsed.input.contextMode,
        status: result.record.lifecycleState,
        substantiveEvidence: hasSubstantiveManagedInvocationEvidence(result.record),
        failureReason: terminalError ? summary : undefined,
      }),
    },
  };
}

function buildManagedInvocationPresentationIntent(input: {
  readonly routeId: string;
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
    source: MANAGED_AGENT_INVOKE_TOOL_NAME,
    confidence: input.substantiveEvidence ? "high" : "medium",
    columns: [
      { key: "routeId", label: "Route", valueKind: "text" },
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

function boundedPresentationText(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function hasSubstantiveManagedInvocationEvidence(record: ManagedAgentInvocationRecord): boolean {
  if (record.lifecycleState !== "completed") {
    return false;
  }
  const summary = record.resultHandoff?.summary.trim();
  if (!summary || summary === "Direct provider managed invocation completed.") {
    return false;
  }
  return (record.resultHandoff?.resourceUris.length ?? 0) > 0;
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

function resolveManagedAgentProfileEntry(
  options: ManagedInvocationToolOptions,
  profile: string | undefined,
): ManagedInvocationAgentCatalogEntry | undefined {
  if (!profile) {
    return undefined;
  }
  return (options.agentCatalog ?? []).find((agent) =>
    agent.name === profile
    || agent.displayName === profile
    || (agent.nicknameCandidates ?? []).includes(profile)
  );
}

function validateAgentRouteHint(
  input: ManagedInvocationToolInput,
  agentProfile: ManagedInvocationAgentCatalogEntry | undefined,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (!agentProfile) {
    return { ok: true };
  }
  const label = input.agentProfile ?? agentProfile.name;
  if (agentProfile.routeId && input.routeId && agentProfile.routeId !== input.routeId) {
    return {
      ok: false,
      error: `managed_agent.invoke routeId '${input.routeId}' contradicts configured agentProfile '${label}' route hint '${agentProfile.routeId}'.`,
    };
  }
  const hintedProvider = agentProfile.providerRoute?.providerId;
  if (hintedProvider && hintedProvider !== input.providerRoute.providerId) {
    return {
      ok: false,
      error: `managed_agent.invoke provider '${input.providerRoute.providerId}' contradicts configured agentProfile '${label}' provider hint '${hintedProvider}'.`,
    };
  }
  const hintedModel = agentProfile.providerRoute?.model;
  if (hintedModel && input.providerRoute.model && hintedModel !== input.providerRoute.model) {
    return {
      ok: false,
      error: `managed_agent.invoke model '${input.providerRoute.model}' contradicts configured agentProfile '${label}' model hint '${hintedModel}'.`,
    };
  }
  return { ok: true };
}

function buildManagedRouteCatalogDescription(options: ManagedInvocationToolOptions): string {
  const healthy = options.routes.length > 0
    ? options.routes
        .map((route) => {
          const suitability = formatTaskSuitability(route.taskSuitability, managedInvocationSkillNames(options));
          return `- ${route.routeId}: providerRoute.providerId=${route.providerId}${route.model ? `, model=${route.model}` : ""}, surface=${route.surface ?? route.adapter.descriptor.supportedExecutionModes[0] ?? "configured"}, profiles=${Object.keys(route.profiles).join(",")}${suitability ? `, taskSuitability=${suitability}` : ""}`;
        })
        .join("\n")
    : "- none";
  const unavailable = options.unavailableRoutes && options.unavailableRoutes.length > 0
    ? options.unavailableRoutes
        .map((route) => `- ${route.routeId}: providerRoute.providerId=${route.providerId}${route.model ? `, model=${route.model}` : ""}, profiles=${route.profiles.join(",")}, reason=${route.reason}`)
        .join("\n")
    : "- none";
  return [
    "Configured healthy managed invocation routes:",
    healthy,
    "Configured unavailable managed invocation routes:",
    unavailable,
  ].join("\n");
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
    `Configured admitted skills: ${managedInvocationSkillNames(options).join(", ") || "none"}`,
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
  const rows = skillCatalog.map((skill) => {
    const tags = skill.tags && skill.tags.length > 0 ? `, tags=${skill.tags.join(",")}` : "";
    return `- ${skill.name}: ${skill.description}${tags}`;
  });
  return ["Configured skill catalog:", ...rows].join("\n");
}

function buildManagedTaskAffinityDescription(options: ManagedInvocationToolOptions): string {
  const routeRows = managedRouteTaskAffinityRows(options.routes);
  const agentRows = managedAgentTaskAffinityRows(options.agentCatalog ?? []);
  return [
    "Task-affinity hints:",
    routeRows.length > 0 ? `Routes: ${routeRows.join("; ")}` : "Routes: no task suitability evidence",
    agentRows.length > 0 ? `Agent profiles: ${agentRows.join("; ")}` : "Agent profiles: no configured agent profiles",
    "Skills: request a skill only when its name appears in the configured skill catalog or on the selected agent profile.",
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
    ...(options.skillCatalog ?? []).map((skill) => skill.name),
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

function persistManagedInvocationResources(
  record: ManagedAgentInvocationRecord,
  artifactStore: ArtifactResourceStore | undefined,
): ManagedAgentInvocationRecord {
  if (!artifactStore) {
    return record;
  }
  const remappedUris = new Map<string, string>();
  const persistUri = (uri: string, title: string, content: string): string => {
    const existing = remappedUris.get(uri);
    if (existing) {
      return existing;
    }
    const artifact = artifactStore.put({
      namespace: "managed-invocations",
      title,
      mimeType: "text/markdown",
      content: { type: "text", text: content },
      producer: { kind: "managed-invocation", name: record.providerRoute.providerId },
      retention: { scope: "session" },
    });
    const resourceUri = `kiln://artifacts/managed-invocations/${artifact.id}/content`;
    remappedUris.set(uri, resourceUri);
    return resourceUri;
  };

  const transcriptUri = record.transcript
    ? persistUri(
        record.transcript.uri,
        `Managed invocation ${record.invocationId} transcript`,
        formatManagedInvocationTranscript(record),
      )
    : undefined;
  const diagnosticUris = new Map(
    (record.diagnostics ?? []).map((diagnostic) => [
      diagnostic.uri,
      persistUri(
        diagnostic.uri,
        `Managed invocation ${record.invocationId} ${diagnostic.kind}`,
        formatManagedInvocationDiagnostic(record, diagnostic.kind),
      ),
    ] as const),
  );
  const resourceUris = record.resultHandoff?.resourceUris.map((uri) => {
    if (record.transcript?.uri === uri && transcriptUri) {
      return transcriptUri;
    }
    return diagnosticUris.get(uri) ?? uri;
  });

  return {
    ...record,
    ...(record.transcript && transcriptUri
      ? {
          transcript: {
            ...record.transcript,
            uri: transcriptUri,
            persisted: true,
            retention: "session" as const,
          },
        }
      : {}),
    ...(record.diagnostics
      ? {
          diagnostics: record.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            uri: diagnosticUris.get(diagnostic.uri) ?? diagnostic.uri,
          })),
        }
      : {}),
    ...(record.resultHandoff && resourceUris
      ? {
          resultHandoff: {
            ...record.resultHandoff,
            resourceUris,
          },
        }
      : {}),
  };
}

function formatManagedInvocationTranscript(record: ManagedAgentInvocationRecord): string {
  return [
    "# Managed Invocation Transcript",
    "",
    `Invocation ID: ${record.invocationId}`,
    `Status: ${record.lifecycleState}`,
    `Profile: ${record.profile}`,
    `Provider: ${record.providerRoute.providerId}`,
    record.providerRoute.model ? `Model: ${record.providerRoute.model}` : undefined,
    `Surface: ${record.providerRoute.surface}`,
    `Adapter: ${record.adapterKind}`,
    `Execution: ${record.executionMode}`,
    "",
    "## Capability Snapshot",
    "",
    `Snapshot ID: ${record.capabilitySnapshot.snapshotId}`,
    `Captured at: ${record.capabilitySnapshot.capturedAt}`,
    `Route ID: ${record.capabilitySnapshot.routeId}`,
    `Route health: ${record.capabilitySnapshot.routeHealth.status}`,
    `Route health reason: ${record.capabilitySnapshot.routeHealth.reason}`,
    `Provider proof: ${record.capabilitySnapshot.providerModelProof.status}`,
    `Provider proof source: ${record.capabilitySnapshot.providerModelProof.source}`,
    `Context mode: ${record.capabilitySnapshot.contextMode}`,
    `Resource plane: ${record.capabilitySnapshot.resourcePlane.available ? "available" : "unavailable"}`,
    `Child identity: ${formatChildIdentity(record.capabilitySnapshot.childIdentity)}`,
    record.childSessionId ? `Child session: ${record.childSessionId}` : undefined,
    record.childTurnId ? `Child turn: ${record.childTurnId}` : undefined,
    "",
    "## Result",
    "",
    record.resultHandoff?.summary ?? "No result summary was recorded.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatManagedInvocationDiagnostic(record: ManagedAgentInvocationRecord, kind: string): string {
  return [
    "# Managed Invocation Diagnostic",
    "",
    `Invocation ID: ${record.invocationId}`,
    `Diagnostic: ${kind}`,
    `Status: ${record.lifecycleState}`,
    `Provider: ${record.providerRoute.providerId}`,
    record.providerRoute.model ? `Model: ${record.providerRoute.model}` : undefined,
    `Capability snapshot: ${record.capabilitySnapshot.snapshotId}`,
    `Route health: ${record.capabilitySnapshot.routeHealth.status}`,
    `Provider proof: ${record.capabilitySnapshot.providerModelProof.status}`,
    "",
    record.resultHandoff?.summary ?? "No diagnostic summary was recorded.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatChildIdentity(identity: ManagedAgentInvocationRecord["capabilitySnapshot"]["childIdentity"]): string {
  return identity.displayName ?? identity.admittedAgentProfile ?? identity.requestedAgentProfile ?? identity.agentId;
}

function parseInput(input: Record<string, unknown>): { readonly ok: true; readonly input: ManagedInvocationToolInput } | { readonly ok: false; readonly error: string } {
  const profile = input.profile === undefined ? "foundation-readonly-plan" : input.profile;
  if (
    profile !== "foundation-readonly-plan"
    && profile !== "foundation-propose-writes"
    && profile !== "foundation-apply-approved-writes"
    && profile !== "foundation-memory-write-proposals"
  ) {
    return { ok: false, error: "managed_agent.invoke profile is not supported." };
  }
  const providerRoute = readRecord(input.providerRoute);
  const providerId = readText(providerRoute?.providerId);
  if (!providerId) {
    return { ok: false, error: "managed_agent.invoke requires providerRoute.providerId." };
  }
  const task = readText(input.task);
  if (!task) {
    return { ok: false, error: "managed_agent.invoke requires task." };
  }
  const resourceUris = Array.isArray(input.resourceUris)
    ? input.resourceUris.map(readText).filter((uri): uri is string => uri !== undefined)
    : undefined;
  const skills = Array.isArray(input.skills)
    ? unique(input.skills.map(readText).filter((skill): skill is string => skill !== undefined))
    : undefined;
  const expectedEvidence = readTextArray(input.expectedEvidence);
  const requiredToolNames = readTextArray(input.requiredToolNames);
  const requiredResultFields = readTextArray(input.requiredResultFields);
  const doneCriteria = readTextArray(input.doneCriteria);
  const requestedAuthority = parseManagedInvocationRequestedAuthority(input.requestedAuthority);
  if (!requestedAuthority.ok) {
    return { ok: false, error: "managed_agent.invoke requestedAuthority is not supported." };
  }
  const contextMode = parseContextMode(input.contextMode);
  if (!contextMode) {
    return { ok: false, error: "managed_agent.invoke contextMode is not supported." };
  }
  if (contextMode === "resources" && (!resourceUris || resourceUris.length === 0)) {
    return { ok: false, error: "managed_agent.invoke contextMode resources requires at least one resourceUris entry. Use contextMode isolated when no governed resources are supplied." };
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
      ...(skills && skills.length > 0 ? { skills } : {}),
      contextMode,
      ...(readText(input.workItemId) ? { workItemId: readText(input.workItemId) } : {}),
      ...(readText(input.roleIntent) ? { roleIntent: readText(input.roleIntent) } : {}),
      ...(expectedEvidence && expectedEvidence.length > 0 ? { expectedEvidence } : {}),
      ...(requiredToolNames && requiredToolNames.length > 0 ? { requiredToolNames } : {}),
      ...(requiredResultFields && requiredResultFields.length > 0 ? { requiredResultFields } : {}),
      ...(doneCriteria && doneCriteria.length > 0 ? { doneCriteria } : {}),
      ...(typeof input.residualRiskRequired === "boolean" ? { residualRiskRequired: input.residualRiskRequired } : {}),
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
  | { readonly ok: false; readonly error: string }
> {
  const needsResolver = Boolean(options.contextResolver || input.agentProfile || input.skills?.length || input.contextMode === "fork");
  if (!needsResolver) {
    return { ok: true, resolution: {} };
  }
  if (!options.contextResolver) {
    return {
      ok: false,
      error: "Managed invocation context resolver is not configured for requested agentProfile, skills, or fork context.",
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
    });
    if (resolution.deniedSkills && resolution.deniedSkills.length > 0) {
      return {
        ok: false,
        error: `Managed invocation denied skill(s): ${resolution.deniedSkills.join(", ")}`,
      };
    }
    return { ok: true, resolution };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (requestedAuthority === "read_only" && profile !== "foundation-readonly-plan") {
    return {
      ok: false,
      error: `managed_agent.invoke read_only requested authority cannot select managed profile '${profile}'.`,
    };
  }
  if (
    profile === "foundation-readonly-plan"
    && (requestedAuthority === "audited" || requestedAuthority === "destructive")
  ) {
    return {
      ok: false,
      error: `managed_agent.invoke ${requestedAuthority} requested authority cannot select read-only managed profile '${profile}'.`,
    };
  }
  return { ok: true };
}

async function requestManagedInvocationAuthorityApproval(input: {
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly routeId: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly context: RuntimeBuiltinToolExecutionContext;
}): Promise<
  | { readonly ok: true; readonly authorityApproval?: ManagedAgentAuthorityApproval }
  | { readonly ok: false; readonly error: string }
> {
  if (input.requestedAuthority !== "destructive") {
    return { ok: true };
  }
  if (!input.context.requestApproval) {
    return {
      ok: false,
      error: "managed_agent.invoke destructive requested authority requires an approval flow before child invocation.",
    };
  }

  const description = `managed_agent.invoke requests destructive authority for route '${input.routeId}' and profile '${input.profile}'.`;
  const approval = await input.context.requestApproval(description);
  if (!approval.approved) {
    return {
      ok: false,
      error: `managed_agent.invoke destructive requested authority denied: ${approval.reason ?? "approval denied"}`,
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
  };
  return Object.keys(contract).length > 0 ? contract : undefined;
}

function errorResult(
  output: string,
  metadata: Record<string, unknown> = {},
): ManagedInvocationToolResult {
  return {
    output,
    isError: true,
    metadata: {
      toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
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

function readTextArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = unique(value.map(readText).filter((item): item is string => item !== undefined));
  return values.length > 0 ? values : undefined;
}

function buildInvocationId(sessionId: string, turnCount: number, toolCallId: string): string {
  return `managed-${sanitizeId(sessionId)}-${Math.max(turnCount, 1)}-${sanitizeId(toolCallId)}`;
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized.slice(0, 96) : "invocation";
}
