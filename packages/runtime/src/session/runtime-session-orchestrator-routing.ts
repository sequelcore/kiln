import type {
  ProviderAdapter,
  ContentPart,
  ToolDefinition,
  RoutingDecision,
  ComplexityScore,
  ModelRoutingDiagnostic,
  ModelRoutingRankingEvidence,
  Capability,
  ExecutionIdentity,
  DeliberationResolution,
  ModelDeliberationCapabilities,
  MultimodalArtifact,
  MultimodalCapability,
  MultimodalTransportModality,
  MultimodalTransformCandidate,
  ManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  appendExecutionIdentity,
  defineManagedAgentInvocationRequest,
  extractText,
  KilnError,
  ModelCapabilityRegistry,
  planMultimodalRoute,
  resolveDeliberation,
  resolveExecutionIdentity,
  scoreComplexity,
  textParts,
} from "@kilnai/core";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../agents/managed-invocation/index.js";
import type { RuntimeSession } from "./runtime-session.js";
import type {
  ModelRoutingPolicyConfig,
  OrchestratorDeps,
  PerCallToolConfig,
  RuntimeMultimodalDelegationRoute,
  RuntimeMultimodalTransformRoute,
  RuntimeMultimodalTransformSourcePart,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";

export interface RuntimeSessionRoutingResolution {
  readonly effectiveProvider: ProviderAdapter;
  readonly effectiveTools: readonly ToolDefinition[] | undefined;
  readonly hasTools: boolean;
  readonly invocationSystem: string;
  readonly executionIdentity?: ExecutionIdentity;
  readonly routingDecision?: RoutingDecision;
  readonly deliberationResolution?: DeliberationResolution;
  readonly delegatedMultimodalResult?: RuntimeMultimodalDelegationExecutionResult;
  readonly transformedUserParts?: readonly ContentPart[];
  readonly preModelToolExecutions?: readonly ToolExecutionSummary[];
}

const MODALITY_CAPABILITIES = new ModelCapabilityRegistry();
const MANAGED_MULTIMODAL_DELEGATION_TOOL_NAME = "managed_agent.invoke";

export interface RuntimeMultimodalDelegationExecutionResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly toolExecution: ToolExecutionSummary;
}

interface RuntimeMultimodalRouteEffect {
  readonly delegatedMultimodalResult?: RuntimeMultimodalDelegationExecutionResult;
  readonly transformedUserParts?: readonly ContentPart[];
  readonly transformToolExecution?: ToolExecutionSummary;
}

interface RuntimeMultimodalArtifact extends MultimodalArtifact {
  readonly part: Extract<ContentPart, { type: "image" | "audio" | "file" }>;
}

interface RuntimeMultimodalRequirements {
  readonly requestedCapability: MultimodalCapability;
  readonly requiredInputModalities: readonly MultimodalTransportModality[];
  readonly artifacts: readonly RuntimeMultimodalArtifact[];
  readonly userParts: readonly ContentPart[];
}

