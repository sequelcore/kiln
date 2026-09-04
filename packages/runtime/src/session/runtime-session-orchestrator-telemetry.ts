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
  ProviderRequestPhysicalAttemptEvidence,
  ProviderRequestToolMaterializationDecisionEvidence,
  ProviderRequestToolProjectionEvidence,
  ContextUsageRawEvidence,
  ConversationProjectionEvidence,
  EffectivePromptEvidence,
  EffectivePromptManifest,
  CommunicationResolution,
  ProviderTransportEvent,
  ProviderTransportObserver,
  DeliberationResolution,
  ToolDefinition,
  ToolDefinitionDigest,
} from "@kilnai/core";
import {
  computeUsageCostUsd,
  digestToolDefinition,
  resolveExecutionCostEvidence,
  resolveExecutionPricing,
  toEffectivePromptEvidence,
  estimateTextTokens,
} from "@kilnai/core";
import type { ModelPricing } from "@kilnai/core";
import type { MaterializableRuntimeToolBinding } from "./progressive-tool-admission.js";

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
  readonly durationMs?: number;
}

export class RuntimeProviderRequestAttemptTracker implements ProviderTransportObserver {
  private readonly attempts: ProviderRequestPhysicalAttemptEvidence[] = [];

  constructor(private readonly downstream?: ProviderTransportObserver) {}

  onEvent(event: ProviderTransportEvent): void {
    try {
      this.downstream?.onEvent(event);
    } catch {
      // External diagnostic observers cannot suppress Runtime-owned evidence.
    }
    if (event.type === "request_started") {
      this.attempts.push({
        attempt: this.attempts.length + 1,
        retry: this.attempts.length > 0,
        outcome: "unknown",
      });
      return;
    }
    const index = this.attempts.length - 1;
    const current = this.attempts[index];
    if (!current) return;
    if (event.type === "response_headers") {
      this.attempts[index] = { ...current, outcome: "response_received", responseStatus: event.status };
      return;
    }
    if (event.type === "request_completed") {
      this.attempts[index] = { ...current, outcome: "completed" };
      return;
    }
    if (event.type === "request_failed") {
      this.attempts[index] = { ...current, outcome: "failed", failurePhase: event.phase };
    }
  }

  snapshot(): readonly ProviderRequestPhysicalAttemptEvidence[] {
    return this.attempts.map((attempt) => ({ ...attempt }));
  }
}

