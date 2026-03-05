import type { ContentPart } from "@kilnai/core";
import type { ModeBOrchestrator, OrchestrateResult } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { BillingConfig } from "./budget-middleware.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import type { SessionMode } from "../session/session-mode.js";

export interface InboundMessageContext {
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly appName: string;
  readonly tenantId?: string;
  readonly userId: string;
  readonly systemPrompt: string;
  readonly userParts: readonly ContentPart[];
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly channel: string;
  readonly idleTimeoutMs?: number;
  readonly recalledMemory?: string;
  readonly callBuiltinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
}

export interface InboundMessageResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly queued: boolean;
  readonly sessionId: string;
  readonly sessionMode: SessionMode;
}

export interface BudgetDeniedResult {
  readonly budgetExhausted: true;
  readonly message: string;
}

export type ProcessResult =
  | { ok: true; result: InboundMessageResult }
  | { ok: false; budgetDenied: BudgetDeniedResult };

export async function processInboundMessage(ctx: InboundMessageContext): Promise<ProcessResult> {
  // Budget check
  if (ctx.billing) {
    const budgetResult = await checkBudget(ctx.billing, ctx.tenantId ?? ctx.userId);
    if (!budgetResult.allowed) {
      return {
        ok: false,
        budgetDenied: {
          budgetExhausted: true,
          message: ctx.billing.overBudgetMessage ?? "Budget exhausted.",
        },
      };
    }
  }

  // Get or create session
  const session = ctx.sessionRegistry.getOrCreate({
    appName: ctx.appName,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    systemPrompt: ctx.systemPrompt,
    idleTimeoutMs: ctx.idleTimeoutMs,
  });

  // Process message
  const result: OrchestrateResult = await ctx.orchestrator.processMessage(
    session,
    ctx.userParts,
    ctx.recalledMemory,
    ctx.callBuiltinTools,
  );

  // Report usage (fire-and-forget)
  if (ctx.billing) {
    reportUsage(ctx.billing, {
      tenantId: ctx.tenantId ?? ctx.userId,
      messages: 1,
      tokens: result.inputTokens + result.outputTokens,
      model: ctx.orchestrator.model ?? "unknown",
    });
  }

  // Emit events (fire-and-forget)
  if (ctx.eventEmitter && ctx.tenantId) {
    ctx.eventEmitter.emit({
      eventType: "MESSAGE_RECEIVED",
      tenantId: ctx.tenantId,
      channel: ctx.channel,
      externalUserId: ctx.userId,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    result: {
      parts: result.parts,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      queued: result.queued,
      sessionId: session.id,
      sessionMode: session.sessionMode,
    },
  };
}