export async function resolveRuntimeSessionRouting(
  deps: OrchestratorDeps,
  session: RuntimeSession,
  userParts: readonly ContentPart[],
  baseSystem: string,
  baseTools: readonly ToolDefinition[] | undefined,
  perCallConfig: PerCallToolConfig | undefined,
  emitModelRouted: (sessionId: string, decision: RoutingDecision) => void,
  emitMultimodalRouted?: (sessionId: string, input: {
    readonly provider: string;
    readonly model: string;
    readonly requestedCapability: MultimodalCapability;
    readonly requiredModalities: readonly MultimodalTransportModality[];
    readonly artifactUris: readonly string[];
    readonly decision: ReturnType<typeof planMultimodalRoute>;
  }) => void,
): Promise<RuntimeSessionRoutingResolution> {
  const hasBuiltins = (deps.builtinTools?.size ?? 0) > 0;
  const hasMcp = (deps.mcpClients?.length ?? 0) > 0;
  const userText = extractText(userParts);

  let mergedTools = mergeAdditionalTools(baseTools, perCallConfig?.additionalTools);
  if (perCallConfig?.toolAllowlist) {
    mergedTools = mergedTools?.filter((tool) => perCallConfig.toolAllowlist?.has(tool.name));
  }
  const hasToolSurface = (mergedTools?.length ?? 0) > 0 && (hasBuiltins || hasMcp);
  const projectedCompletedTurnDepth = session.messageCount + 2;
  let routingComplexity = scoreComplexity({
    messageText: userText,
    toolCount: mergedTools?.length ?? 0,
    turnDepth: projectedCompletedTurnDepth,
  });

  if (deps.toolRAG && deps.capabilityMap && mergedTools && mergedTools.length > 30) {
    try {
      const allCapabilities = Array.from(deps.capabilityMap.values());
      const selected = await deps.toolRAG.selectTools(userText, allCapabilities);
      if (selected.length > 0) {
        const selectedNames = new Set(selected.map((capability: Capability) => capability.name));
        mergedTools = mergedTools.filter((tool) => selectedNames.has(tool.name));
        routingComplexity = scoreComplexity({
          messageText: userText,
          toolCount: mergedTools.length,
          turnDepth: projectedCompletedTurnDepth,
        });
      }
    } catch {
      // Fail-open: use all tools if ToolRAG fails.
    }
  }

  let effectiveProvider: ProviderAdapter = deps.provider;
  let routingDecision: RoutingDecision | undefined;
  let routedProviderIdentity: string | undefined;
  let routedModelIdentity: string | undefined;
  const phaseAwareSignals = resolvePhaseAwareRoutingSignals(perCallConfig?.modelRoutingPolicy);

  if (perCallConfig?.modelOverride?.source === "operator") {
    const override = perCallConfig.modelOverride;
    routedProviderIdentity = override.provider;
    routedModelIdentity = override.model;
    const poolProvider = deps.providerPool?.get(override.provider);
    if (poolProvider) {
      effectiveProvider = poolProvider;
    }
    routingDecision = {
      provider: override.provider,
      model: override.model,
      canonicalModel: override.canonicalModel,
      billingMode: override.billingMode,
      reasoning: "Explicit model override",
      confidence: 1.0,
      routingTier: "rule",
      selectionMode: "explicit-operator-only",
    };
  } else if (deps.modelRouter) {
    try {
      const decision = deps.modelRouter.route({
        tenantId: perCallConfig?.tenantId ?? "default",
        complexity: routingComplexity,
        hasTools: hasToolSurface,
        toolCount: mergedTools?.length ?? 0,
        requiresStreaming: false,
        ...(perCallConfig?.deliberationIntent
          ? {
              deliberationIntent: perCallConfig.deliberationIntent,
              deliberationSource: perCallConfig.deliberationSource ?? "operator",
            }
          : {}),
        ...(perCallConfig?.modelRoutingPolicy?.task ? { task: perCallConfig.modelRoutingPolicy.task } : {}),
        ...phaseAwareSignals,
        ...(perCallConfig?.modelRoutingPolicy?.rankingEvidence
          ? { rankingEvidence: perCallConfig.modelRoutingPolicy.rankingEvidence }
          : {}),
      });
      routingDecision = {
        ...decision,
        selectionMode: "automatic",
      };

      const poolProvider = deps.providerPool?.get(decision.provider);
      if (poolProvider) {
        effectiveProvider = poolProvider;
        routedProviderIdentity = decision.provider;
        routedModelIdentity = decision.model;
      }
    } catch (error) {
      if (perCallConfig?.deliberationIntent) {
        throw error;
      }
      // With no deliberation authority at risk, preserve the configured default route.
    }
  }

  const executionIdentity = resolveExecutionIdentity({
    configuredProvider: deps.provider.name,
    configuredModel: deps.model,
    routedProvider: routedProviderIdentity,
    routedModel: routedModelIdentity,
    routedCanonicalModel: routingDecision?.canonicalModel,
    routedBillingMode: routingDecision?.billingMode,
  });

  let deliberationResolution = perCallConfig?.deliberationResolution ?? routingDecision?.deliberationResolution;
  if (perCallConfig?.deliberationIntent && !deliberationResolution) {
    const provider = routingDecision?.provider ?? executionIdentity?.provider ?? deps.provider.name;
    const model = routingDecision?.model ?? executionIdentity?.model ?? deps.model;
    deliberationResolution = resolveDeliberation({
      intent: perCallConfig.deliberationIntent,
      source: perCallConfig.deliberationSource ?? "operator",
      capabilities: deliberationCapabilitiesFor(provider, model ?? "", perCallConfig.modelRoutingPolicy),
    });
  }
  if (deliberationResolution?.status === "denied") {
    throw new Error(`Deliberation denied for the selected route: ${deliberationResolution.reason}`);
  }

  if (routingDecision) {
    const routingTargetIdentity = resolveExecutionIdentity({
      configuredProvider: routingDecision.provider,
      configuredModel: routingDecision.model,
      configuredCanonicalModel: routingDecision.canonicalModel,
      configuredBillingMode: routingDecision.billingMode,
    });
    routingDecision = {
      ...routingDecision,
      canonicalModel: routingTargetIdentity?.canonicalModel ?? routingDecision.canonicalModel,
      billingMode: routingTargetIdentity?.billingMode ?? routingDecision.billingMode,
    };
    routingDecision = {
      ...routingDecision,
      ...(deliberationResolution ? { deliberationResolution } : {}),
      rationale: buildModelRoutingRationale(
        routingDecision,
        hasToolSurface,
        mergedTools?.length ?? 0,
        routingComplexity,
        perCallConfig,
      ),
    };
  }

  const invocationSystem = appendOperatorSurfaceToolDirective(
    appendExecutionIdentity(
      baseSystem,
      executionIdentity,
    ),
    mergedTools,
  );

  const multimodalEffect = await resolveRuntimeMultimodalRoute({
    provider: effectiveProvider,
    model: executionIdentity?.canonicalModel ?? executionIdentity?.model ?? deps.model,
    currentUserParts: userParts,
    messages: session.conversationHistory,
    capabilityRegistry: deps.modelCapabilityRegistry ?? MODALITY_CAPABILITIES,
    session,
    delegationRoutes: deps.multimodalDelegationRoutes ?? [],
    transformRoutes: deps.multimodalTransformRoutes ?? [],
    emitDecision: (route) => emitMultimodalRouted?.(session.id, route),
  });
  const delegatedMultimodalResult = multimodalEffect?.delegatedMultimodalResult;

  if (routingDecision && delegatedMultimodalResult === undefined) {
    emitModelRouted(session.id, routingDecision);
  }

  return {
    effectiveProvider,
    effectiveTools: mergedTools,
    hasTools: (mergedTools?.length ?? 0) > 0 && (hasBuiltins || hasMcp),
    invocationSystem,
    executionIdentity,
    routingDecision,
    ...(deliberationResolution ? { deliberationResolution } : {}),
    ...(delegatedMultimodalResult ? { delegatedMultimodalResult } : {}),
    ...(multimodalEffect?.transformedUserParts ? { transformedUserParts: multimodalEffect.transformedUserParts } : {}),
    ...(multimodalEffect?.transformToolExecution ? { preModelToolExecutions: [multimodalEffect.transformToolExecution] } : {}),
  };
}

