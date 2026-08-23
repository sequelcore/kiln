import { createHash } from "node:crypto";
import type {
  EventBus,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  MultimodalRoutedEvent,
  RoutingDecision,
  ExecutionIdentity,
  MultimodalRoutingDecision,
  MultimodalCapability,
  MultimodalTransportModality,
  ProviderRequestEvidence,
  ProviderRequestToolMaterializationDecisionEvidence,
  ProviderRequestToolProjectionEvidence,
  ContextUsageRawEvidence,
  ConversationProjectionEvidence,
  EffectivePromptEvidence,
  EffectivePromptManifest,
  CommunicationResolution,
} from "@kilnai/core";
import {
  computeUsageCostUsd,
  resolveExecutionCostEvidence,
  resolveExecutionPricing,
  toEffectivePromptEvidence,
} from "@kilnai/core";
import type { ModelPricing } from "@kilnai/core";

export interface OrchestratorUsageSnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface OrchestratorResponseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly contextUsage?: ContextUsageRawEvidence;
}

export interface ProviderRequestRegionEvidence {
  readonly systemBytes: number;
  readonly messageBytes: number;
  readonly toolSchemaBytes: number;
  readonly systemHash: string;
  readonly messageHash: string;
  readonly toolSchemaHash: string;
  readonly stablePrefixHash: string;
  readonly stablePrefixBytes: number;
  readonly stablePrefixRegionCount: number;
  readonly volatileRegionBytes: number;
  readonly cacheRegions: readonly {
    readonly source: ProviderRequestCacheRegionSource;
    readonly stability: "stable" | "volatile";
    readonly bytes: number;
    readonly hash: string;
    readonly includedInStablePrefix: boolean;
  }[];
  readonly cachePartition: ProviderRequestCachePartitionEvidence;
  readonly toolCount: number;
  readonly toolProjection?: ProviderRequestToolProjectionEvidence;
  readonly conversationProjection?: ConversationProjectionEvidence;
  readonly effectivePrompt?: EffectivePromptEvidence;
  readonly communicationResolution?: CommunicationResolution;
  readonly stopReason?: string;
}

type ProviderRequestCachePartitionDimensionSource =
  | "tenant"
  | "route"
  | "policy"
  | "authority";

type ProviderRequestCachePartitionEvidence = {
  readonly hash: string;
  readonly dimensions: readonly {
    readonly source: ProviderRequestCachePartitionDimensionSource;
    readonly hash: string;
    readonly evidenceBasis: string;
  }[];
};

type ProviderRequestCacheRegionSource =
  | "tool_schema"
  | "system"
  | "messages";

type InternalProviderRequestCacheRegion = {
  readonly source: ProviderRequestCacheRegionSource;
  readonly stability: "stable" | "volatile";
  readonly bytes: number;
  readonly hash: string;
  readonly serialized: string;
};

