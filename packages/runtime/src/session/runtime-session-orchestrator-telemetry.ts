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
} from "@kilnai/core";
import { computeUsageCostUsd, resolveExecutionPricing } from "@kilnai/core";
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
}

export class RuntimeSessionExecutionTelemetry {
  private executionIdentity: ExecutionIdentity | undefined;
  private warnedMissingModel = false;

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
  ): OrchestratorUsageSnapshot {
    this.totals = {
      inputTokens: this.totals.inputTokens + usage.inputTokens,
      outputTokens: this.totals.outputTokens + usage.outputTokens,
      cacheReadTokens: this.totals.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: this.totals.cacheWriteTokens + usage.cacheWriteTokens,
    };
    this.emitCostUpdate(sessionId, agentId);
    return this.snapshot();
  }

  snapshot(): OrchestratorUsageSnapshot {
    return { ...this.totals };
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
      reasoningEffort: decision.reasoningEffort,
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
      totalCostUsd,
      byRoleModel: {
        [`assistant:${model}`]: {
          model,
          provider: this.executionIdentity?.provider,
          canonicalModel: this.executionIdentity?.canonicalModel,
          billingMode: this.executionIdentity?.billingMode,
          calls: 1,
          costUsd: totalCostUsd,
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
      if (!this.warnedMissingModel) {
        console.warn("[RuntimeSessionOrchestrator] No resolved model available for cost tracking; cost will be $0 until routing/model selection is known.");
        this.warnedMissingModel = true;
      }
      return undefined;
    }
    if (
      this.executionIdentity.billingMode === "subscription" ||
      this.executionIdentity.billingMode === "free"
    ) {
      return undefined;
    }
    const pricing = resolveExecutionPricing(this.executionIdentity);
    if (!pricing) {
      const resolvedModel = this.executionIdentity.canonicalModel ?? this.executionIdentity.model ?? "unknown";
      console.warn(`[RuntimeSessionOrchestrator] No metered pricing found for execution model "${resolvedModel}" -- cost will be $0 until billing metadata or pricing is known.`);
    }
    return pricing;
  }
}