async function resolveRuntimeMultimodalRoute(input: {
  readonly provider: ProviderAdapter;
  readonly model?: string;
  readonly currentUserParts: readonly ContentPart[];
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly parts: readonly ContentPart[] }[];
  readonly capabilityRegistry: ModelCapabilityRegistry;
  readonly session: RuntimeSession;
  readonly delegationRoutes: readonly RuntimeMultimodalDelegationRoute[];
  readonly transformRoutes: readonly RuntimeMultimodalTransformRoute[];
  readonly emitDecision?: (input: {
    readonly provider: string;
    readonly model: string;
    readonly requestedCapability: MultimodalCapability;
    readonly requiredModalities: readonly MultimodalTransportModality[];
    readonly artifactUris: readonly string[];
    readonly decision: ReturnType<typeof planMultimodalRoute>;
  }) => void;
}): Promise<RuntimeMultimodalRouteEffect | undefined> {
  const requirements = multimodalRequirements(input.currentUserParts, input.messages);
  if (!requirements) {
    return undefined;
  }

  const capabilities = input.capabilityRegistry.modalityCapabilities(input.provider.name, input.model ?? "unknown");
  const decision = planMultimodalRoute({
    requestedCapability: requirements.requestedCapability,
    requiredInputModalities: requirements.requiredInputModalities,
    artifacts: requirements.artifacts,
    activeRoute: capabilities,
    policy: {
      allowNative: true,
      allowDelegation: input.delegationRoutes.length > 0,
      allowTransforms: input.transformRoutes.length > 0,
    },
    auxiliaryRoutes: input.delegationRoutes.map((route) => route.route),
    transforms: input.transformRoutes.map(projectTransformCandidate),
  });

  if (decision.strategy === "native") {
    input.emitDecision?.({
      provider: capabilities.provider,
      model: capabilities.model,
      requestedCapability: requirements.requestedCapability,
      requiredModalities: requirements.requiredInputModalities,
      artifactUris: requirements.artifacts.map((artifact) => artifact.uri),
      decision,
    });
    return undefined;
  }

  if (decision.strategy === "delegated" && decision.delegation) {
    input.emitDecision?.({
      provider: capabilities.provider,
      model: capabilities.model,
      requestedCapability: requirements.requestedCapability,
      requiredModalities: requirements.requiredInputModalities,
      artifactUris: requirements.artifacts.map((artifact) => artifact.uri),
      decision,
    });
    return {
      delegatedMultimodalResult: await invokeManagedMultimodalDelegation({
        session: input.session,
        route: requireDelegationRoute(input.delegationRoutes, decision.delegation.routeId),
        requirements,
        decision,
      }),
    };
  }

  if (decision.strategy === "transform" && decision.transform) {
    const transformResult = await executeRuntimeMultimodalTransform({
      route: requireTransformRoute(input.transformRoutes, decision.transform.transform),
      requirements,
      decision,
    });
    input.emitDecision?.({
      provider: capabilities.provider,
      model: capabilities.model,
      requestedCapability: requirements.requestedCapability,
      requiredModalities: requirements.requiredInputModalities,
      artifactUris: requirements.artifacts.map((artifact) => artifact.uri),
      decision,
    });
    return {
      transformedUserParts: transformResult.parts,
      transformToolExecution: transformResult.toolExecution,
    };
  }

  input.emitDecision?.({
    provider: capabilities.provider,
    model: capabilities.model,
    requestedCapability: requirements.requestedCapability,
    requiredModalities: requirements.requiredInputModalities,
    artifactUris: requirements.artifacts.map((artifact) => artifact.uri),
    decision,
  });

  const diagnosticCodes = decision.diagnostics.map((diagnostic) => diagnostic.code).join(",");
  throw new KilnError(
    "UNSUPPORTED_MODALITY",
    `Multimodal route failed closed: ${decision.reason.code} for ${capabilities.provider}/${capabilities.model}; required=${
      requirements.requiredInputModalities.join(",")
    }; diagnostics=${diagnosticCodes || "none"}`,
    {
      context: {
        modality: requirements.requiredInputModalities.join(","),
        provider: capabilities.provider,
        model: capabilities.model,
        routingStrategy: decision.strategy,
        reasonCode: decision.reason.code,
        diagnostics: decision.diagnostics,
      },
    },
  );
}