export function measureProviderRequestRegions(input: {
  readonly system: string;
  readonly messages: unknown;
  readonly tools?: unknown;
  readonly toolCount: number;
  readonly toolProjection?: ProviderRequestToolProjectionEvidence;
  readonly conversationProjection?: ConversationProjectionEvidence;
  readonly effectivePrompt?: EffectivePromptManifest;
  readonly communicationResolution?: CommunicationResolution;
  readonly stopReason?: string;
  readonly requestRegionOrder?: readonly ProviderRequestCacheRegionSource[];
  readonly cachePartition?: ProviderRequestCachePartitionInput;
}): ProviderRequestRegionEvidence {
  if (input.effectivePrompt && input.effectivePrompt.finalPrompt !== input.system) {
    throw new Error("Effective prompt manifest must describe the exact provider system prompt");
  }
  const system = serializeForEvidence(input.system);
  const messages = serializeForEvidence(input.messages);
  const tools = serializeForEvidence(input.tools ?? []);
  const regionsBySource: Record<ProviderRequestCacheRegionSource, InternalProviderRequestCacheRegion> = {
    system: createCacheRegion("system", "stable", system),
    messages: createCacheRegion("messages", "volatile", messages),
    tool_schema: createCacheRegion("tool_schema", "stable", tools),
  };
  const regionOrder: readonly ProviderRequestCacheRegionSource[] =
    input.requestRegionOrder ?? ["tool_schema", "system", "messages"];
  const cacheRegions: readonly InternalProviderRequestCacheRegion[] = regionOrder
    .map((source) => requireCacheRegion(regionsBySource, source));
  const stablePrefixRegions = leadingStableRegions(cacheRegions);
  const stablePrefixBytes = stablePrefixRegions.reduce((total, region) => total + region.bytes, 0);
  const cacheRegionsWithPrefix = cacheRegions.map((region, index) => ({
    source: region.source,
    stability: region.stability,
    bytes: region.bytes,
    hash: region.hash,
    includedInStablePrefix: index < stablePrefixRegions.length,
  }));
  const volatileRegionBytes = cacheRegionsWithPrefix
    .filter((region) => !region.includedInStablePrefix)
    .reduce((total, region) => total + region.bytes, 0);
  return {
    systemBytes: byteLength(system),
    messageBytes: byteLength(messages),
    toolSchemaBytes: byteLength(tools),
    systemHash: hashSerialized(system),
    messageHash: hashSerialized(messages),
    toolSchemaHash: hashSerialized(tools),
    stablePrefixHash: hashStablePrefix(stablePrefixRegions),
    stablePrefixBytes,
    stablePrefixRegionCount: stablePrefixRegions.length,
    volatileRegionBytes,
    cacheRegions: cacheRegionsWithPrefix,
    cachePartition: buildCachePartitionEvidence(input.cachePartition),
    toolCount: input.toolCount,
    ...(input.toolProjection ? { toolProjection: input.toolProjection } : {}),
    ...(input.conversationProjection ? { conversationProjection: input.conversationProjection } : {}),
    ...(input.effectivePrompt
      ? { effectivePrompt: toEffectivePromptEvidence(input.effectivePrompt) }
      : {}),
    ...(input.communicationResolution
      ? { communicationResolution: input.communicationResolution }
      : {}),
    ...(input.stopReason ? { stopReason: input.stopReason } : {}),
  };
}

export function buildProviderRequestToolProjectionEvidence(input: {
  readonly projectedTools: readonly { readonly name: string }[] | undefined;
  readonly materializableTools: ReadonlyMap<string, unknown> | undefined;
  readonly materializationDecisions: readonly ProviderRequestToolMaterializationDecisionEvidence[];
}): ProviderRequestToolProjectionEvidence {
  const projectedNames = input.projectedTools?.map((tool) => tool.name) ?? [];
  const materializableNames = input.materializableTools
    ? [...input.materializableTools.keys()]
    : [];
  return {
    projected: toolProjectionSet(projectedNames),
    materializable: toolProjectionSet(materializableNames),
    materializedAdditions: input.materializationDecisions
      .filter((decision) => decision.decision === "materialized")
      .map((decision) => decision.toolName),
    materializationDecisions: input.materializationDecisions,
  };
}

export interface ProviderRequestCachePartitionInput {
  readonly tenantId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly canonicalModel?: string;
  readonly deliberationResolution?: unknown;
  readonly communicationResolution?: unknown;
  readonly policyIdentity?: unknown;
  readonly authority?: {
    readonly admissionId?: `sha256:${string}`;
    readonly effectiveTurnAuthority?: unknown;
    readonly authorityContext?: unknown;
    readonly requestedAuthority?: string;
    readonly admittedAuthority?: string;
    readonly sourcePolicy?: string;
    readonly completeness?: string;
    readonly sandboxProjection?: string;
    readonly policyInputs?: readonly unknown[];
  };
}

export class RuntimeSessionExecutionTelemetry {
  private executionIdentity: ExecutionIdentity | undefined;
  private readonly providerRequests: ProviderRequestEvidence[] = [];

  private totals: OrchestratorUsageSnapshot = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  constructor(
    executionIdentity: ExecutionIdentity | undefined,
    private readonly eventBus?: EventBus,
  ) {
    this.executionIdentity = executionIdentity;
  }

  get currentModel(): string | undefined {
    return this.executionIdentity?.model;
  }

