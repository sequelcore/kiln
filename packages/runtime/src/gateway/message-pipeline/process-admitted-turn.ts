// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ContentPart,
  ArtifactResourceStore,
  SessionLimitsConfig,
  SkillRegistry,
  GroundingMode,
  GroundingResult,
  ProviderAdapter,
  ModelCapabilityRegistry,
  EventBus,
  ContextArtifactCache,
  ContextCandidate,
  ApprovalRequestedEvent,
  ApprovalReceivedEvent,
  ToolAuthorizedEvent,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  MultimodalRoutedEvent,
  ToolCalledEvent,
  ToolResultEvent,
  TenantConfig,
  RetrievalPipeline,
  SttAdapter,
  TtsAdapter,
  VoiceConfig,
  CanonicalSessionEvent,
  SessionTurnOutcome,
  EffectivePromptObservation,
  CommunicationResolution,
} from "@kilnai/core";
import {
  estimateTextTokens,
  extractText,
  textParts,
  GroundingRail,
  skillConfigToContextCandidate,
  projectFinalEffectivePromptObservation,
} from "@kilnai/core";
import type {
  AbuseDetectionConfig
} from "../../session/repetitive-abuse-detector.js";
import {
  detectRepetitiveAbuse
} from "../../session/repetitive-abuse-detector.js";
import type {
  RuntimeSessionOrchestrator,
  OrchestrateResult,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary
} from "../../session/runtime-session-orchestrator.js";
import type {
  SessionRegistry
} from "../../session/persistence/session-registry.js";
import type {
  BillingConfig
} from "../budget-middleware.js";
import {
  checkBudget,
  reportUsage
} from "../budget-middleware.js";
import type {
  ConversationEventEmitter
} from "../conversation-event-emitter.js";
import type {
  SessionMode
} from "../../session/session-mode.js";
import type {
  EscalationSignal
} from "../../session/support/escalation/escalation-detector.js";
import {
  TraceContext
} from "../trace-context.js";
import {
  formatKnowledgeContext
} from "../context-formatter.js";
import {
  formatRuntimeContinuityPresentation,
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
  writeRuntimeHandoffSummaryArtifact
} from "../../session/support/artifacts/context-artifact-summary.js";
import {
  applyRuntimeTurnRecord,
  type RuntimeTurnApprovalTransition,
  type RuntimeTurnAuthorityDecision,
  type RuntimeTurnDangerousCommandOutcome,
  type RuntimeTurnFileChange,
  type RuntimeTurnProviderValidation,
  type RuntimeTurnToolCompletion
} from "../../session/runtime-turn-record.js";
import {
  appendCanonicalTurnEvents
} from "../../session/runtime-session-event-ledger.js";
import {
  type ContextUsageWindowEvidence
} from "../../session/context-usage-projection.js";
import {
  resolveAgentContextAsync
} from "../../tenant/agent-resolver.js";
import {
  buildTenantSystemPrompt
} from "../../tenant/system-prompt-builder.js";
import type {
  AgentHandoffSummarizer
} from "../../session/support/summarization/agent-handoff-summarizer.js";
import type {
  OperatorExecutionMode,
  OperatorTurnRequestedAuthority
} from "@kilnai/gateway-contracts";
import type {
  RuntimeSession
} from "../../session/runtime-session.js";
import {
  createGenericMediaDownloader
} from "../audio-preprocessor.js";
import {
  captureMultimodalArtifacts
} from "../multimodal-artifact-ingestion.js";
import {
  synthesizeVoiceOutput
} from "../voice-output-synthesizer.js";
import {
  appendCoordinationProviderFailureAudit,
  projectAdmittedTurnContext,
  projectCompletedTurnContextUsage,
  resolveCoordinationContextCandidates,
  type RuntimeContextAudit
} from "./admitted-turn-context.js";
import {
  appendWebSourceAttributionIfMissing,
  buildAuthorityGuidanceContextCandidate,
  buildGovernedWorkCloseoutContextCandidate,
  buildGovernedWorkMaterializationContextCandidate,
  buildWebSourceAttributionContextCandidate,
  hasWebToolAvailable,
  projectRequestedAuthorityPerCallConfig,
  shouldIncludeGovernedWorkCloseoutContext
} from "./procedural-context-candidates.js";
import {
  EGRESS_DENIED_FALLBACK_TEXT,
  EGRESS_REDACTED_TEXT,
  type EgressPermissionDecision,
  type EgressPermissionRequest,
  redactAssistantParts,
  resolveEgressDecision,
  sanitizeAssistantEgressParts
} from "./assistant-egress-text.js";
import {
  appendRuntimeLedgerEvent,
  isCancellationErrorEvent,
  replayCapturedRuntimeLedgerEvents,
  resolveTurnToolExecutions,
  runtimeFailureEvent,
  type RuntimePipelineLedgerEvent
} from "./runtime-ledger-replay.js";
import {
  dangerousCommandOutcomeFromExecution,
  buildAuthorityMutationViolation,
  dedupeByStableKey
} from "./turn-authority-guard.js";
import {
  extractPlanAnalysisReports,
  extractPlanSubmissions,
  extractSpecificationSubmissions,
  extractClarificationRecords
} from "./governed-work-extraction.js";
import {
  resolveVoiceInputParts
} from "./voice-input-resolver.js";