function projectTransformCandidate(route: RuntimeMultimodalTransformRoute): MultimodalTransformCandidate {
  return {
    transform: route.transform,
    sourceModalities: route.sourceModalities,
    outputModality: route.outputModality,
    available: true,
    provenance: route.provenance,
    degradation: route.degradation,
  };
}

async function executeRuntimeMultimodalTransform(input: {
  readonly route: RuntimeMultimodalTransformRoute;
  readonly requirements: RuntimeMultimodalRequirements;
  readonly decision: ReturnType<typeof planMultimodalRoute>;
}): Promise<{
  readonly parts: readonly ContentPart[];
  readonly toolExecution: ToolExecutionSummary;
}> {
  const startedAt = Date.now();
  const transform = input.decision.transform;
  if (!transform) {
    throw new KilnError(
      "UNSUPPORTED_MODALITY",
      "Multimodal transform route was requested without transform evidence.",
    );
  }
  const sourceArtifacts = input.requirements.artifacts.filter((artifact) =>
    transform.sourceArtifactUris.includes(artifact.uri)
  );
  const sourceParts = sourceArtifacts.map((artifact) => artifact.part).filter(isTransformSourcePart);
  try {
    assertTransformSourcesAreCurrentTurnParts(input.requirements.userParts, sourceParts);
    const result = await input.route.execute({
      requestedCapability: input.requirements.requestedCapability,
      sourceArtifacts,
      sourceParts,
      userParts: input.requirements.userParts,
    });
    return {
      parts: result.parts,
      toolExecution: {
        toolName: `multimodal_transform.${input.route.transform}`,
        durationMs: Date.now() - startedAt,
        success: true,
        output: result.summary,
        resultSummary: result.summary.slice(0, 200),
        metadata: {
          kind: "multimodal-transform",
          transform: input.route.transform,
          sourceArtifactUris: sourceArtifacts.map((artifact) => artifact.uri),
          ...(result.outputArtifactUris ? { outputArtifactUris: result.outputArtifactUris } : {}),
          requestedCapability: input.requirements.requestedCapability,
          outputModality: input.route.outputModality,
          provenance: input.route.provenance,
          degradation: input.route.degradation,
          ...(result.metadata ? { result: result.metadata } : {}),
        },
      },
    };
  } catch (error) {
    throw new KilnError(
      "UNSUPPORTED_MODALITY",
      `Multimodal transform '${input.route.transform}' failed closed: ${error instanceof Error ? error.message : String(error)}`,
      {
        context: {
          transform: input.route.transform,
          requestedCapability: input.requirements.requestedCapability,
          sourceArtifactUris: sourceArtifacts.map((artifact) => artifact.uri),
        },
      },
    );
  }
}

