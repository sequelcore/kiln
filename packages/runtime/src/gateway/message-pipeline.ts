import type {
  ContentPart,
  SessionLimitsConfig,
  SkillRegistry,
  GroundingMode,
  GroundingResult,
  ProviderAdapter,
  ModelCapabilityRegistry,
  EventBus,
  ContextArtifactCache,
  ApprovalRequestedEvent,
  ApprovalReceivedEvent,
  ToolAuthorizedEvent,
} from "@kilnai/core";
import { extractText, textParts, GroundingRail } from "@kilnai/core";
import type { AbuseDetectionConfig } from "../session/repetitive-abuse-detector.js";
import { detectRepetitiveAbuse } from "../session/repetitive-abuse-detector.js";
import type { ModeBOrchestrator, OrchestrateResult, PerCallToolConfig, ToolExecutionSummary } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { BillingConfig } from "./budget-middleware.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import type { SessionMode } from "../session/session-mode.js";
import type { EscalationSignal } from "../session/escalation-detector.js";
import { TraceContext } from "./trace-context.js";
import { appendGroundingDirective, formatUserContext } from "./context-formatter.js";
import {
  classifyRuntimeContextPressure,
  formatRuntimeResumeFeedbackLabel,
  formatRuntimeResumeDecision,
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
  writeRuntimeHandoffSummaryArtifact,
} from "../session/context-artifact-summary.js";
import {
  applyRuntimeTurnRecord,
  type RuntimeTurnApprovalTransition,
  type RuntimeTurnAuthorityDecision,
} from "../session/runtime-turn-record.js";

type EgressDestination = "webhook";
type EgressPermissionDecision = "allow" | "deny" | "redact";
type EgressPayloadType = "assistant-response" | "context-summary" | "tool-result-summary";

interface EgressPermissionRequest {
  readonly tenantId: string;
  readonly channel: string;
  readonly destination: EgressDestination;
  readonly payloadType: EgressPayloadType;
  readonly text: string;
  readonly sessionId: string;
}

export interface InboundMessageContext {
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly appName: string;
  readonly tenantId: string;
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
  readonly isHandoff?: boolean;
  readonly previousAgentId?: string;
  readonly previousAgentName?: string;
  readonly handoffBrief?: string;
  readonly pingPongBlocked?: boolean;
  readonly pingPongReason?: string;
  readonly routingTier?: "rule" | "embedding" | "fallback";
  readonly routingConfidence?: number;
  readonly sessionLimits?: SessionLimitsConfig;
  readonly abuseDetection?: AbuseDetectionConfig;
  readonly skillRegistry?: SkillRegistry;
  readonly activeSkills?: readonly string[];
  readonly activeSkillTags?: readonly string[];
  readonly userContext?: Record<string, string>;
  readonly groundingMode?: GroundingMode;
  readonly groundingDeps?: {
    readonly rail: GroundingRail;
    readonly providerPool: ReadonlyMap<string, ProviderAdapter>;
    readonly modelRegistry: ModelCapabilityRegistry;
    readonly eventBus?: EventBus;
  };
  readonly contextArtifactCache?: ContextArtifactCache;
  readonly evaluateEgressPermission?: (
    request: EgressPermissionRequest,
  ) => EgressPermissionDecision | Promise<EgressPermissionDecision>;
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
  readonly routingDecision?: {
    readonly provider: string;
    readonly model: string;
    readonly routingTier: string;
  };
  readonly limitReached?: { type: "tokens" | "turns" | "abuse"; value: number; max?: number };
  readonly groundingResult?: GroundingResult;
}

export interface BudgetDeniedResult {
  readonly budgetExhausted: true;
  readonly message: string;
}

export type ProcessResult =
  | { ok: true; result: InboundMessageResult }
  | { ok: false; budgetDenied: BudgetDeniedResult };

const EGRESS_DENIED_FALLBACK_TEXT = "I cannot share that response.";
const EGRESS_REDACTED_TEXT = "[REDACTED]";

function mapChannelToEgressDestination(_channel: string): EgressDestination {
  // Gateway egress in this pipeline exits runtime over external integrations.
  // For this slice, model all channels as webhook-class destinations.
  return "webhook";
}