export interface ProviderRequestRegionEvidence {
  readonly systemBytes: number;
  readonly messageBytes: number;
  readonly toolSchemaBytes: number;
  readonly tokenAttributionEstimate: {
    readonly measurement: "estimated";
    readonly requiredPromptTokens: number;
    readonly governedContextTokens: number;
    readonly toolSchemaTokens: number;
    readonly conversationTokens: number;
    readonly toolResultTokens: number;
    readonly totalInputTokens: number;
  };
  readonly outputReserveTokens?: number;
  readonly physicalAttempts?: readonly ProviderRequestPhysicalAttemptEvidence[];
  readonly deliberation?: NonNullable<ProviderRequestEvidence["deliberation"]>;
  readonly authority?: NonNullable<ProviderRequestEvidence["authority"]>;
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
  | "account"
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
  readonly outputReserveTokens?: number;
  readonly physicalAttempts?: readonly ProviderRequestPhysicalAttemptEvidence[];
  readonly requestRegionOrder?: readonly ProviderRequestCacheRegionSource[];
  readonly cachePartition?: ProviderRequestCachePartitionInput;
}): ProviderRequestRegionEvidence {
  if (input.effectivePrompt && input.effectivePrompt.finalPrompt !== input.system) {
    throw new Error("Effective prompt manifest must describe the exact provider system prompt");
  }
  const system = serializeForEvidence(input.system);
  const messages = serializeForEvidence(input.messages);
  const tools = serializeForEvidence(input.tools ?? []);
  const systemEstimatedTokens = input.effectivePrompt?.estimatedTokens ?? estimateTextTokens(input.system);
  const governedContextTokens = input.effectivePrompt?.components
    .filter((component) => component.provenance.auditDecision === "admitted")
    .reduce((total, component) => total + component.estimatedTokens, 0) ?? 0;
  const requiredPromptTokens = Math.max(0, systemEstimatedTokens - governedContextTokens);
  const messageEstimatedTokens = estimateTextTokens(messages);
  const toolResultTokens = input.conversationProjection?.projectedToolResultTokens ?? 0;
  const conversationTokens = Math.max(0, messageEstimatedTokens - toolResultTokens);
  const toolSchemaTokens = estimateTextTokens(tools);
  const totalInputTokens = requiredPromptTokens
    + governedContextTokens
    + toolSchemaTokens
    + conversationTokens
    + toolResultTokens;
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
    tokenAttributionEstimate: {
      measurement: "estimated",
      requiredPromptTokens,
      governedContextTokens,
      toolSchemaTokens,
      conversationTokens,
      toolResultTokens,
      totalInputTokens,
    },
    ...(input.outputReserveTokens === undefined ? {} : { outputReserveTokens: input.outputReserveTokens }),
    ...(input.physicalAttempts?.length
      ? { physicalAttempts: input.physicalAttempts.map((attempt) => ({ ...attempt })) }
      : {}),
    ...(input.cachePartition?.deliberationResolution
      && "selectedLevel" in input.cachePartition.deliberationResolution
      ? {
          deliberation: {
            status: input.cachePartition.deliberationResolution.status,
            selectedLevel: input.cachePartition.deliberationResolution.selectedLevel,
          },
        }
      : {}),
    ...(input.cachePartition?.authority?.requestedAuthority
      && input.cachePartition.authority.admittedAuthority
      && input.cachePartition.authority.completeness
      ? {
          authority: {
            requestedAuthority: input.cachePartition.authority.requestedAuthority,
            admittedAuthority: input.cachePartition.authority.admittedAuthority,
            completeness: input.cachePartition.authority.completeness,
          },
        }
      : {}),
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
  readonly projectedTools: readonly ToolDefinition[] | undefined;
  readonly materializableTools: ReadonlyMap<string, unknown> | undefined;
  readonly materializableToolBindings?: ReadonlyMap<string, MaterializableRuntimeToolBinding>;
  readonly authorityAdmissionId?: `sha256:${string}`;
  readonly currentCatalogSnapshotId?: `sha256:${string}`;
  readonly materializationDecisions: readonly ProviderRequestToolMaterializationDecisionEvidence[];
}): ProviderRequestToolProjectionEvidence {
  const projectedNames = input.projectedTools?.map((tool) => tool.name) ?? [];
  // The definition map is already scoped to the current authority allowlist
  // by the orchestrator. Prefer it over the raw binding map so an admitted
  // binding that is outside this turn cannot leak its canonical name.
  const materializableNames = input.materializableTools
    ? [...input.materializableTools.keys()]
    : input.materializableToolBindings
      ? [...input.materializableToolBindings.keys()]
      : [];
  verifyLexicalMaterializationDecisions({
    projectedTools: input.projectedTools,
    materializationDecisions: input.materializationDecisions,
    materializableToolBindings: input.materializableToolBindings,
    authorityAdmissionId: input.authorityAdmissionId,
    currentCatalogSnapshotId: input.currentCatalogSnapshotId,
  });
  return {
    projected: toolProjectionSet(projectedNames),
    materializable: toolProjectionSet(materializableNames),
    materializedAdditions: input.materializationDecisions
      .filter((decision) => decision.decision === "materialized")
      .map((decision) => decision.toolName),
    materializationDecisions: input.materializationDecisions,
  };
}

/**
 * Materialization evidence is model-facing only after the selected lexical
 * definition has crossed the same projection boundary as the provider
 * request. Verify that claim against the actual ToolDefinition array instead
 * of trusting a copied name or digest from the search result.
 *
 * Capability Fabric materializations intentionally do not enter this check:
 * they carry their own generation/selection evidence and use a different
 * source tool name. Legacy lexical decisions are identified by the canonical
 * `tool_catalog_search` source and must carry the Core-linked binding.
 */