async function invokeManagedMultimodalDelegation(input: {
  readonly session: RuntimeSession;
  readonly route: RuntimeMultimodalDelegationRoute;
  readonly requirements: RuntimeMultimodalRequirements;
  readonly decision: ReturnType<typeof planMultimodalRoute>;
}): Promise<RuntimeMultimodalDelegationExecutionResult> {
  const observedRuntimeAuthority = input.route.observedRuntimeAuthority;
  const service = new RuntimeManagedAgentInvocationService({
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: runtimeMultimodalCredentialRouteIds(input.route),
    }),
    ...(observedRuntimeAuthority
      ? {
          authorityObserver: {
            observe: async () => observedRuntimeAuthority,
          },
        }
      : {}),
  });
  const resourceUris = input.requirements.artifacts.map((artifact) => artifact.uri);
  const invocationId = createRuntimeMultimodalDelegationInvocationId(
    input.session.id,
    input.session.userTurnCount + 1,
    input.route.route.routeId,
  );
  const request = defineManagedAgentInvocationRequest({
    invocationId,
    agentId: `${input.route.route.routeId}:${input.route.profile}`,
    parentSessionId: input.session.id,
    parentTurnId: `${input.session.id}:turn:${input.session.userTurnCount + 1}`,
    profile: input.route.profile,
    requestedBy: "runtime",
    requestSource: "runtime-multimodal-delegation",
    executionIntent: {
      attendance: "unattended",
      lifecycle: "automation",
    },
    requestedAuthority: input.route.requestedAuthority ?? "read_only",
    providerRoute: input.route.providerRoute,
    adapterKind: input.route.adapter.descriptor.adapterKind,
    executionMode: input.route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
    authority: input.route.authority,
    input: {
      summary: `Delegate ${input.requirements.requestedCapability} handling for multimodal runtime admission.`,
      prompt: buildManagedMultimodalDelegationPrompt(input.requirements, input.decision),
      resourceUris,
      context: {
        mode: input.route.contextMode ?? "resources",
        ...(input.route.agentProfile ?? input.route.route.agentProfile
          ? { agentProfile: input.route.agentProfile ?? input.route.route.agentProfile }
          : {}),
        ...(input.route.skills ? { skills: input.route.skills } : {}),
      },
      handoff: {
        roleIntent: `Satisfy ${input.requirements.requestedCapability} capability for a parent runtime route that cannot natively accept ${input.requirements.requiredInputModalities.join(", ")}.`,
        expectedEvidence: [
          "Structured summary grounded in the provided artifact URIs.",
          "Uncertainty and limitations for the delegated multimodal analysis.",
        ],
        requiredResultFields: ["summary", "resourceUris", "uncertainty", "limitations"],
        doneCriteria: [
          "Use only admitted resource URIs and configured child authority.",
          "Return a bounded handoff suitable for the parent session.",
        ],
        residualRiskRequired: true,
      },
    },
  });

  const startedAt = Date.now();
  const result = await service.invoke(request, input.route.adapter, {
    routeId: input.route.route.routeId,
    routeSource: "explicit-managed-route",
    routeHealth: {
      status: "healthy",
      reason: `${input.route.route.routeHealth.evidence} routeSource=explicit-managed-route.`,
    },
    providerModelProof: {
      status: "configured",
      source: "multimodal-delegation-route",
      requiresToolCalls: input.route.adapter.descriptor.adapterKind === "direct",
    },
    resourcePlane: {
      available: true,
      resourceUris,
      reason: "Runtime multimodal delegation admitted resource artifact URIs.",
    },
    childIdentity: {
      agentId: `${input.route.route.routeId}:${input.route.profile}`,
      ...(input.route.agentProfile ?? input.route.route.agentProfile
        ? { requestedAgentProfile: input.route.agentProfile ?? input.route.route.agentProfile }
        : {}),
    },
  });

  if (result.status === "denied") {
    throw new KilnError(
      "UNSUPPORTED_MODALITY",
      `Managed multimodal delegation denied: ${result.decision.reason}`,
      {
        context: {
          routeId: input.route.route.routeId,
          requestedCapability: input.requirements.requestedCapability,
          missingCapabilities: result.decision.missingCapabilities,
        },
      },
    );
  }

  const record = result.record;
  if (record.lifecycleState !== "completed") {
    throw new KilnError(
      "UNSUPPORTED_MODALITY",
      `Managed multimodal delegation failed closed: ${record.lifecycleState}`,
      {
        context: {
          routeId: input.route.route.routeId,
          requestedCapability: input.requirements.requestedCapability,
          invocationId: record.invocationId,
        },
      },
    );
  }

  const summary = record.resultHandoff?.summary ?? "Managed multimodal delegation completed without a summary.";
  const usage = readManagedInvocationUsage(record);
  return {
    parts: textParts(summary),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    toolExecution: {
      toolName: MANAGED_MULTIMODAL_DELEGATION_TOOL_NAME,
      durationMs: Date.now() - startedAt,
      success: true,
      output: summary,
      resultSummary: summary.slice(0, 200),
      metadata: {
        kind: "multimodal-delegation",
        invocationId: record.invocationId,
        routeId: input.route.route.routeId,
        routeSource: record.capabilitySnapshot.routeSource,
        parentSessionId: record.parentSessionId,
        parentTurnId: record.parentTurnId,
        profile: record.profile,
        providerRoute: record.providerRoute,
        adapterKind: record.adapterKind,
        executionMode: record.executionMode,
        childSessionId: record.childSessionId,
        childTurnId: record.childTurnId,
        resultHandoff: record.resultHandoff,
        transcript: record.transcript,
        capabilitySnapshot: record.capabilitySnapshot,
      },
    },
  };
}