export interface AdmittedTurnContext {
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly systemPrompt?: string;
  readonly userParts: readonly ContentPart[];
  readonly artifactStore?: ArtifactResourceStore;
  readonly voiceConfig?: VoiceConfig;
  readonly sttAdapter?: SttAdapter;
  readonly ttsAdapter?: TtsAdapter;
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly channel: string;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly idleTimeoutMs?: number;
  readonly recalledMemoryCandidates?: readonly ContextCandidate[];
  readonly knowledgeContext?: string;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactContext?: string;
  readonly tenant?: TenantConfig;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
  readonly runtimeEvents?: readonly RuntimePipelineLedgerEvent[];
  readonly callBuiltinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly perCallConfig?: PerCallToolConfig;
  readonly contextPolicy?: NonNullable<PerCallToolConfig["contextPolicy"]>;
  readonly contextUsageWindow?: ContextUsageWindowEvidence;
  readonly traceId?: string;
  readonly activeAgentId?: string;
  readonly activeAgentName?: string;
  readonly voiceProfile?: string;
  readonly voiceOutputIntent?: string;
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
  readonly providerValidation?: readonly RuntimeTurnProviderValidation[];
  readonly executionMode?: OperatorExecutionMode;
  readonly groundingMode?: GroundingMode;
  readonly groundingDeps?: {
    readonly rail: GroundingRail;
    readonly providerPool: ReadonlyMap<string, ProviderAdapter>;
    readonly modelRegistry: ModelCapabilityRegistry;
    readonly eventBus?: EventBus;
  };
  readonly contextArtifactCache?: ContextArtifactCache;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  readonly coordinationContextProvider?: (input: {
    readonly appName: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly channel: string;
    readonly activeAgentId?: string;
  }) => readonly ContextCandidate[] | Promise<readonly ContextCandidate[]>;
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
        readonly toolCompletions?: readonly RuntimeTurnToolCompletion[];
      }
      | undefined
      | Promise<{
        readonly fileChanges?: readonly RuntimeTurnFileChange[];
        readonly approvalTransitions?: readonly RuntimeTurnApprovalTransition[];
        readonly authorityDecisions?: readonly RuntimeTurnAuthorityDecision[];
        readonly dangerousCommandOutcomes?: readonly RuntimeTurnDangerousCommandOutcome[];
        readonly toolCompletions?: readonly RuntimeTurnToolCompletion[];
      } | undefined>
    );
    readonly abort?: (sessionId: string) => void | Promise<void>;
  };
  /** Publishes persisted canonical turn evidence to the active operator surface. */
  readonly publishCanonicalSessionEvents?: (events: readonly CanonicalSessionEvent[]) => void;
}

export interface RuntimeSessionHydrationResult {
  readonly rehydrated: boolean;
  readonly messageCount: number;
  readonly reason?: string;
  readonly sourceSequence?: number;
}

export type RuntimeSessionHydrator = (input: {
  readonly sessionId: string;
  readonly session: RuntimeSession;
}) => RuntimeSessionHydrationResult | Promise<RuntimeSessionHydrationResult>;

export interface AdmittedTurnResult {
  readonly parts: readonly ContentPart[];
  readonly admittedInput?: {
    readonly content: string;
  };
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outcome: SessionTurnOutcome;
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
    readonly reasoning?: string;
    readonly selectionMode?: "automatic" | "explicit-operator-only";
    readonly deliberationResolution?: import("@kilnai/core").DeliberationResolution;
    readonly rationale?: import("@kilnai/core").ModelRoutingRationale;
  };
  readonly limitReached?: { type: "tokens" | "turns" | "abuse"; value: number; max?: number };
  readonly groundingResult?: GroundingResult;
  readonly voiceOutput?: {
    readonly artifactUris: readonly string[];
    readonly provider: string;
    readonly model?: string;
    readonly surface: string;
    readonly mode: "audio-response" | "artifact-only" | "audio-on-demand";
  };
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
  readonly contextAudit?: RuntimeContextAudit;
  readonly effectiveTurnAuthority?: NonNullable<PerCallToolConfig["effectiveTurnAuthority"]>;
  readonly communicationResolution?: CommunicationResolution;
  readonly effectivePromptObservation?: EffectivePromptObservation;
}

export interface BudgetDeniedResult {
  readonly budgetExhausted: true;
  readonly message: string;
}

export type ProcessResult =
  | { ok: true; result: AdmittedTurnResult }
  | { ok: false; budgetDenied: BudgetDeniedResult };

/**
 * State threaded from turn admission (session resolution, agent routing) into the
 * remaining pipeline phases. Populated once by {@link resolveSessionAndAgentContext}.
 */
