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
  ContextAuditEntry,
  ContextCandidate,
  ApprovalRequestedEvent,
  ApprovalReceivedEvent,
  ToolAuthorizedEvent,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  ToolCalledEvent,
  ToolResultEvent,
  TenantConfig,
  RetrievalPipeline,
} from "@kilnai/core";
import { DefaultContextGovernor, extractText, textParts, GroundingRail, renderProjectedContext } from "@kilnai/core";
import type { AbuseDetectionConfig } from "../session/repetitive-abuse-detector.js";
import { detectRepetitiveAbuse } from "../session/repetitive-abuse-detector.js";
import type { RuntimeSessionOrchestrator, OrchestrateResult, PerCallToolConfig, ToolExecutionSummary } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { BillingConfig } from "./budget-middleware.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import type { SessionMode } from "../session/session-mode.js";
import type { EscalationSignal } from "../session/support/escalation/escalation-detector.js";
import { TraceContext } from "./trace-context.js";
import { appendGroundingDirective, formatKnowledgeContext, formatUserContext } from "./context-formatter.js";
import {
  formatRuntimeContinuityPresentation,
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
  writeRuntimeHandoffSummaryArtifact,
} from "../session/support/artifacts/context-artifact-summary.js";
import {
  applyRuntimeTurnRecord,
  type RuntimeTurnApprovalTransition,
  type RuntimeTurnAuthorityDecision,
  type RuntimeTurnDangerousCommandOutcome,
  type RuntimeTurnFileChange,
} from "../session/runtime-turn-record.js";
import { appendCanonicalTurnEvents } from "../session/runtime-session-event-ledger.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import type { AgentHandoffSummarizer } from "../session/support/summarization/agent-handoff-summarizer.js";

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

export interface AdmittedTurnContext {
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly systemPrompt?: string;
  readonly userParts: readonly ContentPart[];
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly channel: string;
  readonly idleTimeoutMs?: number;
  readonly recalledMemory?: string;
  readonly knowledgeContext?: string;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactContext?: string;
  readonly tenant?: TenantConfig;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
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
  readonly turnCapture?: {
    readonly start?: (sessionId: string, nextSequence: number) => void | Promise<void>;
    readonly finish?: (
      sessionId: string,
    ) => (
      | {
        readonly fileChanges?: readonly RuntimeTurnFileChange[];
        readonly approvalTransitions?: readonly RuntimeTurnApprovalTransition[];
        readonly authorityDecisions?: readonly RuntimeTurnAuthorityDecision[];
        readonly dangerousCommandOutcomes?: readonly RuntimeTurnDangerousCommandOutcome[];
      }
      | undefined
      | Promise<{
        readonly fileChanges?: readonly RuntimeTurnFileChange[];
        readonly approvalTransitions?: readonly RuntimeTurnApprovalTransition[];
        readonly authorityDecisions?: readonly RuntimeTurnAuthorityDecision[];
        readonly dangerousCommandOutcomes?: readonly RuntimeTurnDangerousCommandOutcome[];
      } | undefined>
    );
    readonly abort?: (sessionId: string) => void | Promise<void>;
  };
}

export interface AdmittedTurnResult {
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
  readonly runtimeContinuity?: {
    readonly strategy: string;
    readonly feedbackLabel?: string;
    readonly pressure?: string;
    readonly supportArtifactCount?: number;
    readonly supportArtifactSources?: readonly string[];
    readonly fallbackLabel?: string;
    readonly usedCachedSupport?: boolean;
    readonly selectionReason?: string;
  };
  readonly contextAudit?: ContextAuditEntry;
}

export interface BudgetDeniedResult {
  readonly budgetExhausted: true;
  readonly message: string;
}

export type ProcessResult =
  | { ok: true; result: AdmittedTurnResult }
  | { ok: false; budgetDenied: BudgetDeniedResult };

const EGRESS_DENIED_FALLBACK_TEXT = "I cannot share that response.";
const EGRESS_REDACTED_TEXT = "[REDACTED]";

function mapChannelToEgressDestination(_channel: string): EgressDestination {
  // Gateway egress in this pipeline exits runtime over external integrations.
  // For this slice, model all channels as webhook-class destinations.
  return "webhook";
}