function requireDelegationRoute(
  routes: readonly RuntimeMultimodalDelegationRoute[],
  routeId: string,
): RuntimeMultimodalDelegationRoute {
  const route = routes.find((candidate) => candidate.route.routeId === routeId);
  if (!route) {
    throw new KilnError(
      "UNSUPPORTED_MODALITY",
      `Managed multimodal delegation route '${routeId}' was selected but is not configured for runtime execution.`,
      { context: { routeId } },
    );
  }
  return route;
}

function requireTransformRoute(
  routes: readonly RuntimeMultimodalTransformRoute[],
  transform: MultimodalTransformCandidate["transform"],
): RuntimeMultimodalTransformRoute {
  const route = routes.find((candidate) => candidate.transform === transform);
  if (!route) {
    throw new KilnError(
      "UNSUPPORTED_MODALITY",
      `Multimodal transform '${transform}' was selected but is not configured for runtime execution.`,
      { context: { transform } },
    );
  }
  return route;
}

function assertTransformSourcesAreCurrentTurnParts(
  userParts: readonly ContentPart[],
  sourceParts: readonly RuntimeMultimodalTransformSourcePart[],
): void {
  const currentTopLevelParts = new Set(userParts);
  const nonRewritableCount = sourceParts.filter((part) => !currentTopLevelParts.has(part)).length;
  if (nonRewritableCount > 0) {
    throw new Error(
      `Transform source contains ${nonRewritableCount} artifact(s) outside the current top-level user turn; persisted history transform replay is not implemented.`,
    );
  }
}

function isTransformSourcePart(part: ContentPart): part is RuntimeMultimodalTransformSourcePart {
  return part.type === "image" || part.type === "file";
}

function buildManagedMultimodalDelegationPrompt(
  requirements: RuntimeMultimodalRequirements,
  decision: ReturnType<typeof planMultimodalRoute>,
): string {
  const artifactLines = requirements.artifacts.map((artifact) =>
    `- ${artifact.uri} (${artifact.modality}, ${artifact.mimeType}, ${artifact.sizeBytes} bytes, source=${artifact.source.kind}:${artifact.source.id})`
  );
  return [
    `Requested capability: ${requirements.requestedCapability}`,
    `Required modalities: ${requirements.requiredInputModalities.join(", ")}`,
    `Delegation reason: ${decision.reason.code} - ${decision.reason.message}`,
    "Artifacts:",
    ...artifactLines,
    "",
    "Return a bounded structured handoff with summary, resourceUris, uncertainty, and limitations. Do not request authority beyond the admitted route.",
  ].join("\n");
}

function readManagedInvocationUsage(record: ManagedAgentInvocationRecord): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
} {
  const token = (names: readonly string[]): number => {
    const item = record.usage?.tokenClasses.find((entry) => names.includes(entry.name));
    return typeof item?.value === "number" ? item.value : 0;
  };
  return {
    inputTokens: token(["input_tokens", "input"]),
    outputTokens: token(["output_tokens", "output"]),
    cacheReadTokens: token(["cache_read_tokens", "cache_read"]),
    cacheWriteTokens: token(["cache_write_tokens", "cache_write"]),
  };
}

