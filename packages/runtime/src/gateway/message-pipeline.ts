import type { ContentPart } from "@kilnai/core";
import type { ModeBOrchestrator, OrchestrateResult, PerCallToolConfig, ToolExecutionSummary } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { BillingConfig } from "./budget-middleware.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import type { SessionMode } from "../session/session-mode.js";
import type { EscalationSignal } from "../session/escalation-detector.js";
import { TraceContext } from "./trace-context.js";

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
  readonly knowledgeContext?: string;
  readonly contactContext?: string;
  readonly callBuiltinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
  readonly perCallConfig?: PerCallToolConfig;
  readonly traceId?: string;
  readonly activeAgentId?: string;
  readonly activeAgentName?: string;
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
  readonly escalation?: EscalationSignal;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly traceId: string;
  readonly activeAgentId?: string;
}

export interface BudgetDeniedResult {
  readonly budgetExhausted: true;
  readonly message: string;
}

export type ProcessResult =
  | { ok: true; result: InboundMessageResult }
  | { ok: false; budgetDenied: BudgetDeniedResult };

export async function processInboundMessage(ctx: InboundMessageContext): Promise<ProcessResult> {
  const trace = new TraceContext(ctx.traceId);
  trace.log("pipeline", "Processing inbound message", { appName: ctx.appName, userId: ctx.userId, channel: ctx.channel });

  // Budget check
  if (ctx.billing) {
    const budgetResult = await checkBudget(ctx.billing, ctx.tenantId ?? ctx.userId);
    if (!budgetResult.allowed) {
      trace.log("pipeline", "Budget denied");
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
  const session = await ctx.sessionRegistry.getOrCreate({
    appName: ctx.appName,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    systemPrompt: ctx.systemPrompt,
    idleTimeoutMs: ctx.idleTimeoutMs,
  });
  trace.log("pipeline", "Session ready", { sessionId: session.id, sessionMode: session.sessionMode });

  // Merge recalled memory + knowledge context + contact context
  const combinedMemory = [ctx.recalledMemory, ctx.knowledgeContext, ctx.contactContext].filter(Boolean).join("\n\n") || undefined;

  // Process message
  const result: OrchestrateResult = await ctx.orchestrator.processMessage(
    session,
    ctx.userParts,
    combinedMemory,
    ctx.callBuiltinTools,
    ctx.perCallConfig,
  );

  // Persist mutated session (required for non-reference stores like Redis)
  await ctx.sessionRegistry.save(session);

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
      traceId: trace.traceId,
      timestamp: new Date().toISOString(),
    });

    // Emit HANDOFF_MESSAGE_QUEUED when message was queued (session not ai_active)
    if (result.queued) {
      ctx.eventEmitter.emit({
        eventType: "HANDOFF_MESSAGE_QUEUED",
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit ESCALATION_DETECTED when escalation signal is present
    if (result.escalation) {
      trace.warn("pipeline", "Escalation detected", { reason: result.escalation.reason });
      ctx.eventEmitter.emit({
        eventType: "ESCALATION_DETECTED",
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        escalationReason: result.escalation.reason,
        escalationDetail: result.escalation.detail,
        summary: result.contextSummary,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit TOOL_EXECUTED events for product backend visibility
    if (result.toolExecutions) {
      for (const exec of result.toolExecutions) {
        ctx.eventEmitter.emit({
          eventType: "TOOL_EXECUTED",
          tenantId: ctx.tenantId,
          channel: ctx.channel,
          externalUserId: ctx.userId,
          toolName: exec.toolName,
          durationMs: exec.durationMs,
          success: exec.success,
          resultSummary: exec.resultSummary,
          traceId: trace.traceId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Emit AGENT_ROUTED when multi-agent routing is active
    if (ctx.activeAgentId) {
      ctx.eventEmitter.emit({
        eventType: "AGENT_ROUTED",
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        activeAgentId: ctx.activeAgentId,
        activeAgentName: ctx.activeAgentName,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  trace.log("pipeline", "Message processed", { queued: result.queued, tokens: result.inputTokens + result.outputTokens });

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
      escalation: result.escalation,
      contextSummary: result.contextSummary,
      toolExecutions: result.toolExecutions,
      traceId: trace.traceId,
      activeAgentId: ctx.activeAgentId,
    },
  };
}