async function resolveEgressDecision(
  ctx: AdmittedTurnContext,
  tenantId: string,
  sessionId: string,
  payloadType: EgressPayloadType,
  text: string | undefined,
): Promise<EgressPermissionDecision> {
  if (!ctx.evaluateEgressPermission) return "allow";
  if (!text || text.trim() === "") return "allow";
  try {
    return await ctx.evaluateEgressPermission({
      tenantId,
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

function dedupeByStableKey<T>(items: readonly T[], toKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = toKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function dangerousCommandOutcomeFromExecution(
  execution: ToolExecutionSummary,
): RuntimeTurnDangerousCommandOutcome | undefined {
  if (execution.success) {
    return undefined;
  }
  const summary = execution.resultSummary.trim();
  const denyPrefix = "Dangerous command blocked: ";
  const askPrefix = "Command requires approval: ";
  let action: "ask" | "deny";
  let details: string;
  if (summary.startsWith(denyPrefix)) {
    action = "deny";
    details = summary.slice(denyPrefix.length);
  } else if (summary.startsWith(askPrefix)) {
    action = "ask";
    details = summary.slice(askPrefix.length);
  } else {
    return undefined;
  }
  const match = /^(.*)\s+\(([^()]+)\)$/.exec(details);
  if (!match) {
    return undefined;
  }
  const reason = match[1]?.trim();
  const reasonCode = match[2]?.trim();
  if (!reason || !reasonCode) {
    return undefined;
  }
  return {
    toolName: execution.toolName,
    action,
    reasonCode,
    reason,
  };
}

interface AdmittedTurnContextProjectionInput {
  readonly userContext: Record<string, string> | undefined;
  readonly cachedRuntimeSummary: string | undefined;
  readonly recalledMemory: string | undefined;
  readonly knowledgeContext: string | undefined;
  readonly contactContext: string | undefined;
  readonly groundingMode: GroundingMode | undefined;
}

function projectAdmittedTurnContext(input: AdmittedTurnContextProjectionInput): {
  readonly content: string | undefined;
  readonly audit?: ContextAuditEntry;
} {
  const candidates: ContextCandidate[] = [];
  const userContext = formatUserContext(input.userContext);

  if (userContext) {
    candidates.push({
      kind: "memory",
      source: "runtime-user-context",
      content: userContext,
      required: true,
      score: 1,
    });
  }
  if (input.cachedRuntimeSummary) {
    candidates.push({
      kind: "summary",
      source: "runtime-continuity",
      content: input.cachedRuntimeSummary,
      score: 0.9,
    });
  }
  if (input.recalledMemory) {
    candidates.push({
      kind: "memory",
      source: "runtime-recalled-memory",
      content: input.recalledMemory,
      score: 0.8,
    });
  }
  if (input.knowledgeContext) {
    candidates.push({
      kind: "knowledge",
      source: "runtime-knowledge-context",
      content: input.knowledgeContext,
      score: 0.7,
    });
  }
  if (input.contactContext) {
    candidates.push({
      kind: "memory",
      source: "runtime-contact-context",
      content: input.contactContext,
      score: 0.6,
    });
  }

  const projectedContext = new DefaultContextGovernor<
    never,
    "memory" | "summary" | "knowledge",
    never
  >().project({
    artifacts: candidates,
  });
  const mergedMemory = renderProjectedContext(projectedContext);
  return {
    content: appendGroundingDirective(mergedMemory, input.groundingMode),
    audit: projectedContext.auditTrail?.[projectedContext.auditTrail.length - 1],
  };
}

export async function processAdmittedTurn(ctx: AdmittedTurnContext): Promise<ProcessResult> {
  const trace = new TraceContext(ctx.traceId);
  trace.log("pipeline", "Processing inbound message", { appName: ctx.appName, userId: ctx.userId, channel: ctx.channel });
  const userText = extractText(ctx.userParts);
  const turnStartedAt = new Date();
  const taskShape = normalizeRuntimeTaskShape(userText);
  const effectiveTenantId = ctx.tenant?.tenantId ?? ctx.tenantId;
  const initialSystemPrompt = ctx.tenant
    ? buildTenantSystemPrompt(ctx.tenant)
    : (ctx.systemPrompt ?? "You are a helpful assistant.");

  // Budget check
  if (ctx.billing) {
    const budgetResult = await checkBudget(ctx.billing, effectiveTenantId);
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
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    systemPrompt: initialSystemPrompt,
    idleTimeoutMs: ctx.idleTimeoutMs,
  });
  trace.log("pipeline", "Session ready", { sessionId: session.id, sessionMode: session.sessionMode });

  // Merge incoming user context into session (merge semantics: keys accumulate)
  if (ctx.userContext && Object.keys(ctx.userContext).length > 0) {
    session.updateUserContext(ctx.userContext);
  }

  let effectiveKnowledgeContext = ctx.knowledgeContext;
  if (!effectiveKnowledgeContext && ctx.knowledgePipeline && (ctx.knowledgeMode ?? "auto") === "auto") {
    if (userText.length > 0) {
      try {
        const results = await ctx.knowledgePipeline.retrieve(userText, { topK: 5 });
        effectiveKnowledgeContext = formatKnowledgeContext(results);
      } catch {
        // fail-open
      }
    }
  }

  let effectiveCallBuiltinTools = ctx.callBuiltinTools;
  let effectivePerCallConfig = ctx.perCallConfig;
  let effectiveActiveAgentId = ctx.activeAgentId;
  let effectiveActiveAgentName = ctx.activeAgentName;
  let effectiveRoutingTier = ctx.routingTier;
  let effectiveRoutingConfidence = ctx.routingConfidence;
  let effectiveIsHandoff = ctx.isHandoff;
  let effectivePreviousAgentId = ctx.previousAgentId;
  let effectivePreviousAgentName = ctx.previousAgentName;
  let effectiveHandoffBrief = ctx.handoffBrief;
  let effectivePingPongBlocked = ctx.pingPongBlocked;
  let effectivePingPongReason = ctx.pingPongReason;

  if (ctx.tenant) {
    const agentCtx = await resolveAgentContextAsync(
      ctx.tenant,
      ctx.userParts,
      session,
      { handoffSummarizer: ctx.handoffSummarizer, eventBus: ctx.eventBus },
      undefined,
      effectiveCallBuiltinTools,
      session.userContext,
    );

    effectiveActiveAgentId = agentCtx.activeAgentId;
    effectiveActiveAgentName = agentCtx.activeAgentName;
    effectiveRoutingTier = agentCtx.routingResult?.tier;
    effectiveRoutingConfidence = agentCtx.routingResult?.confidence;
    effectiveIsHandoff = agentCtx.isHandoff;
    effectivePreviousAgentId = agentCtx.previousAgentId;
    effectivePreviousAgentName = effectivePreviousAgentId
      ? ctx.tenant.agents?.find((agent) => agent.id === effectivePreviousAgentId)?.name
      : undefined;
    effectiveHandoffBrief = agentCtx.handoffBrief;
    effectivePingPongBlocked = agentCtx.pingPongBlocked;
    effectivePingPongReason = agentCtx.pingPongReason;

    const tenantToolCtx = agentCtx.tenantToolContext;
    if (tenantToolCtx.toolDefinitions.length > 0) {
      ctx.orchestrator.registerTools(tenantToolCtx.toolDefinitions);
    }

    if (tenantToolCtx.callBuiltinTools.size > 0) {
      effectiveCallBuiltinTools = tenantToolCtx.callBuiltinTools;
    }

    effectivePerCallConfig = {
      ...effectivePerCallConfig,
      tenantId: effectiveTenantId,
      toolAuthority: tenantToolCtx.toolAuthority,
      toolAllowlist: tenantToolCtx.toolAllowlist,
      rateLimiter: tenantToolCtx.rateLimiter,
      additionalTools: tenantToolCtx.toolDefinitions.length > 0 ? tenantToolCtx.toolDefinitions : undefined,
      perCallCapabilities: tenantToolCtx.capabilities.size > 0 ? tenantToolCtx.capabilities : undefined,
    };

    session.setSystemPrompt(agentCtx.systemPrompt);
    if (agentCtx.activeAgentId) {
      session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
    }
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
        tenantId: effectiveTenantId,
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
        tenantId: effectiveTenantId,
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
          tenantId: effectiveTenantId,
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

  // Project admitted-turn context for orchestrator consumption.
  const runtimeSupport = readRuntimeSupportArtifactsDetailed(ctx.contextArtifactCache, {
    session,
    channel: ctx.channel,
    providerHint: session.sessionLedger.lastProvider,
    taskShape,
  });
  const runtimeContinuityPresentation = formatRuntimeContinuityPresentation(runtimeSupport);
  const cachedRuntimeSummary = runtimeSupport.content;
  session.addExactArtifact(runtimeContinuityPresentation.decisionSummary);
  trace.log("pipeline", "Runtime continuity decision", {
    strategy: runtimeContinuityPresentation.runtimeContinuity.strategy,
    signals: runtimeSupport.decision.cachedResumeSignalCount,
    pressure: runtimeContinuityPresentation.runtimeContinuity.pressure,
    sources: runtimeContinuityPresentation.runtimeContinuity.supportArtifactSources,
    fallback: runtimeContinuityPresentation.runtimeContinuity.fallbackLabel,
    usedSelectedSources: runtimeContinuityPresentation.runtimeContinuity.usedCachedSupport,
    selectionReason: runtimeContinuityPresentation.runtimeContinuity.selectionReason,
    usedCache: runtimeContinuityPresentation.runtimeContinuity.strategy === "cache-first",
    feedback: runtimeContinuityPresentation.runtimeContinuity.feedbackLabel,
    influenced: runtimeSupport.decision.resumeFeedback?.influencedChoice ?? false,
  });
  const projectedTurnContext = projectAdmittedTurnContext({
    userContext: session.userContext,
    cachedRuntimeSummary,
    recalledMemory: ctx.recalledMemory,
    knowledgeContext: effectiveKnowledgeContext,
    contactContext: ctx.contactContext,
    groundingMode: ctx.groundingMode,
  });

  // Resolve active skills
  let perCallConfig = effectivePerCallConfig;
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
  const capturedRuntimeEvents: Array<
    ApprovalRequestedEvent
    | ApprovalReceivedEvent
    | CostUpdateEvent
    | ErrorEvent
    | ModelRoutedEvent
    | ToolCalledEvent
    | ToolResultEvent
  > = [];
  const orchestratorEventBus = ctx.orchestrator.eventBus;
  const onApprovalRequested = (event: ApprovalRequestedEvent): void => {
    if (event.sessionId !== session.id) return;
    capturedRuntimeEvents.push(event);
    approvalTransitions.push({
      status: "requested",
      sessionId: event.sessionId,
      reason: event.description,
    });
  };
  const onApprovalReceived = (event: ApprovalReceivedEvent): void => {
    if (event.sessionId !== session.id) return;
    capturedRuntimeEvents.push(event);
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
  const onRuntimeLedgerEvent = (
    event: CostUpdateEvent | ErrorEvent | ModelRoutedEvent | ToolCalledEvent | ToolResultEvent,
  ): void => {
    if (event.sessionId !== session.id) {
      return;
    }
    capturedRuntimeEvents.push(event);
  };
  orchestratorEventBus?.on("approval_requested", onApprovalRequested);
  orchestratorEventBus?.on("approval_received", onApprovalReceived);
  orchestratorEventBus?.on("tool_authorized", onToolAuthorized);
  orchestratorEventBus?.on("cost_update", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("error", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("model_routed", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_called", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_result", onRuntimeLedgerEvent);
  await ctx.turnCapture?.start?.(session.id, session.nextSessionEventSequence());

  let result: OrchestrateResult;
  try {
    // Process message
    result = await ctx.orchestrator.processMessage(
      session,
      ctx.userParts,
      projectedTurnContext.content,
      effectiveCallBuiltinTools,
      perCallConfig,
    );
  } catch (error) {
    await ctx.turnCapture?.abort?.(session.id);
    throw error;
  } finally {
    orchestratorEventBus?.off("approval_requested", onApprovalRequested);
    orchestratorEventBus?.off("approval_received", onApprovalReceived);
    orchestratorEventBus?.off("tool_authorized", onToolAuthorized);
    orchestratorEventBus?.off("cost_update", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("error", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("model_routed", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_called", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_result", onRuntimeLedgerEvent);
  }
  const externalTurnCapture = await ctx.turnCapture?.finish?.(session.id);

  // Post-generation grounding verification (Tier 2)
  let groundingResult: GroundingResult | undefined;
  let resultParts = result.parts;
  if (
    ctx.groundingMode === "verified" &&
    ctx.groundingDeps &&
    effectiveKnowledgeContext &&
    !result.queued &&
    extractText(result.parts)
  ) {
    const chunks = effectiveKnowledgeContext.split("\n---\n").filter(Boolean);
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
  const mergedFileChanges = dedupeByStableKey([
    ...(fileChanges ?? []),
    ...(externalTurnCapture?.fileChanges ?? []),
  ], (change) => `${change.path}|${change.changeType}|${"linesAdded" in change ? change.linesAdded ?? "" : ""}|${"linesRemoved" in change ? change.linesRemoved ?? "" : ""}|${"diffPreview" in change ? change.diffPreview ?? "" : ""}|${"diffTruncated" in change ? String(change.diffTruncated ?? "") : ""}`);
  const mergedApprovalTransitions = dedupeByStableKey([
    ...approvalTransitions,
    ...(externalTurnCapture?.approvalTransitions ?? []),
  ], (transition) => `${transition.sessionId}|${transition.status}|${transition.reason ?? ""}`);
  const mergedAuthorityDecisions = dedupeByStableKey([
    ...authorityDecisions,
    ...(externalTurnCapture?.authorityDecisions ?? []),
  ], (decision) => `${decision.toolName}|${decision.level}|${decision.allowed}|${decision.reason ?? ""}`);
  const dangerousCommandOutcomes = result.toolExecutions
    ?.map((execution) => dangerousCommandOutcomeFromExecution(execution))
    .filter((outcome): outcome is RuntimeTurnDangerousCommandOutcome => outcome !== undefined)
    ?? [];
  const mergedDangerousCommandOutcomes = dedupeByStableKey([
    ...dangerousCommandOutcomes,
    ...(externalTurnCapture?.dangerousCommandOutcomes ?? []),
  ], (outcome) => `${outcome.toolName}|${outcome.action}|${outcome.reasonCode}|${outcome.reason}`);

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
    activeAgentId: effectiveActiveAgentId,
    routingTierHint: effectiveRoutingTier,
    fileChanges: mergedFileChanges.length > 0 ? mergedFileChanges : undefined,
    approvalTransitions: mergedApprovalTransitions.length > 0 ? mergedApprovalTransitions : undefined,
    authorityDecisions: mergedAuthorityDecisions.length > 0 ? mergedAuthorityDecisions : undefined,
    dangerousCommandOutcomes: mergedDangerousCommandOutcomes.length > 0 ? mergedDangerousCommandOutcomes : undefined,
  });
  writeRuntimeHandoffSummaryArtifact(ctx.contextArtifactCache, {
    session,
    handoffBrief: effectiveHandoffBrief,
    handoffBlocked: effectivePingPongBlocked,
    handoffBlockReason: effectivePingPongReason,
    escalationReason: result.escalation?.reason,
    escalationDetail: result.escalation?.detail,
  });
  appendCanonicalTurnEvents({
    session,
    channel: ctx.channel,
    userMessageContent: userText,
    assistantMessageContent: extractText(result.parts),
    queued: result.queued,
    turnStartedAt,
    turnCompletedAt: new Date(),
    continuity: runtimeContinuityPresentation.runtimeContinuity,
    runtimeEvents: capturedRuntimeEvents,
    fileChanges: mergedFileChanges.length > 0 ? mergedFileChanges : undefined,
  });

  // Persist mutated session (required for non-reference stores like Redis)
  await ctx.sessionRegistry.save(session);

  // Report usage (fire-and-forget)
  if (ctx.billing) {
    reportUsage(ctx.billing, {
      tenantId: effectiveTenantId,
      messages: 1,
      tokens: result.inputTokens + result.outputTokens,
      model: result.routingDecision?.model ?? ctx.orchestrator.model ?? "unknown",
    });
  }

  // Emit events (fire-and-forget)
  const assistantDecision = await resolveEgressDecision(
    ctx,
    effectiveTenantId,
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
      effectiveTenantId,
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
          effectiveTenantId,
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
      tenantId: effectiveTenantId,
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
        tenantId: effectiveTenantId,
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
        tenantId: effectiveTenantId,
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
          tenantId: effectiveTenantId,
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
    if (effectiveActiveAgentId) {
      ctx.eventEmitter.emit({
        eventType: "AGENT_ROUTED",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        activeAgentId: effectiveActiveAgentId,
        activeAgentName: effectiveActiveAgentName,
        routingTier: effectiveRoutingTier,
        routingConfidence: effectiveRoutingConfidence,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit AGENT_HANDOFF when an agent switch occurred (or was blocked)
    if (effectiveIsHandoff || effectivePingPongBlocked) {
      ctx.eventEmitter.emit({
        eventType: "AGENT_HANDOFF",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        fromAgentId: effectivePreviousAgentId,
        fromAgentName: effectivePreviousAgentName,
        toAgentId: effectiveActiveAgentId,
        toAgentName: effectiveActiveAgentName,
        handoffBrief: effectiveHandoffBrief,
        handoffBlocked: effectivePingPongBlocked,
        handoffBlockReason: effectivePingPongReason,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit MODEL_ROUTED when model routing occurred
    if (result.routingDecision) {
      ctx.eventEmitter.emit({
        eventType: "MODEL_ROUTED",
        tenantId: effectiveTenantId,
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
      tenantId: effectiveTenantId,
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
      activeAgentId: effectiveActiveAgentId,
      routingDecision: result.routingDecision
        ? { provider: result.routingDecision.provider, model: result.routingDecision.model, routingTier: result.routingDecision.routingTier }
        : undefined,
      groundingResult,
      runtimeContinuity: runtimeContinuityPresentation.runtimeContinuity,
      contextAudit: projectedTurnContext.audit,
    },
  };
}