export function verifyLexicalMaterializationDecisions(input: {
  readonly projectedTools: readonly ToolDefinition[] | undefined;
  readonly materializationDecisions: readonly ProviderRequestToolMaterializationDecisionEvidence[];
  readonly materializableToolBindings?: ReadonlyMap<string, MaterializableRuntimeToolBinding>;
  readonly authorityAdmissionId?: `sha256:${string}`;
  readonly currentCatalogSnapshotId?: `sha256:${string}`;
}): void {
  const lexicalDecisions = input.materializationDecisions.filter((decision) =>
    decision.sourceToolName === "tool_catalog_search");
  const materializedLexicalDecisions = lexicalDecisions.filter((decision) =>
    decision.decision === "materialized" || decision.decision === "already_materialized");

  const materializedNames = new Set<string>();
  for (const decision of materializedLexicalDecisions) {
    if (decision.toolName === "<redacted>" || decision.lexicalBinding === undefined) {
      throw new Error("Lexical materialization telemetry is missing authority-linked binding evidence.");
    }
    materializedNames.add(decision.toolName);
    if (input.authorityAdmissionId === undefined
      || decision.lexicalBinding.authorityAdmissionId !== input.authorityAdmissionId) {
      throw new Error(`Lexical materialization telemetry authority admission mismatch for '${decision.toolName}'.`);
    }
    if (input.currentCatalogSnapshotId === undefined
      || decision.lexicalBinding.catalogSnapshotId !== input.currentCatalogSnapshotId) {
      throw new Error(`Lexical materialization telemetry catalog snapshot mismatch for '${decision.toolName}'.`);
    }
    const binding = input.materializableToolBindings?.get(decision.toolName);
    if (!binding
      || binding.definition.name !== decision.toolName
      || binding.definitionDigest !== decision.lexicalBinding.toolDefinitionDigest
      || binding.executableAdmissionId !== decision.lexicalBinding.executableAdmissionId) {
      throw new Error(`Lexical materialization telemetry executable binding mismatch for '${decision.toolName}'.`);
    }
    if (digestToolDefinition(binding.definition) !== binding.definitionDigest) {
      throw new Error(`Lexical materialization telemetry binding definition digest mismatch for '${decision.toolName}'.`);
    }
    const projectedMatches = (input.projectedTools ?? []).filter((tool) => tool.name === decision.toolName);
    if (projectedMatches.length !== 1) {
      throw new Error(
        `Lexical materialization telemetry expected exactly one projected ToolDefinition for '${decision.toolName}', found ${projectedMatches.length}.`,
      );
    }
    const projected = projectedMatches[0];
    if (!projected) {
      throw new Error(`Lexical materialization telemetry could not read projected ToolDefinition for '${decision.toolName}'.`);
    }
    const recomputedDigest = digestToolDefinition(projected) as ToolDefinitionDigest;
    if (recomputedDigest !== decision.lexicalBinding.toolDefinitionDigest
      || recomputedDigest !== binding.definitionDigest) {
      throw new Error(
        `Lexical materialization telemetry ToolDefinition digest mismatch for '${decision.toolName}'.`,
      );
    }
  }

  // A denied legacy decision cannot be authority-redacted partially. Keep the
  // redacted shape explicit and reject accidental leakage of a stale,
  // colliding, or otherwise contradictory catalog target.
  for (const decision of input.materializationDecisions) {
    if (decision.sourceToolName === "tool_catalog_search"
      && decision.decision !== "materialized"
      && decision.decision !== "already_materialized"
      && (decision.toolName !== "<redacted>"
        || decision.lexicalBinding !== undefined
        || Object.keys(decision.catalog).length > 0)) {
      throw new Error("Outside-authority lexical materialization telemetry is not redacted.");
    }
  }
}

export interface ProviderRequestCachePartitionInput {
  readonly tenantId?: string;
  readonly accountId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly canonicalModel?: string;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationResolution?: unknown;
  readonly policyIdentity?: unknown;
  readonly authority?: {
    readonly admissionId?: `sha256:${string}`;
    readonly effectiveTurnAuthority?: unknown;
    readonly authorityContext?: unknown;
    readonly requestedAuthority?: NonNullable<ProviderRequestEvidence["authority"]>["requestedAuthority"];
    readonly admittedAuthority?: NonNullable<ProviderRequestEvidence["authority"]>["admittedAuthority"];
    readonly sourcePolicy?: string;
    readonly completeness?: "authoritative" | "partial";
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
        providerResponseObserved: true,
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

  recordFailedRequest(
    sessionId: string,
    request: ProviderRequestRegionEvidence,
    durationMs?: number,
    agentId?: string,
  ): void {
    const physicalAttempts = request.physicalAttempts?.map((attempt, index, attempts) =>
      index === attempts.length - 1 && attempt.outcome !== "completed"
        ? {
            ...attempt,
            outcome: "failed" as const,
            ...(attempt.failurePhase ? {} : { failurePhase: "headers" as const }),
          }
        : attempt
    );
    this.providerRequests.push({
      requestIndex: this.providerRequests.length,
      providerResponseObserved: false,
      providerId: this.executionIdentity?.provider ?? "unknown",
      modelId: this.executionIdentity?.model ?? "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ...(durationMs === undefined ? {} : { durationMs }),
      cumulativeInputTokens: this.totals.inputTokens,
      cumulativeOutputTokens: this.totals.outputTokens,
      cumulativeCacheReadTokens: this.totals.cacheReadTokens,
      cumulativeCacheWriteTokens: this.totals.cacheWriteTokens,
      ...request,
      ...(physicalAttempts?.length ? { physicalAttempts } : {}),
    });
    this.emitCostUpdate(sessionId, agentId);
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
      providerRequests: this.requestSnapshot(),
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
    deliberationResolution: cacheResolutionIdentity(input?.deliberationResolution),
    communicationResolution: cacheResolutionIdentity(input?.communicationResolution),
  };
  const accountValue = {
    accountId: input?.accountId ?? "unknown",
  };
  const policyValue = input?.policyIdentity ?? { policy: "default" };
  const authorityValue = input?.authority ?? { authority: "unknown" };
  const dimensions = [
    cachePartitionDimension("tenant", tenantValue, "session tenant identity"),
    cachePartitionDimension("account", accountValue, "provider account identity"),
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

function cacheResolutionIdentity(value: unknown): object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { status: "not-requested" };
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "capabilityEvidence" && key !== "identity"),
  );
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
