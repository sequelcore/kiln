import type {
  EventBus,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  RoutingDecision,
} from "@kilnai/core";
import { MODEL_PRICING } from "@kilnai/core";
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

export class ModeBExecutionTelemetry {
  private totals: OrchestratorUsageSnapshot = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  constructor(
    private readonly model: string | undefined,
    private readonly eventBus?: EventBus,
  ) {
    if (!model) {
      console.warn("[ModeBOrchestrator] No model specified in deps -- cost tracking will be $0. Pass model to OrchestratorDeps for accurate cost reporting.");
    }
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
    const event: ModelRoutedEvent = {
      type: "model_routed",
      model: decision.model,
      provider: decision.provider,
      routingTier: decision.routingTier,
      reason: decision.reasoning,
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
    const model = this.model ?? "unknown";

    const event: CostUpdateEvent = {
      type: "cost_update",
      inputTokens: this.totals.inputTokens,
      outputTokens: this.totals.outputTokens,
      cacheReadTokens: this.totals.cacheReadTokens,
      totalCostUsd,
      byRoleModel: {
        [`assistant:${model}`]: { model, calls: 1, costUsd: totalCostUsd },
      },
      timestamp: new Date(),
      sessionId,
      ...(agentId ? { agentId } : {}),
    };
    this.eventBus?.emit(event);
  }

  private computeTotalCostUsd(usage: OrchestratorUsageSnapshot): number {
    const pricing = this.resolvedPricing;
    if (!pricing) return 0;

    const uncachedInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);

    return (
      (uncachedInput * pricing.inputRate +
        usage.outputTokens * pricing.outputRate +
        usage.cacheReadTokens * pricing.inputRate * pricing.cacheReadMultiplier +
        usage.cacheWriteTokens * pricing.inputRate * pricing.cacheWriteMultiplier) /
      1_000_000
    );
  }

  private get resolvedPricing(): ModelPricing | undefined {
    if (!this.model) return undefined;
    const pricing = MODEL_PRICING.get(this.model);
    if (!pricing) {
      console.warn(`[ModeBOrchestrator] Model "${this.model}" not found in MODEL_PRICING -- cost will be $0. Add it to the pricing table or use a known model identifier.`);
    }
    return pricing;
  }
}