function createRuntimeMultimodalDelegationInvocationId(
  sessionId: string,
  turnOrdinal: number,
  routeId: string,
): string {
  const safeRouteId = routeId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${sessionId}:turn:${turnOrdinal}:multimodal:${safeRouteId}`;
}

function runtimeMultimodalCredentialRouteIds(
  route: RuntimeMultimodalDelegationRoute,
): readonly string[] {
  const credentialRoute = route.authority.credentialRoute;
  if (credentialRoute.mode === "credentialless") {
    return [];
  }
  return [credentialRoute.routeId];
}

function multimodalRequirements(
  currentUserParts: readonly ContentPart[],
  messages: readonly { readonly role: "user" | "assistant"; readonly parts: readonly ContentPart[] }[],
): RuntimeMultimodalRequirements | undefined {
  const modalities = new Set<MultimodalTransportModality>();
  const artifacts: RuntimeMultimodalArtifact[] = [];
  let artifactIndex = 0;

  for (const part of currentUserParts) {
    collectPartModalities(part, modalities, artifacts, "uploaded-file", true, () => artifactIndex++);
  }

  for (const message of messages) {
    if (message.role === "user" && message.parts === currentUserParts) {
      continue;
    }
    const sourceKind = message.role === "user" ? "uploaded-file" : "managed-child";
    for (const part of message.parts) {
      collectPartModalities(part, modalities, artifacts, sourceKind, false, () => artifactIndex++);
    }
  }

  const requiredInputModalities = [...modalities];
  if (!requiredInputModalities.some((modality) => modality !== "text")) {
    return undefined;
  }

  return {
    requestedCapability: requestedCapabilityFor(requiredInputModalities),
    requiredInputModalities,
    artifacts,
    userParts: currentUserParts,
  };
}

function collectPartModalities(
  part: ContentPart,
  modalities: Set<MultimodalTransportModality>,
  artifacts: RuntimeMultimodalArtifact[],
  sourceKind: MultimodalArtifact["source"]["kind"],
  includeText: boolean,
  nextArtifactIndex: () => number,
): void {
  if (part.type === "tool_use") {
    return;
  }
  if (part.type === "tool_result") {
    for (const contentPart of part.contentParts ?? []) {
      collectPartModalities(contentPart, modalities, artifacts, "tool-output", false, nextArtifactIndex);
    }
    return;
  }
  if (part.type === "text") {
    if (includeText) {
      modalities.add("text");
    }
    return;
  }

  const modality = toTransportModality(part);
  modalities.add(modality);
  const artifactIndex = nextArtifactIndex();
  const fallbackUri = `kiln://runtime/session-artifact/${artifactIndex}`;
  const uri = part.artifactUri ?? fallbackUri;
  artifacts.push({
    uri,
    modality,
    mimeType: part.mimeType,
    sizeBytes: approximatePartSizeBytes(part),
    checksum: {
      algorithm: "sha256",
      value: `session-artifact-${artifactIndex}`,
    },
    source: {
      kind: sourceKind,
      id: `artifact-${artifactIndex}`,
    },
    retention: {
      scope: "session",
    },
    replay: {
      uri,
    },
    ...(part.type === "audio" && part.durationMs !== undefined ? { durationMs: part.durationMs } : {}),
    part,
  });
}

function requestedCapabilityFor(modalities: readonly MultimodalTransportModality[]): MultimodalCapability {
  if (modalities.includes("audio")) {
    return "transcription";
  }
  if (modalities.includes("document")) {
    return "document";
  }
  if (modalities.includes("screenshot")) {
    return "screenshot-review";
  }
  return "vision";
}

function toTransportModality(
  part: Extract<ContentPart, { type: "image" | "audio" | "file" }>,
): MultimodalTransportModality {
  if (part.type === "image") {
    return "image";
  }
  if (part.type === "audio") {
    return "audio";
  }
  return "document";
}

function approximatePartSizeBytes(
  part: Extract<ContentPart, { type: "image" | "audio" | "file" }>,
): number {
  if (part.data !== undefined) {
    return Math.max(1, Math.floor((part.data.length * 3) / 4));
  }
  if (part.url !== undefined) {
    return Math.max(1, part.url.length);
  }
  return 1;
}

function buildModelRoutingRationale(
  decision: RoutingDecision,
  hasTools: boolean,
  toolCount: number,
  complexity: ComplexityScore,
  perCallConfig: PerCallToolConfig | undefined,
): NonNullable<RoutingDecision["rationale"]> {
  const ranking = filterRankingEvidence(perCallConfig?.modelRoutingPolicy);
  return {
    selectedProvider: decision.provider,
    selectedModel: decision.model,
    canonicalModel: decision.canonicalModel,
    selectionMode: decision.selectionMode ?? "automatic",
    ...(decision.deliberationResolution
      ? { deliberationResolution: decision.deliberationResolution }
      : {}),
    routingReason: decision.reasoning,
    confidence: decision.confidence,
    routingTier: decision.routingTier,
    inputsUsed: {
      tenantId: perCallConfig?.tenantId ?? "default",
      complexityClass: complexity.class,
      complexityScore: complexity.score,
      hasTools,
      toolCount,
      requiresStreaming: false,
      ...(perCallConfig?.deliberationIntent ? { deliberationIntent: perCallConfig.deliberationIntent } : {}),
      ...(perCallConfig?.modelRoutingPolicy?.task ? { task: perCallConfig.modelRoutingPolicy.task } : {}),
      ...resolvePhaseAwareRoutingSignals(perCallConfig?.modelRoutingPolicy),
    },
    rankingEvidence: ranking.current,
    diagnostics: [
      ...ranking.diagnostics,
      ...deliberationDiagnostics(decision),
    ],
    ...(decision.selectionMode === "explicit-operator-only"
      ? { overrideSource: perCallConfig?.modelOverride?.source ?? "operator" }
      : {}),
  };
}