interface SessionAdmissionState {
  readonly turnStartedAt: Date;
  readonly preAdmissionRuntimeEvents: readonly RuntimePipelineLedgerEvent[];
  readonly effectiveTenantId: string;
  readonly executionMode: OperatorExecutionMode;
  readonly session: RuntimeSession;
  readonly userParts: readonly ContentPart[];
  readonly userText: string;
  readonly taskShape: ReturnType<typeof normalizeRuntimeTaskShape>;
  readonly effectiveKnowledgeContext?: string;
  readonly effectiveCallBuiltinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly effectivePerCallConfig?: PerCallToolConfig;
  readonly effectiveActiveAgentId?: string;
  readonly effectiveActiveAgentName?: string;
  readonly effectiveRoutingTier?: "rule" | "embedding" | "fallback";
  readonly effectiveRoutingConfidence?: number;
  readonly effectiveIsHandoff?: boolean;
  readonly effectivePreviousAgentId?: string;
  readonly effectivePreviousAgentName?: string;
  readonly effectiveHandoffBrief?: string;
  readonly effectivePingPongBlocked?: boolean;
  readonly effectivePingPongReason?: string;
}

/**
 * Turn admission / session resolution: budget gate, session get-or-create (with
 * optional resume hydration), voice-input transcription, knowledge retrieval, and
 * multi-agent routing/tool registration. Returns either a terminal budget-denied
 * result or the admitted state consumed by the remaining phases.
 */
async function resolveSessionAndAgentContext(
  ctx: AdmittedTurnContext,
  trace: TraceContext,
): Promise<
  | { readonly kind: "stop"; readonly result: ProcessResult }
  | { readonly kind: "continue"; readonly state: SessionAdmissionState }
> {
  let userParts = ctx.artifactStore
    ? await captureMultimodalArtifacts(ctx.userParts, {
      artifactStore: ctx.artifactStore,
      downloader: createGenericMediaDownloader(),
      sourceKind: "uploaded-file",
      sourceIdPrefix: `${ctx.appName}:${ctx.tenantId}:${ctx.userId}:${ctx.channel}`,
      producerName: `gateway-${ctx.channel}-ingress`,
    })
    : ctx.userParts;
  const turnStartedAt = new Date();
  let preAdmissionRuntimeEvents: readonly RuntimePipelineLedgerEvent[] = [];
  const effectiveTenantId = ctx.tenant?.tenantId ?? ctx.tenantId;
  const executionMode = ctx.executionMode ?? "execute";
  const initialSystemPrompt = ctx.tenant
    ? buildTenantSystemPrompt(ctx.tenant)
    : (ctx.systemPrompt ?? "You are a helpful assistant.");

  // Budget check
  if (ctx.billing) {
    const budgetResult = await checkBudget(ctx.billing, effectiveTenantId);
    if (!budgetResult.allowed) {
      trace.log("pipeline", "Budget denied");
      return {
        kind: "stop",
        result: {
          ok: false,
          budgetDenied: {
            budgetExhausted: true,
            message: ctx.billing.overBudgetMessage ?? "Budget exhausted.",
          },
        },
      };
    }
  }

  const shouldAttemptResumeHydration = ctx.sessionId !== undefined && ctx.resumeSessionHydrator !== undefined;
  const existingResumeTarget = shouldAttemptResumeHydration && ctx.sessionId
    ? await ctx.sessionRegistry.getById(ctx.sessionId)
    : undefined;
  const shouldHydrateResumedSession = shouldAttemptResumeHydration
    && (existingResumeTarget === undefined || existingResumeTarget.isExpired);

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

  if (shouldHydrateResumedSession && ctx.sessionId && ctx.resumeSessionHydrator) {
    try {
      const hydration = await ctx.resumeSessionHydrator({ sessionId: ctx.sessionId, session });
      const summary = hydration.rehydrated
        ? `Runtime session rehydrated from transcript: ${hydration.messageCount} messages`
        : `Runtime session rehydration skipped: ${hydration.reason ?? "no usable transcript"}`;
      session.addExactArtifact(summary);
      session.updateSessionLedger({
        lastSummary: summary,
      });
      trace.log("pipeline", "Resume hydration completed", {
        sessionId: session.id,
        rehydrated: hydration.rehydrated,
        messageCount: hydration.messageCount,
        reason: hydration.reason,
        sourceSequence: hydration.sourceSequence,
      });
    } catch (error) {
      const summary = `Runtime session rehydration failed: ${error instanceof Error ? error.message : String(error)}`;
      session.addExactArtifact(summary);
      session.updateSessionLedger({ lastSummary: summary });
      trace.warn("pipeline", "Resume hydration failed", { sessionId: session.id, error: String(error) });
    }
  }

  // Merge incoming user context into session (merge semantics: keys accumulate)
  if (ctx.userContext && Object.keys(ctx.userContext).length > 0) {
    session.updateUserContext(ctx.userContext);
  }

  const voiceInput = await resolveVoiceInputParts({
    parts: userParts,
    voiceConfig: ctx.voiceConfig,
    sttAdapter: ctx.sttAdapter,
    artifactStore: ctx.artifactStore,
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    channel: ctx.channel,
    sessionId: session.id,
  });
  userParts = voiceInput.parts;
  preAdmissionRuntimeEvents = voiceInput.events;

  const userText = extractText(userParts);
  const taskShape = normalizeRuntimeTaskShape(userText);

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
      userParts,
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

    const baseToolAllowlist = effectivePerCallConfig?.toolAllowlist;
    const tenantToolAllowlist = tenantToolCtx.toolAllowlist;
    const narrowedToolAllowlist = baseToolAllowlist && tenantToolAllowlist
      ? new Set([...tenantToolAllowlist].filter((name) => baseToolAllowlist.has(name)))
      : tenantToolAllowlist ?? baseToolAllowlist;
    effectivePerCallConfig = {
      ...effectivePerCallConfig,
      tenantId: effectiveTenantId,
      toolAuthority: tenantToolCtx.toolAuthority,
      toolAllowlist: narrowedToolAllowlist,
      rateLimiter: tenantToolCtx.rateLimiter,
      additionalTools: tenantToolCtx.toolDefinitions.length > 0 ? tenantToolCtx.toolDefinitions : undefined,
      perCallCapabilities: tenantToolCtx.capabilities.size > 0 ? tenantToolCtx.capabilities : undefined,
      ...(tenantToolCtx.executionEnvelope ? { executionEnvelope: tenantToolCtx.executionEnvelope } : {}),
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

  return {
    kind: "continue",
    state: {
      turnStartedAt,
      preAdmissionRuntimeEvents,
      effectiveTenantId,
      executionMode,
      session,
      userParts,
      userText,
      taskShape,
      effectiveKnowledgeContext,
      effectiveCallBuiltinTools,
      effectivePerCallConfig,
      effectiveActiveAgentId,
      effectiveActiveAgentName,
      effectiveRoutingTier,
      effectiveRoutingConfidence,
      effectiveIsHandoff,
      effectivePreviousAgentId,
      effectivePreviousAgentName,
      effectiveHandoffBrief,
      effectivePingPongBlocked,
      effectivePingPongReason,
    },
  };
}

/**
 * Session-limit and abuse-detection guards: turn-count limit, token limit, and
 * repetitive-abuse detection. Returns a terminal `paused` result when a guard
 * trips, or `undefined` to continue the pipeline.
 */
async function applyTurnGuards(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  trace: TraceContext,
): Promise<ProcessResult | undefined> {
  const { session, effectiveTenantId, userText } = state;

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
        admittedInput: { content: userText },
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        outcome: "paused",
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
        admittedInput: { content: userText },
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        outcome: "paused",
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
          admittedInput: { content: userText },
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          outcome: "paused",
          queued: true,
          sessionId: session.id,
          sessionMode: session.sessionMode,
          traceId: trace.traceId,
          limitReached: { type: "abuse", value: abuse.confidence },
        },
      };
    }
  }

  return undefined;
}