async function resolveEgressDecision(
  ctx: InboundMessageContext,
  sessionId: string,
  payloadType: EgressPayloadType,
  text: string | undefined,
): Promise<EgressPermissionDecision> {
  if (!ctx.evaluateEgressPermission) return "allow";
  if (!text || text.trim() === "") return "allow";
  try {
    return await ctx.evaluateEgressPermission({
      tenantId: ctx.tenantId,
      channel: ctx.channel,
      destination: mapChannelToEgressDestination(ctx.channel),
      payloadType,
      text,
      sessionId,
    });
  } catch {
    // Fail-open for this foundation slice.
    return "allow";
  }
}

function redactAssistantParts(parts: readonly ContentPart[]): readonly ContentPart[] {
  let changed = false;
  const redacted = parts.map((part) => {
    if (part.type !== "text") return part;
    changed = true;
    return { type: "text", text: EGRESS_REDACTED_TEXT } as const;
  });
  return changed ? redacted : parts;
}

export async function processInboundMessage(ctx: InboundMessageContext): Promise<ProcessResult> {
  const trace = new TraceContext(ctx.traceId);
  trace.log("pipeline", "Processing inbound message", { appName: ctx.appName, userId: ctx.userId, channel: ctx.channel });
  const userText = extractText(ctx.userParts);
  const taskShape = normalizeRuntimeTaskShape(userText);

  // Budget check
  if (ctx.billing) {
    const budgetResult = await checkBudget(ctx.billing, ctx.tenantId);
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

  // Merge incoming user context into session (merge semantics: keys accumulate)
  if (ctx.userContext && Object.keys(ctx.userContext).length > 0) {
    session.updateUserContext(ctx.userContext);
  }
  session.updateSessionLedger({
    currentPhase: "processing",
    turnDepth: session.messageCount + 1,
  });

  // Session turn limit check
  if (ctx.sessionLimits?.maxTurns && session.userTurnCount >= ctx.sessionLimits.maxTurns) {
    trace.warn("pipeline", "Session turn limit reached", { turns: session.userTurnCount, max: ctx.sessionLimits.maxTurns });
    if (ctx.eventEmitter) {
      ctx.eventEmitter.emit({
        eventType: "SESSION_LIMIT_REACHED",
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        limitType: "turns",
        limitValue: session.userTurnCount,
        limitMax: ctx.sessionLimits.maxTurns,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
    session.setSessionMode("human_active");
    await ctx.sessionRegistry.save(session);
    return {
      ok: true,
      result: {
        parts: [],
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        queued: true,
        sessionId: session.id,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        limitReached: { type: "turns", value: session.userTurnCount, max: ctx.sessionLimits.maxTurns },
      },
    };
  }

  // Session token limit check
  if (ctx.sessionLimits?.maxTokens && session.totalTokens >= ctx.sessionLimits.maxTokens) {
    trace.warn("pipeline", "Session token limit reached", { tokens: session.totalTokens, max: ctx.sessionLimits.maxTokens });
    if (ctx.eventEmitter) {
      ctx.eventEmitter.emit({
        eventType: "SESSION_LIMIT_REACHED",
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        limitType: "tokens",
        limitValue: session.totalTokens,
        limitMax: ctx.sessionLimits.maxTokens,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
    session.setSessionMode("human_active");
    await ctx.sessionRegistry.save(session);
    return {
      ok: true,
      result: {
        parts: [],
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        queued: true,
        sessionId: session.id,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        limitReached: { type: "tokens", value: session.totalTokens, max: ctx.sessionLimits.maxTokens },
      },
    };
  }

  // Repetitive abuse detection
  if (ctx.abuseDetection) {
    const abuse = detectRepetitiveAbuse(userText, session.conversationHistory, ctx.abuseDetection);
    if (abuse) {
      trace.warn("pipeline", "Abuse detected", { type: abuse.type, confidence: abuse.confidence });
      if (ctx.eventEmitter) {
        ctx.eventEmitter.emit({
          eventType: "SESSION_LIMIT_REACHED",
          tenantId: ctx.tenantId,
          channel: ctx.channel,
          externalUserId: ctx.userId,
          sessionId: session.id,
          schemaVersion: "1",
          limitType: "abuse",
          limitValue: abuse.confidence,
          traceId: trace.traceId,
          timestamp: new Date().toISOString(),
        });
      }
      session.setSessionMode("human_active");
      await ctx.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [],
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          queued: true,
          sessionId: session.id,
          sessionMode: session.sessionMode,
          traceId: trace.traceId,
          limitReached: { type: "abuse", value: abuse.confidence },
        },
      };
    }
  }

  // Merge recalled memory + knowledge context + contact context (user context goes first)
  const runtimeSupport = readRuntimeSupportArtifactsDetailed(ctx.contextArtifactCache, {
    session,
    channel: ctx.channel,
    providerHint: session.sessionLedger.lastProvider,
    taskShape,
  });
  const cachedRuntimeSummary = runtimeSupport.content;
  session.addExactArtifact(formatRuntimeResumeDecision(runtimeSupport.decision));
  trace.log("pipeline", "Runtime continuity decision", {
    strategy: runtimeSupport.decision.resumeStrategy,
    signals: runtimeSupport.decision.cachedResumeSignalCount,
    pressure: classifyRuntimeContextPressure(runtimeSupport.supportArtifactCount),
    sources: runtimeSupport.supportArtifactSources,
    fallback: runtimeSupport.fallbackLabel,
    usedSelectedSources: runtimeSupport.usedCachedSupport,
    selectionReason: runtimeSupport.selectionReason,
    usedCache: runtimeSupport.decision.resumeStrategy === "cache-first",
    feedback: formatRuntimeResumeFeedbackLabel(runtimeSupport.decision),
    influenced: runtimeSupport.decision.resumeFeedback?.influencedChoice ?? false,
  });
  const userCtxBlock = formatUserContext(session.userContext);
  const mergedMemory = [userCtxBlock, cachedRuntimeSummary, ctx.recalledMemory, ctx.knowledgeContext, ctx.contactContext].filter(Boolean).join("\n\n") || undefined;
  const combinedMemory = appendGroundingDirective(mergedMemory, ctx.groundingMode);

  // Resolve active skills
  let perCallConfig = ctx.perCallConfig;
  if (ctx.skillRegistry && (ctx.activeSkills?.length || ctx.activeSkillTags?.length)) {
    const resolved = ctx.skillRegistry.resolve(ctx.activeSkills, ctx.activeSkillTags);
    if (resolved.length > 0) {
      const loaded = resolved.map((s) => ctx.skillRegistry!.load(s.name)).filter(Boolean);
      if (loaded.length > 0) {
        const skillInstructions = loaded.map((s) => s!.instructions).join("\n\n---\n\n");
        perCallConfig = { ...perCallConfig, skillInstructions };
      }
    }
  }

  // Capture real approval state transitions for this turn from runtime events.
  const approvalTransitions: RuntimeTurnApprovalTransition[] = [];
  const authorityDecisions: RuntimeTurnAuthorityDecision[] = [];
  const orchestratorEventBus = ctx.orchestrator.eventBus;
  const onApprovalRequested = (event: ApprovalRequestedEvent): void => {
    if (event.sessionId !== session.id) return;
    approvalTransitions.push({
      status: "requested",
      sessionId: event.sessionId,
      reason: event.description,
    });
  };
  const onApprovalReceived = (event: ApprovalReceivedEvent): void => {
    if (event.sessionId !== session.id) return;
    approvalTransitions.push({
      status: event.approved ? "approved" : "rejected",
      sessionId: event.sessionId,
      reason: event.reason,
    });
  };
  const onToolAuthorized = (event: ToolAuthorizedEvent): void => {
    if (event.sessionId !== session.id) return;
    authorityDecisions.push({
      toolName: event.toolName,
      level: event.level,
      allowed: event.allowed,
      reason: event.reason,
    });
  };
  orchestratorEventBus?.on("approval_requested", onApprovalRequested);
  orchestratorEventBus?.on("approval_received", onApprovalReceived);
  orchestratorEventBus?.on("tool_authorized", onToolAuthorized);

  let result: OrchestrateResult;
  try {
    // Process message
    result = await ctx.orchestrator.processMessage(
      session,
      ctx.userParts,
      combinedMemory,
      ctx.callBuiltinTools,
      perCallConfig,
    );
  } finally {
    orchestratorEventBus?.off("approval_requested", onApprovalRequested);
    orchestratorEventBus?.off("approval_received", onApprovalReceived);
    orchestratorEventBus?.off("tool_authorized", onToolAuthorized);
  }

  // Post-generation grounding verification (Tier 2)
  let groundingResult: GroundingResult | undefined;
  let resultParts = result.parts;
  if (
    ctx.groundingMode === "verified" &&
    ctx.groundingDeps &&
    ctx.knowledgeContext &&
    !result.queued &&
    extractText(result.parts)
  ) {
    const chunks = ctx.knowledgeContext.split("\n---\n").filter(Boolean);
    const responseText = extractText(result.parts);
    try {
      // Select cheapest model with structured output support
      const eligible = ctx.groundingDeps.modelRegistry
        .eligible({ hasTools: false, requiresStreaming: false })
        .filter((p) => p.supportsStructuredOutput)
        .sort((a, b) => a.inputPer1M - b.inputPer1M);
      const judge = eligible[0];
      const provider = judge ? ctx.groundingDeps.providerPool.get(judge.provider) : undefined;
      if (provider && judge) {
        groundingResult = await ctx.groundingDeps.rail.evaluate(responseText, chunks, provider, judge.model);
        // Emit internal event
        if (ctx.groundingDeps.eventBus) {
          const evt: import("@kilnai/core").GroundingEvaluatedEvent = {
            type: "grounding_evaluated",
            timestamp: new Date(),
            sessionId: session.id,
            tenantId: ctx.tenantId,
            grounded: groundingResult.grounded,
            confidence: groundingResult.confidence,
            ungroundedClaims: groundingResult.ungroundedClaims,
            durationMs: groundingResult.durationMs,
            model: groundingResult.model,
          };
          ctx.groundingDeps.eventBus.emit(evt);
        }
        // Replace response if ungrounded
        if (!groundingResult.grounded) {
          trace.warn("pipeline", "Grounding check failed", {
            confidence: groundingResult.confidence,
            claims: groundingResult.ungroundedClaims.length,
          });
          resultParts = textParts("I don't have enough verified information to answer that accurately. Let me connect you with our team for a precise answer.");
        }
      }
    } catch (err) {
      // Fail-open: grounding check error does not block the response
      trace.warn("pipeline", "Grounding check error (fail-open)", { error: String(err) });
    }
  }

  const fileChanges = result.toolExecutions?.flatMap((exec) => exec.fileChanges ?? []);

  applyRuntimeTurnRecord({
    session,
    channel: ctx.channel,
    taskShape,
    contextArtifactCache: ctx.contextArtifactCache,
    continuityDecision: runtimeSupport.decision,
    queued: result.queued,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    contextSummary: result.contextSummary,
    toolExecutions: result.toolExecutions,
    routingDecision: result.routingDecision,
    escalationReason: result.escalation?.reason,
    groundingBlockedClaims: groundingResult && !groundingResult.grounded
      ? groundingResult.ungroundedClaims
      : undefined,
    activeAgentId: ctx.activeAgentId,
    routingTierHint: ctx.routingTier,
    fileChanges: fileChanges && fileChanges.length > 0 ? fileChanges : undefined,
    approvalTransitions: approvalTransitions.length > 0 ? approvalTransitions : undefined,
    authorityDecisions: authorityDecisions.length > 0 ? authorityDecisions : undefined,
  });
  writeRuntimeHandoffSummaryArtifact(ctx.contextArtifactCache, {
    session,
    handoffBrief: ctx.handoffBrief,
    handoffBlocked: ctx.pingPongBlocked,
    handoffBlockReason: ctx.pingPongReason,
    escalationReason: result.escalation?.reason,
    escalationDetail: result.escalation?.detail,
  });

  // Persist mutated session (required for non-reference stores like Redis)
  await ctx.sessionRegistry.save(session);

  // Report usage (fire-and-forget)
  if (ctx.billing) {
    reportUsage(ctx.billing, {
      tenantId: ctx.tenantId,
      messages: 1,
      tokens: result.inputTokens + result.outputTokens,
      model: ctx.orchestrator.model ?? "unknown",
    });
  }

  // Emit events (fire-and-forget)
  const assistantDecision = await resolveEgressDecision(
    ctx,
    session.id,
    "assistant-response",
    extractText(resultParts),
  );

  if (assistantDecision === "deny") {
    resultParts = textParts(EGRESS_DENIED_FALLBACK_TEXT);
  } else if (assistantDecision === "redact") {
    resultParts = redactAssistantParts(resultParts);
  }

  let egressContextSummary = result.contextSummary;
  if (assistantDecision === "deny") {
    egressContextSummary = undefined;
  } else if (assistantDecision === "redact" && egressContextSummary !== undefined) {
    egressContextSummary = EGRESS_REDACTED_TEXT;
  } else {
    const summaryDecision = await resolveEgressDecision(
      ctx,
      session.id,
      "context-summary",
      result.contextSummary,
    );
    if (summaryDecision === "deny") {
      egressContextSummary = undefined;
    } else if (summaryDecision === "redact" && egressContextSummary !== undefined) {
      egressContextSummary = EGRESS_REDACTED_TEXT;
    }
  }

  let egressToolExecutions = result.toolExecutions;
  if (egressToolExecutions && egressToolExecutions.length > 0) {
    const mapped: ToolExecutionSummary[] = [];
    for (const exec of egressToolExecutions) {
      let summaryDecision: EgressPermissionDecision;
      if (assistantDecision === "deny") {
        summaryDecision = "deny";
      } else if (assistantDecision === "redact") {
        summaryDecision = "redact";
      } else {
        summaryDecision = await resolveEgressDecision(
          ctx,
          session.id,
          "tool-result-summary",
          exec.resultSummary,
        );
      }

      if (summaryDecision === "deny") {
        mapped.push({ ...exec, resultSummary: "" });
      } else if (summaryDecision === "redact") {
        mapped.push({ ...exec, resultSummary: EGRESS_REDACTED_TEXT });
      } else {
        mapped.push(exec);
      }
    }
    egressToolExecutions = mapped;
  }

  if (ctx.eventEmitter) {
    ctx.eventEmitter.emit({
      eventType: "MESSAGE_RECEIVED",
      tenantId: ctx.tenantId,
      channel: ctx.channel,
      externalUserId: ctx.userId,
      sessionId: session.id,
      schemaVersion: "1",
      turnNumber: session.messageCount,
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
        sessionId: session.id,
        schemaVersion: "1",
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
        sessionId: session.id,
        schemaVersion: "1",
        escalationReason: result.escalation.reason,
        escalationDetail: result.escalation.detail,
        summary: egressContextSummary,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit TOOL_EXECUTED events for product backend visibility
    if (egressToolExecutions) {
      for (const exec of egressToolExecutions) {
        ctx.eventEmitter.emit({
          eventType: "TOOL_EXECUTED",
          tenantId: ctx.tenantId,
          channel: ctx.channel,
          externalUserId: ctx.userId,
          sessionId: session.id,
          schemaVersion: "1",
          toolName: exec.toolName,
          durationMs: exec.durationMs,
          success: exec.success,
          resultSummary: exec.resultSummary || undefined,
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
        sessionId: session.id,
        schemaVersion: "1",
        activeAgentId: ctx.activeAgentId,
        activeAgentName: ctx.activeAgentName,
        routingTier: ctx.routingTier,
        routingConfidence: ctx.routingConfidence,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit AGENT_HANDOFF when an agent switch occurred (or was blocked)
    if (ctx.isHandoff || ctx.pingPongBlocked) {
      ctx.eventEmitter.emit({
        eventType: "AGENT_HANDOFF",
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        fromAgentId: ctx.previousAgentId,
        fromAgentName: ctx.previousAgentName,
        toAgentId: ctx.activeAgentId,
        toAgentName: ctx.activeAgentName,
        handoffBrief: ctx.handoffBrief,
        handoffBlocked: ctx.pingPongBlocked,
        handoffBlockReason: ctx.pingPongReason,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit MODEL_ROUTED when model routing occurred
    if (result.routingDecision) {
      ctx.eventEmitter.emit({
        eventType: "MODEL_ROUTED",
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        selectedProvider: result.routingDecision.provider,
        selectedModel: result.routingDecision.model,
        routingTier: result.routingDecision.routingTier,
        sessionId: session.id,
        schemaVersion: "1",
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Emit GROUNDING_BLOCKED when response was replaced
  if (groundingResult && !groundingResult.grounded && ctx.eventEmitter) {
    ctx.eventEmitter.emit({
      eventType: "GROUNDING_BLOCKED",
      tenantId: ctx.tenantId,
      channel: ctx.channel,
      externalUserId: ctx.userId,
      sessionId: session.id,
      schemaVersion: "1",
      confidence: groundingResult.confidence,
      ungroundedClaims: groundingResult.ungroundedClaims,
      model: groundingResult.model,
      traceId: trace.traceId,
      timestamp: new Date().toISOString(),
    });
  }

  trace.log("pipeline", "Message processed", { queued: result.queued, tokens: result.inputTokens + result.outputTokens });

  return {
    ok: true,
    result: {
      parts: resultParts,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      queued: result.queued,
      sessionId: session.id,
      sessionMode: session.sessionMode,
      escalation: result.escalation,
      contextSummary: egressContextSummary,
      toolExecutions: egressToolExecutions,
      traceId: trace.traceId,
      activeAgentId: ctx.activeAgentId,
      routingDecision: result.routingDecision
        ? { provider: result.routingDecision.provider, model: result.routingDecision.model, routingTier: result.routingDecision.routingTier }
        : undefined,
      groundingResult,
    },
  };
}
