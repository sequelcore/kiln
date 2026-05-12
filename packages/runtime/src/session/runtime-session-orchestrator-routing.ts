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
  ReasoningEffort,
} from "@kilnai/core";
import { appendExecutionIdentity, extractText, resolveExecutionIdentity, scoreComplexity } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { ModelRoutingPolicyConfig, OrchestratorDeps, PerCallToolConfig } from "./runtime-session-orchestrator.types.js";

export interface RuntimeSessionRoutingResolution {
  readonly effectiveProvider: ProviderAdapter;
  readonly effectiveTools: readonly ToolDefinition[] | undefined;
  readonly hasTools: boolean;
  readonly invocationSystem: string;
  readonly executionIdentity?: ExecutionIdentity;
  readonly routingDecision?: RoutingDecision;
}

export async function resolveRuntimeSessionRouting(
  deps: OrchestratorDeps,
  session: RuntimeSession,
  userParts: readonly ContentPart[],
  baseSystem: string,
  baseTools: readonly ToolDefinition[] | undefined,
  perCallConfig: PerCallToolConfig | undefined,
  emitModelRouted: (sessionId: string, decision: RoutingDecision) => void,
): Promise<RuntimeSessionRoutingResolution> {
  const hasBuiltins = (deps.builtinTools?.size ?? 0) > 0;
  const hasMcp = (deps.mcpClients?.length ?? 0) > 0;
  const userText = extractText(userParts);

  let mergedTools = mergeAdditionalTools(baseTools, perCallConfig?.additionalTools);
  if (perCallConfig?.toolAllowlist) {
    mergedTools = mergedTools?.filter((tool) => perCallConfig.toolAllowlist?.has(tool.name));
  }
  const hasToolSurface = (mergedTools?.length ?? 0) > 0 && (hasBuiltins || hasMcp);
  let routingComplexity = scoreComplexity({
    messageText: userText,
    toolCount: mergedTools?.length ?? 0,
    turnDepth: session.messageCount,
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
          turnDepth: session.messageCount,
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

  if (perCallConfig?.modelOverride) {
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
      selectionMode: "manual_override",
    };
  } else if (deps.modelRouter) {
    try {
      const decision = deps.modelRouter.route({
        tenantId: perCallConfig?.tenantId ?? "default",
        complexity: routingComplexity,
        hasTools: hasToolSurface,
        toolCount: mergedTools?.length ?? 0,
        requiresStreaming: false,
        ...(perCallConfig?.reasoningEffort ? { requestedReasoningEffort: perCallConfig.reasoningEffort } : {}),
        ...(perCallConfig?.modelRoutingPolicy?.task ? { task: perCallConfig.modelRoutingPolicy.task } : {}),
        ...(perCallConfig?.modelRoutingPolicy?.rankingEvidence
          ? { rankingEvidence: perCallConfig.modelRoutingPolicy.rankingEvidence }
          : {}),
      });
      routingDecision = {
        ...decision,
        selectionMode: "auto",
      };

      const poolProvider = deps.providerPool?.get(decision.provider);
      if (poolProvider) {
        effectiveProvider = poolProvider;
        routedProviderIdentity = decision.provider;
        routedModelIdentity = decision.model;
      }
    } catch {
      // Fail-open: use default provider if routing fails.
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

  if (routingDecision) {
    validateRequestedReasoningEffort(routingDecision, perCallConfig?.reasoningEffort, perCallConfig?.modelRoutingPolicy);
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
      reasoningEffort: perCallConfig?.reasoningEffort,
      rationale: buildModelRoutingRationale(
        routingDecision,
        hasToolSurface,
        mergedTools?.length ?? 0,
        routingComplexity,
        perCallConfig,
      ),
    };
    emitModelRouted(session.id, routingDecision);
  }

  const invocationSystem = appendOperatorSurfaceToolDirective(
    appendExecutionIdentity(
      baseSystem,
      executionIdentity,
    ),
    mergedTools,
  );

  return {
    effectiveProvider,
    effectiveTools: mergedTools,
    hasTools: (mergedTools?.length ?? 0) > 0 && (hasBuiltins || hasMcp),
    invocationSystem,
    executionIdentity,
    routingDecision,
  };
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
    selectionMode: decision.selectionMode ?? "auto",
    reasoningEffort: perCallConfig?.reasoningEffort,
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
      ...(perCallConfig?.reasoningEffort ? { requestedReasoningEffort: perCallConfig.reasoningEffort } : {}),
      ...(perCallConfig?.modelRoutingPolicy?.task ? { task: perCallConfig.modelRoutingPolicy.task } : {}),
    },
    rankingEvidence: ranking.current,
    diagnostics: [
      ...ranking.diagnostics,
      ...reasoningEffortDiagnostics(decision, perCallConfig?.reasoningEffort, perCallConfig?.modelRoutingPolicy),
    ],
    ...(decision.selectionMode === "manual_override"
      ? { overrideSource: perCallConfig?.modelOverride?.source ?? "operator" }
      : {}),
  };
}

function validateRequestedReasoningEffort(
  decision: RoutingDecision,
  requested: ReasoningEffort | undefined,
  policy: ModelRoutingPolicyConfig | undefined,
): void {
  if (!requested) {
    return;
  }
  const supported = supportedReasoningEffortsFor(decision, policy);
  if (!supported || supported.includes(requested)) {
    return;
  }
  throw new Error(`Reasoning effort '${requested}' is not supported by ${decision.provider}/${decision.model}`);
}

function reasoningEffortDiagnostics(
  decision: RoutingDecision,
  requested: ReasoningEffort | undefined,
  policy: ModelRoutingPolicyConfig | undefined,
): NonNullable<RoutingDecision["rationale"]>["diagnostics"] {
  if (!requested) {
    return [];
  }
  const supported = supportedReasoningEffortsFor(decision, policy);
  if (!supported) {
    return [{
      code: "reasoning_effort_unadvertised",
      severity: "warning",
      message: `Route ${decision.provider}/${decision.model} did not advertise reasoning effort support.`,
      provider: decision.provider,
      model: decision.model,
    }];
  }
  return [{
    code: "reasoning_effort_supported",
    severity: "info",
    message: `Route ${decision.provider}/${decision.model} supports requested reasoning effort '${requested}'.`,
    provider: decision.provider,
    model: decision.model,
  }];
}

function supportedReasoningEffortsFor(
  decision: RoutingDecision,
  policy: ModelRoutingPolicyConfig | undefined,
): readonly ReasoningEffort[] | undefined {
  return policy?.routeCapabilities?.get(`${decision.provider}/${decision.model}`)?.supportedReasoningEfforts
    ?? policy?.routeCapabilities?.get(decision.model)?.supportedReasoningEfforts;
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