  recordResponse(
    sessionId: string,
    usage: OrchestratorResponseUsage,
    agentId?: string,
    request?: ProviderRequestRegionEvidence,
  ): OrchestratorUsageSnapshot {
    this.totals = {
      inputTokens: this.totals.inputTokens + usage.inputTokens,
      outputTokens: this.totals.outputTokens + usage.outputTokens,
      cacheReadTokens: this.totals.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: this.totals.cacheWriteTokens + usage.cacheWriteTokens,
    };
    if (request) {
      this.providerRequests.push({
        requestIndex: this.providerRequests.length,
        providerId: this.executionIdentity?.provider ?? "unknown",
        modelId: this.executionIdentity?.model ?? "unknown",
        ...usage,
        cumulativeInputTokens: this.totals.inputTokens,
        cumulativeOutputTokens: this.totals.outputTokens,
        cumulativeCacheReadTokens: this.totals.cacheReadTokens,
        cumulativeCacheWriteTokens: this.totals.cacheWriteTokens,
        ...request,
      });
    }
    this.emitCostUpdate(sessionId, agentId);
    return this.snapshot();
  }

  snapshot(): OrchestratorUsageSnapshot {
    return { ...this.totals };
  }

  requestSnapshot(): readonly ProviderRequestEvidence[] {
    return this.providerRequests.map((request) => ({ ...request }));
  }