function resolvePhaseAwareRoutingSignals(
  policy: ModelRoutingPolicyConfig | undefined,
): Pick<ModelRoutingPolicyConfig,
  "phase" | "uncertainty" | "verificationNeed" | "retryRisk" | "cacheInvalidationCostUsd" | "verifierCostUsd"> {
  if (!policy) return {};
  for (const [name, value] of [
    ["uncertainty", policy.uncertainty],
    ["verificationNeed", policy.verificationNeed],
    ["retryRisk", policy.retryRisk],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`Model routing ${name} must be between 0 and 1.`);
    }
  }
  for (const [name, value] of [
    ["cacheInvalidationCostUsd", policy.cacheInvalidationCostUsd],
    ["verifierCostUsd", policy.verifierCostUsd],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Model routing ${name} must be a non-negative finite number.`);
    }
  }
  return {
    ...(policy.phase ? { phase: policy.phase } : {}),
    ...(policy.uncertainty !== undefined ? { uncertainty: policy.uncertainty } : {}),
    ...(policy.verificationNeed !== undefined ? { verificationNeed: policy.verificationNeed } : {}),
    ...(policy.retryRisk !== undefined ? { retryRisk: policy.retryRisk } : {}),
    ...(policy.cacheInvalidationCostUsd !== undefined
      ? { cacheInvalidationCostUsd: policy.cacheInvalidationCostUsd }
      : {}),
    ...(policy.verifierCostUsd !== undefined ? { verifierCostUsd: policy.verifierCostUsd } : {}),
  };
}

function deliberationDiagnostics(
  decision: RoutingDecision,
): NonNullable<RoutingDecision["rationale"]>["diagnostics"] {
  const resolution = decision.deliberationResolution;
  if (!resolution) {
    return [];
  }
  return [{
    code: `deliberation_${resolution.status}`,
    severity: resolution.status === "omitted" ? "warning" : "info",
    message: `Route ${decision.provider}/${decision.model} resolved deliberation as ${resolution.status}.`,
    provider: decision.provider,
    model: decision.model,
  }];
}

function deliberationCapabilitiesFor(
  provider: string,
  model: string,
  policy: ModelRoutingPolicyConfig | undefined,
): ModelDeliberationCapabilities | undefined {
  return policy?.routeCapabilities?.get(`${provider}/${model}`)?.deliberation
    ?? policy?.routeCapabilities?.get(model)?.deliberation;
}

function filterRankingEvidence(
  policy: ModelRoutingPolicyConfig | undefined,
): {
  readonly current: NonNullable<RoutingDecision["rationale"]>["rankingEvidence"];
  readonly diagnostics: NonNullable<RoutingDecision["rationale"]>["diagnostics"];
} {
  const evidence = policy?.rankingEvidence ?? [];
  const now = policy?.now ?? new Date();
  const current: ModelRoutingRankingEvidence[] = [];
  const diagnostics: ModelRoutingDiagnostic[] = [];
  for (const item of evidence) {
    if (item.expiresAt) {
      const expiresAt = Date.parse(item.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt < now.getTime()) {
        diagnostics.push({
          code: "stale_ranking_evidence",
          severity: "warning",
          message: `Ranking evidence from ${item.source} for ${item.provider}/${item.model} expired at ${item.expiresAt}.`,
          provider: item.provider,
          model: item.model,
        });
        continue;
      }
    }
    current.push(item);
  }
  return { current, diagnostics };
}

export function appendOperatorSurfaceToolDirective(
  system: string,
  tools: readonly ToolDefinition[] | undefined,
): string {
  if (!tools?.some(isOperatorSurfaceTool)) {
    return system;
  }
  return `${system}

--- Operator Surface Tools ---
This turn is attached to a live operator surface. Operator tools change the visible CLI, TUI, or GUI state for the current operator; they are not source-code edits.
When the operator asks to change the live UI state, such as theme, panel, focus, browser, or device/simulator state, use the matching operator_* tool instead of proposing repository or config changes.
For theme requests, call operator_set_theme. Use scope="session" unless the operator explicitly asks to save or persist the preference.
Do not claim the surface changed unless the operator tool returns a successful acknowledgement.`;
}

function isOperatorSurfaceTool(tool: ToolDefinition): boolean {
  return tool.name.startsWith("operator_") || tool.tags?.has("operator-ui") === true;
}

function mergeAdditionalTools(
  baseTools: readonly ToolDefinition[] | undefined,
  additionalTools: readonly ToolDefinition[] | undefined,
): readonly ToolDefinition[] | undefined {
  if (!additionalTools || additionalTools.length === 0) {
    return baseTools;
  }
  const existing = baseTools ?? [];
  const existingNames = new Set(existing.map((tool) => tool.name));
  const additions = additionalTools.filter((tool) => !existingNames.has(tool.name));
  return additions.length > 0 ? [...existing, ...additions] : existing;
}
