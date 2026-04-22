import type {
  ProviderAdapter,
  ContentPart,
  ToolDefinition,
  RoutingDecision,
  Capability,
  ExecutionIdentity,
} from "@kilnai/core";
import { appendExecutionIdentity, extractText, resolveExecutionIdentity, scoreComplexity } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { OrchestratorDeps, PerCallToolConfig } from "./runtime-session-orchestrator.types.js";

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

  let mergedTools = mergeAdditionalTools(baseTools, perCallConfig?.additionalTools);
  const hasToolSurface = (mergedTools?.length ?? 0) > 0 && (hasBuiltins || hasMcp);

  if (deps.toolRAG && deps.capabilityMap && mergedTools && mergedTools.length > 30) {
    try {
      const userText = extractText(userParts);
      const allCapabilities = Array.from(deps.capabilityMap.values());
      const selected = await deps.toolRAG.selectTools(userText, allCapabilities);
      if (selected.length > 0) {
        const selectedNames = new Set(selected.map((capability: Capability) => capability.name));
        mergedTools = mergedTools.filter((tool) => selectedNames.has(tool.name));
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
    };
  } else if (deps.modelRouter) {
    try {
      const userText = extractText(userParts);
      const complexity = scoreComplexity({
        messageText: userText,
        toolCount: mergedTools?.length ?? 0,
        turnDepth: session.messageCount,
      });
      const decision = deps.modelRouter.route({
        tenantId: perCallConfig?.tenantId ?? "default",
        complexity,
        hasTools: hasToolSurface,
        toolCount: mergedTools?.length ?? 0,
        requiresStreaming: false,
      });
      routingDecision = decision;

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
    emitModelRouted(session.id, routingDecision);
  }

  const invocationSystem = appendExecutionIdentity(
    baseSystem,
    executionIdentity,
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