  emitModelRouted(sessionId: string, decision: RoutingDecision): void {
    this.executionIdentity = {
      source: "runtime-routed",
      provider: decision.provider,
      model: decision.model,
      canonicalModel: decision.canonicalModel,
      billingMode: decision.billingMode,
    };
    const event: ModelRoutedEvent = {
      type: "model_routed",
      model: decision.model,
      provider: decision.provider,
      canonicalModel: decision.canonicalModel,
      billingMode: decision.billingMode,
      routingTier: decision.routingTier,
      reason: decision.reasoning,
      selectionMode: decision.selectionMode,
      deliberationResolution: decision.deliberationResolution,
      rationale: decision.rationale,
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
  }

  emitMultimodalRouted(
    sessionId: string,
    input: {
      readonly provider: string;
      readonly model: string;
      readonly requestedCapability: MultimodalCapability;
      readonly requiredModalities: readonly MultimodalTransportModality[];
      readonly artifactUris: readonly string[];
      readonly decision: MultimodalRoutingDecision;
    },
  ): void {
    const delegated = input.decision.delegation;
    const event: MultimodalRoutedEvent = {
      type: "multimodal_routed",
      provider: delegated?.provider ?? input.provider,
      model: delegated?.model ?? input.model,
      strategy: input.decision.strategy,
      reasonCode: input.decision.reason.code,
      reason: input.decision.reason.message,
      requestedCapability: input.requestedCapability,
      requiredModalities: input.requiredModalities,
      artifactUris: input.artifactUris,
      ...(delegated ? { delegation: delegated } : {}),
      diagnostics: input.decision.diagnostics,
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
  }

  emitError(sessionId: string, message: string): void {
    const event: ErrorEvent = {
      type: "error",
      message,
      code: "MODE_B_ERROR",
      taskId: null,
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
  }

  private emitCostUpdate(sessionId: string, agentId?: string): void {
    const totalCostUsd = this.computeTotalCostUsd(this.totals);
    const costEvidence = resolveExecutionCostEvidence(this.totals, this.executionIdentity);
    const model = this.executionIdentity?.model ?? this.executionIdentity?.canonicalModel ?? "unknown";

    const event: CostUpdateEvent = {
      type: "cost_update",
      provider: this.executionIdentity?.provider,
      model: this.executionIdentity?.model,
      canonicalModel: this.executionIdentity?.canonicalModel,
      billingMode: this.executionIdentity?.billingMode,
      inputTokens: this.totals.inputTokens,
      outputTokens: this.totals.outputTokens,
      cacheReadTokens: this.totals.cacheReadTokens,
      cacheWriteTokens: this.totals.cacheWriteTokens,
      totalCostUsd,
      costEvidence,
      byRoleModel: {
        [`assistant:${model}`]: {
          model,
          provider: this.executionIdentity?.provider,
          canonicalModel: this.executionIdentity?.canonicalModel,
          billingMode: this.executionIdentity?.billingMode,
          calls: 1,
          costUsd: totalCostUsd,
          costEvidence,
        },
      },
      timestamp: new Date(),
      sessionId,
      ...(agentId ? { agentId } : {}),
    };
    this.eventBus?.emit(event);
  }

  private computeTotalCostUsd(usage: OrchestratorUsageSnapshot): number {
    const pricing = this.resolvedPricing;
    if (!pricing && this.executionIdentity?.billingMode !== "subscription" && this.executionIdentity?.billingMode !== "free") {
      return 0;
    }
    return computeUsageCostUsd(usage, this.executionIdentity);
  }

  private get resolvedPricing(): ModelPricing | undefined {
    if (!this.executionIdentity) {
      return undefined;
    }
    if (
      this.executionIdentity.billingMode === "subscription" ||
      this.executionIdentity.billingMode === "free"
    ) {
      return undefined;
    }
    return resolveExecutionPricing(this.executionIdentity);
  }
}

function serializeForEvidence(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "";
}

function byteLength(serialized: string): number {
  return Buffer.byteLength(serialized, "utf8");
}

function hashSerialized(serialized: string): string {
  return `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
}

function toolProjectionSet(names: readonly string[]): ProviderRequestToolProjectionEvidence["projected"] {
  return {
    names,
    count: names.length,
    hash: hashSerialized(JSON.stringify(names)),
  };
}

function createCacheRegion(
  source: ProviderRequestCacheRegionSource,
  stability: "stable" | "volatile",
  serialized: string,
): InternalProviderRequestCacheRegion {
  return {
    source,
    stability,
    bytes: byteLength(serialized),
    hash: hashSerialized(serialized),
    serialized,
  };
}

function leadingStableRegions<T extends { readonly stability: "stable" | "volatile" }>(
  regions: readonly T[],
): readonly T[] {
  const prefix: T[] = [];
  for (const region of regions) {
    if (region.stability !== "stable") {
      break;
    }
    prefix.push(region);
  }
  return prefix;
}

function hashStablePrefix(
  regions: readonly {
    readonly source: ProviderRequestCacheRegionSource;
    readonly hash: string;
    readonly serialized: string;
  }[],
): string {
  return hashSerialized(JSON.stringify(regions.map((region) => ({
    source: region.source,
    hash: region.hash,
    content: region.serialized,
  }))));
}

function buildCachePartitionEvidence(
  input: ProviderRequestCachePartitionInput | undefined,
): ProviderRequestCachePartitionEvidence {
  const tenantValue = {
    tenantId: input?.tenantId ?? "unknown",
  };
  const routeValue = {
    provider: input?.provider ?? "unknown",
    model: input?.model ?? "unknown",
    canonicalModel: input?.canonicalModel ?? "unknown",
    deliberationResolution: input?.deliberationResolution ?? { status: "not-requested" },
    communicationResolution: input?.communicationResolution ?? { status: "not-requested" },
  };
  const policyValue = input?.policyIdentity ?? { policy: "default" };
  const authorityValue = input?.authority ?? { authority: "unknown" };
  const dimensions = [
    cachePartitionDimension("tenant", tenantValue, "session tenant identity"),
    cachePartitionDimension("route", routeValue, "provider route identity"),
    cachePartitionDimension("policy", policyValue, "efficiency and routing policy identity"),
    cachePartitionDimension("authority", authorityValue, "effective turn authority scope"),
  ] satisfies readonly ProviderRequestCachePartitionEvidence["dimensions"][number][];
  return {
    hash: hashSerialized(stableStringify(dimensions.map((dimension) => ({
      source: dimension.source,
      hash: dimension.hash,
    })))),
    dimensions,
  };
}

function cachePartitionDimension(
  source: ProviderRequestCachePartitionDimensionSource,
  value: unknown,
  evidenceBasis: string,
): ProviderRequestCachePartitionEvidence["dimensions"][number] {
  return {
    source,
    hash: hashSerialized(stableStringify(value)),
    evidenceBasis,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function requireCacheRegion(
  regionsBySource: Readonly<Record<ProviderRequestCacheRegionSource, InternalProviderRequestCacheRegion>>,
  source: ProviderRequestCacheRegionSource,
): InternalProviderRequestCacheRegion {
  return regionsBySource[source];
}