/**
 * Turn context assembly: projects runtime continuity/support artifacts, procedural
 * and coordination context candidates, and the per-call tool config used by the
 * orchestrator invocation.
 */
async function assembleTurnContext(ctx: AdmittedTurnContext, state: SessionAdmissionState, trace: TraceContext) {
  const { session, effectiveTenantId, executionMode, effectivePerCallConfig, effectiveActiveAgentId, taskShape, userText } = state;

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

  const authorityPerCallConfig = projectRequestedAuthorityPerCallConfig(
    effectivePerCallConfig,
    executionMode,
    ctx.requestedAuthority,
    "gateway admitted turn requested authority",
  );
  const perCallConfig = ctx.contextPolicy
    ? { ...authorityPerCallConfig, contextPolicy: ctx.contextPolicy }
    : authorityPerCallConfig;
  const proceduralContextCandidates: ContextCandidate[] = [];
  if (executionMode === "plan") {
    proceduralContextCandidates.push({
      kind: "procedural",
      modelFacingSemantics: "directive",
      source: "runtime-execution-mode:plan",
      required: true,
      score: 1,
      content: [
        "Execution mode: plan.",
        "Do not mutate files, run destructive commands, apply patches, install dependencies, or execute implementation work.",
        "Use only read-only inspection tools as needed.",
        "When the plan is ready, call submit_plan with a structured governed plan artifact linked to sourceSpecificationId and clarificationRecordIds.",
      ].join("\n"),
    });
  }
  proceduralContextCandidates.push(buildAuthorityGuidanceContextCandidate(perCallConfig, {
    executionMode,
    requestedAuthority: ctx.requestedAuthority,
  }));
  if (perCallConfig?.governedWorkRequirement) {
    proceduralContextCandidates.push(
      buildGovernedWorkMaterializationContextCandidate(perCallConfig.governedWorkRequirement),
    );
  }
  if (executionMode === "execute" && shouldIncludeGovernedWorkCloseoutContext(userText)) {
    proceduralContextCandidates.push(buildGovernedWorkCloseoutContextCandidate());
  }
  if (hasWebToolAvailable(perCallConfig)) {
    proceduralContextCandidates.push(buildWebSourceAttributionContextCandidate());
  }
  if (ctx.skillRegistry && (ctx.activeSkills?.length || ctx.activeSkillTags?.length)) {
    const resolved = ctx.skillRegistry.resolve(ctx.activeSkills, ctx.activeSkillTags);
    for (const skill of resolved) {
      const loadedSkill = ctx.skillRegistry.load(skill.name);
      if (loadedSkill) {
        proceduralContextCandidates.push(skillConfigToContextCandidate(loadedSkill));
      }
    }
  }
  const coordinationContext = await resolveCoordinationContextCandidates(ctx.coordinationContextProvider, {
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    sessionId: session.id,
    channel: ctx.channel,
    activeAgentId: effectiveActiveAgentId,
  });
  const projectedTurnContext = projectAdmittedTurnContext({
    userContext: session.userContext,
    cachedRuntimeSummary,
    recalledMemoryCandidates: ctx.recalledMemoryCandidates,
    knowledgeContext: state.effectiveKnowledgeContext,
    contactContext: ctx.contactContext,
    groundingMode: ctx.groundingMode,
    proceduralContextCandidates,
    coordinationContextCandidates: coordinationContext.candidates,
    contextPolicy: ctx.contextPolicy,
  });
  const projectedContextAudit = appendCoordinationProviderFailureAudit(
    projectedTurnContext.audit,
    coordinationContext.failureReason,
  );

  return {
    runtimeSupport,
    runtimeContinuityPresentation,
    perCallConfig,
    projectedTurnContext,
    projectedContextAudit,
  };
}

type AssembledTurnContext = Awaited<ReturnType<typeof assembleTurnContext>>;

/**
 * Orchestrator invocation with event-ledger capture: wires transient listeners onto
 * the orchestrator event bus to capture approval/authority/runtime-ledger events for
 * this turn, invokes `orchestrator.processMessage`, and tears the listeners down. On
 * failure it records a canonical failure turn and rethrows.
 */
async function invokeOrchestratorWithLedgerCapture(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  assembled: AssembledTurnContext,
) {
  const { session, userParts } = state;
  const { perCallConfig, projectedTurnContext, runtimeContinuityPresentation } = assembled;

  // Capture real approval state transitions for this turn from runtime events.
  const approvalTransitions: RuntimeTurnApprovalTransition[] = [];
  const authorityDecisions: RuntimeTurnAuthorityDecision[] = [];
  const capturedRuntimeReplay = replayCapturedRuntimeLedgerEvents(
    ctx.orchestrator.eventBus,
    session.id,
    state.turnStartedAt,
    [...(ctx.runtimeEvents ?? []), ...state.preAdmissionRuntimeEvents],
  );
  const capturedRuntimeEvents = capturedRuntimeReplay.events;
  const capturedRuntimeEventKeys = capturedRuntimeReplay.keys;
  const orchestratorEventBus = ctx.orchestrator.eventBus;
  const onApprovalRequested = (event: ApprovalRequestedEvent): void => {
    if (event.sessionId !== session.id) return;
    if (!appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id)) {
      return;
    }
    approvalTransitions.push({
      approvalId: event.approvalId,
      status: "requested",
      sessionId: event.sessionId,
      reason: event.description,
    });
  };
  const onApprovalReceived = (event: ApprovalReceivedEvent): void => {
    if (event.sessionId !== session.id) return;
    if (!appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id)) {
      return;
    }
    approvalTransitions.push({
      approvalId: event.approvalId,
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
    event: CostUpdateEvent | ErrorEvent | ModelRoutedEvent | MultimodalRoutedEvent | ToolCalledEvent | ToolResultEvent,
  ): void => {
    if (event.sessionId !== session.id) {
      return;
    }
    appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id);
  };
  orchestratorEventBus?.on("approval_requested", onApprovalRequested);
  orchestratorEventBus?.on("approval_received", onApprovalReceived);
  orchestratorEventBus?.on("tool_authorized", onToolAuthorized);
  orchestratorEventBus?.on("cost_update", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("error", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("model_routed", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("multimodal_routed", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_called", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_result", onRuntimeLedgerEvent);
  await ctx.turnCapture?.start?.(session.id, session.nextSessionEventSequence());

  let result: OrchestrateResult;
  try {
    // Process message
    result = await ctx.orchestrator.processMessage(
      session,
      userParts,
      projectedTurnContext,
      state.effectiveCallBuiltinTools,
      perCallConfig,
    );
  } catch (error) {
    const turnFailedAt = new Date();
    const cancelled = perCallConfig?.abortSignal?.aborted === true;
    const retainedRuntimeEvents = cancelled
      ? capturedRuntimeEvents.filter((event) => event.type !== "error" || !isCancellationErrorEvent(event))
      : capturedRuntimeEvents;
    const failureRuntimeEvents = cancelled || retainedRuntimeEvents.some((event) => event.type === "error")
      ? retainedRuntimeEvents
      : [...retainedRuntimeEvents, runtimeFailureEvent(error, session.id, turnFailedAt)];
    const failureEvents = appendCanonicalTurnEvents({
      session,
      executionRouteId: perCallConfig?.executionBinding?.routeId,
      turnId: perCallConfig?.turnId,
      channel: ctx.channel,
      userMessageContent: state.userText,
      queued: false,
      turnOutcome: cancelled ? "cancelled" : "failed",
      turnStartedAt: state.turnStartedAt,
      turnCompletedAt: turnFailedAt,
      continuity: runtimeContinuityPresentation.runtimeContinuity,
      runtimeEvents: failureRuntimeEvents,
    });
    await ctx.sessionRegistry.save(session);
    ctx.publishCanonicalSessionEvents?.(failureEvents);
    await ctx.turnCapture?.abort?.(session.id);
    throw error;
  } finally {
    orchestratorEventBus?.off("approval_requested", onApprovalRequested);
    orchestratorEventBus?.off("approval_received", onApprovalReceived);
    orchestratorEventBus?.off("tool_authorized", onToolAuthorized);
    orchestratorEventBus?.off("cost_update", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("error", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("model_routed", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("multimodal_routed", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_called", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_result", onRuntimeLedgerEvent);
  }
  const externalTurnCapture = await ctx.turnCapture?.finish?.(session.id);

  return {
    result,
    approvalTransitions,
    authorityDecisions,
    capturedRuntimeEvents,
    capturedRuntimeEventKeys,
    externalTurnCapture,
  };
}

type OrchestrationOutcome = Awaited<ReturnType<typeof invokeOrchestratorWithLedgerCapture>>;

/**
 * Post-generation grounding verification (Tier 2): re-checks the assistant response
 * against retrieved knowledge chunks with a cheap structured-output judge model, and
 * replaces the response with a fallback message when it is found ungrounded.
 * Fails open on any evaluation error.
 */
async function verifyGroundedResponse(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  orchestration: OrchestrationOutcome,
  trace: TraceContext,
): Promise<{ resultParts: readonly ContentPart[]; groundingResult: GroundingResult | undefined }> {
  const { result } = orchestration;
  let groundingResult: GroundingResult | undefined;
  let resultParts = result.parts;

  if (
    ctx.groundingMode === "verified" &&
    ctx.groundingDeps &&
    state.effectiveKnowledgeContext &&
    !result.queued &&
    extractText(result.parts)
  ) {
    const chunks = state.effectiveKnowledgeContext.split("\n---\n").filter(Boolean);
    const responseText = extractText(result.parts);
    try {
      // Select cheapest model with structured output support
      const groundingCandidates = ctx.groundingDeps.modelRegistry
        .all()
        .filter((p) => p.supportsStructuredOutput)
        .sort((a, b) => a.inputPer1M - b.inputPer1M);
      const judge = groundingCandidates[0];
      const provider = judge ? ctx.groundingDeps.providerPool.get(judge.provider) : undefined;
      if (provider && judge) {
        groundingResult = await ctx.groundingDeps.rail.evaluate(responseText, chunks, provider, judge.model);
        // Emit internal event
        if (ctx.groundingDeps.eventBus) {
          const evt: import("@kilnai/core").GroundingEvaluatedEvent = {
            type: "grounding_evaluated",
            timestamp: new Date(),
            sessionId: state.session.id,
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

  return { resultParts, groundingResult };
}

type GroundedResponse = Awaited<ReturnType<typeof verifyGroundedResponse>>;

/**
 * Egress sanitization + voice synthesis + turn-record persistence: merges tool
 * execution evidence, extracts governed-work artifacts, applies egress permission
 * decisions to the assistant response/summary/tool results, synthesizes voice
 * output, persists the runtime turn record, and appends canonical turn events.
 */
async function finalizeEgressAndPersistTurn(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  assembled: AssembledTurnContext,
  orchestration: OrchestrationOutcome,
  grounded: GroundedResponse,
  runtimeFinalOutputText: string,
) {
  const { session, effectiveTenantId, executionMode, userText, taskShape } = state;
  const { perCallConfig, runtimeSupport, runtimeContinuityPresentation, projectedContextAudit } = assembled;
  const { result, approvalTransitions, authorityDecisions, capturedRuntimeEvents, externalTurnCapture } = orchestration;
  let resultParts = grounded.resultParts;
  const groundingResult = grounded.groundingResult;

  const turnToolExecutions = resolveTurnToolExecutions(
    result.toolExecutions,
    capturedRuntimeEvents,
    externalTurnCapture?.toolCompletions,
  );
  const fileChanges = turnToolExecutions?.flatMap((execution) => (
    execution.fileChanges?.map((change) => ({
      ...change,
      ...(execution.toolCallId ? { toolCallId: execution.toolCallId } : {}),
      ...(execution.executionScope ? { executionScope: execution.executionScope } : {}),
    })) ?? []
  ));
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
  const dangerousCommandOutcomes = turnToolExecutions
    ?.map((execution) => dangerousCommandOutcomeFromExecution(execution))
    .filter((outcome): outcome is RuntimeTurnDangerousCommandOutcome => outcome !== undefined)
    ?? [];
  const mergedDangerousCommandOutcomes = dedupeByStableKey([
    ...dangerousCommandOutcomes,
    ...(externalTurnCapture?.dangerousCommandOutcomes ?? []),
  ], (outcome) => `${outcome.toolName}|${outcome.action}|${outcome.reasonCode}|${outcome.reason}`);
  const planSubmissions = executionMode === "plan"
    ? extractPlanSubmissions(turnToolExecutions)
    : [];
  const specificationSubmissions = executionMode === "plan"
    ? extractSpecificationSubmissions(turnToolExecutions)
    : [];
  const clarificationRecords = executionMode === "plan"
    ? extractClarificationRecords(turnToolExecutions)
    : [];
  const analysisReports = executionMode === "plan"
    ? extractPlanAnalysisReports(turnToolExecutions)
    : [];
  const authorityMutationViolation = buildAuthorityMutationViolation(
    perCallConfig?.effectiveTurnAuthority,
    mergedFileChanges,
  );

  resultParts = appendWebSourceAttributionIfMissing(resultParts, turnToolExecutions);
  let egressContextSummary = result.contextSummary;
  let egressToolExecutions = turnToolExecutions;
  resultParts = sanitizeAssistantEgressParts(resultParts);
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

  const voiceSynthesis = await synthesizeVoiceOutput(
    resultParts,
    ctx.voiceConfig,
    ctx.ttsAdapter,
    {
      artifactStore: ctx.artifactStore,
      appName: ctx.appName,
      tenantId: effectiveTenantId,
      userId: ctx.userId,
      channel: ctx.channel,
      sessionId: session.id,
      model: result.routingDecision?.model ?? ctx.orchestrator.model ?? "gateway-transform",
      voiceProfile: ctx.voiceProfile,
      voiceOutputIntent: ctx.voiceOutputIntent,
      escalationReason: result.escalation?.reason,
      retentionMaxArtifacts: ctx.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
    },
  );
  resultParts = voiceSynthesis.parts;
  for (const event of voiceSynthesis.events) {
    appendRuntimeLedgerEvent(capturedRuntimeEvents, orchestration.capturedRuntimeEventKeys, event, session.id);
  }

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
    toolExecutions: turnToolExecutions,
    routingDecision: result.routingDecision,
    escalationReason: result.escalation?.reason,
    groundingBlockedClaims: groundingResult && !groundingResult.grounded
      ? groundingResult.ungroundedClaims
      : undefined,
    activeAgentId: state.effectiveActiveAgentId,
    routingTierHint: state.effectiveRoutingTier,
    fileChanges: mergedFileChanges.length > 0 ? mergedFileChanges : undefined,
    approvalTransitions: mergedApprovalTransitions.length > 0 ? mergedApprovalTransitions : undefined,
    authorityDecisions: mergedAuthorityDecisions.length > 0 ? mergedAuthorityDecisions : undefined,
    dangerousCommandOutcomes: mergedDangerousCommandOutcomes.length > 0 ? mergedDangerousCommandOutcomes : undefined,
    providerValidation: ctx.providerValidation,
  });
  writeRuntimeHandoffSummaryArtifact(ctx.contextArtifactCache, {
    session,
    handoffBrief: state.effectiveHandoffBrief,
    handoffBlocked: state.effectivePingPongBlocked,
    handoffBlockReason: state.effectivePingPongReason,
    escalationReason: result.escalation?.reason,
    escalationDetail: result.escalation?.detail,
  });
  const completedTurnEvents = appendCanonicalTurnEvents({
    session,
    executionRouteId: perCallConfig?.executionBinding?.routeId,
    turnId: perCallConfig?.turnId,
    channel: ctx.channel,
    userMessageContent: userText,
    assistantMessageContent: extractText(resultParts),
    queued: result.queued,
    turnOutcome: result.outcome,
    turnStartedAt: state.turnStartedAt,
    turnCompletedAt: new Date(),
    continuity: runtimeContinuityPresentation.runtimeContinuity,
    runtimeEvents: capturedRuntimeEvents,
    planSubmissions,
    analysisReports,
    specificationSubmissions,
    lifecycleAttributionEvidence: {
      contextAudit: projectedContextAudit,
      finalOutput: {
        estimatedTokens: estimateTextTokens(runtimeFinalOutputText),
      },
    },
    efficiencyPolicy: ctx.contextPolicy
      ? {
          owner: "ContextGovernor",
          policyId: ctx.contextPolicy.policyId,
          configurationHash: ctx.contextPolicy.configurationHash,
        }
      : undefined,
    clarificationRecords,
    authorityMutationViolations: authorityMutationViolation ? [authorityMutationViolation] : undefined,
    fileChanges: mergedFileChanges.length > 0 ? mergedFileChanges : undefined,
    contextUsage: projectCompletedTurnContextUsage({
      result,
      turnId: perCallConfig?.turnId,
      contextWindow: ctx.contextUsageWindow,
    }),
    providerRequests: result.providerRequests,
  });

  return {
    resultParts,
    egressContextSummary,
    egressToolExecutions,
    voiceSynthesis,
    completedTurnEvents,
  };
}

type FinalizedTurn = Awaited<ReturnType<typeof finalizeEgressAndPersistTurn>>;

/**
 * Event emission: persists the session, reports billing usage, emits gateway
 * conversation events (message received, handoff, escalation, tool execution,
 * agent routing, model routing, grounding block) and returns the final
 * `AdmittedTurnResult`.
 */
async function finalizeAndEmitTurnEvents(
  ctx: AdmittedTurnContext,
  state: SessionAdmissionState,
  assembled: AssembledTurnContext,
  orchestration: OrchestrationOutcome,
  grounded: GroundedResponse,
  finalized: FinalizedTurn,
  trace: TraceContext,
): Promise<ProcessResult> {
  const { session, effectiveTenantId, userText } = state;
  const { projectedContextAudit, perCallConfig } = assembled;
  const { result } = orchestration;
  const { groundingResult } = grounded;
  const { resultParts, egressContextSummary, egressToolExecutions, voiceSynthesis, completedTurnEvents } = finalized;
  const {
    effectiveActiveAgentId,
    effectiveActiveAgentName,
    effectiveRoutingTier,
    effectiveRoutingConfidence,
    effectiveIsHandoff,
    effectivePreviousAgentId,
    effectivePreviousAgentName,
    effectiveHandoffBrief,
    effectivePingPongBlocked,
    effectivePingPongReason,
  } = state;

  // Persist mutated session (required for non-reference stores like Redis)
  await ctx.sessionRegistry.save(session);
  ctx.publishCanonicalSessionEvents?.(completedTurnEvents);

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
        selectionMode: result.routingDecision.selectionMode,
        deliberationResolution: result.routingDecision.deliberationResolution,
        routingRationale: result.routingDecision.rationale,
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
      admittedInput: { content: userText },
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      outcome: result.outcome,
      queued: result.queued,
      sessionId: session.id,
      sessionMode: session.sessionMode,
      escalation: result.escalation,
      contextSummary: egressContextSummary,
      toolExecutions: egressToolExecutions,
      traceId: trace.traceId,
      activeAgentId: effectiveActiveAgentId,
      routingDecision: result.routingDecision
        ? {
            provider: result.routingDecision.provider,
            model: result.routingDecision.model,
            routingTier: result.routingDecision.routingTier,
            reasoning: result.routingDecision.reasoning,
            selectionMode: result.routingDecision.selectionMode,
            deliberationResolution: result.routingDecision.deliberationResolution,
            rationale: result.routingDecision.rationale,
          }
        : undefined,
      groundingResult,
      voiceOutput: voiceSynthesis.voiceOutput,
      runtimeContinuity: assembled.runtimeContinuityPresentation.runtimeContinuity,
      contextAudit: projectedContextAudit,
      effectiveTurnAuthority: perCallConfig?.effectiveTurnAuthority,
      communicationResolution: result.communicationResolution,
      effectivePromptObservation: projectFinalEffectivePromptObservation(result.providerRequests),
    },
  };
}

export async function processAdmittedTurn(ctx: AdmittedTurnContext): Promise<ProcessResult> {
  const trace = new TraceContext(ctx.traceId);
  trace.log("pipeline", "Processing inbound message", { appName: ctx.appName, userId: ctx.userId, channel: ctx.channel });

  const admission = await resolveSessionAndAgentContext(ctx, trace);
  if (admission.kind === "stop") {
    return admission.result;
  }
  const { state } = admission;

  const guardResult = await applyTurnGuards(ctx, state, trace);
  if (guardResult) {
    return guardResult;
  }

  const assembled = await assembleTurnContext(ctx, state, trace);
  const orchestration = await invokeOrchestratorWithLedgerCapture(ctx, state, assembled);
  const runtimeFinalOutputText = extractText(orchestration.result.parts);

  let canonicalTurnEventsAppended = false;
  try {
    const grounded = await verifyGroundedResponse(ctx, state, orchestration, trace);
    const finalized = await finalizeEgressAndPersistTurn(ctx, state, assembled, orchestration, grounded, runtimeFinalOutputText);
    canonicalTurnEventsAppended = true;
    return await finalizeAndEmitTurnEvents(ctx, state, assembled, orchestration, grounded, finalized, trace);
  } catch (error) {
    if (!canonicalTurnEventsAppended) {
      const turnFailedAt = new Date();
      const failureRuntimeEvents = orchestration.capturedRuntimeEvents.some((event) => event.type === "error")
        ? orchestration.capturedRuntimeEvents
        : [...orchestration.capturedRuntimeEvents, runtimeFailureEvent(error, state.session.id, turnFailedAt)];
      const failureEvents = appendCanonicalTurnEvents({
        session: state.session,
        executionRouteId: assembled.perCallConfig?.executionBinding?.routeId,
        turnId: assembled.perCallConfig?.turnId,
        channel: ctx.channel,
        userMessageContent: state.userText,
        assistantMessageContent: runtimeFinalOutputText,
        queued: orchestration.result.queued,
        turnOutcome: "failed",
        turnStartedAt: state.turnStartedAt,
        turnCompletedAt: turnFailedAt,
        continuity: assembled.runtimeContinuityPresentation.runtimeContinuity,
        runtimeEvents: failureRuntimeEvents,
        lifecycleAttributionEvidence: {
          contextAudit: assembled.projectedContextAudit,
          finalOutput: {
            estimatedTokens: estimateTextTokens(runtimeFinalOutputText),
          },
        },
        providerRequests: orchestration.result.providerRequests,
      });
      await ctx.sessionRegistry.save(state.session);
      ctx.publishCanonicalSessionEvents?.(failureEvents);
    }
    await ctx.turnCapture?.abort?.(state.session.id);
    throw error;
  }
}
